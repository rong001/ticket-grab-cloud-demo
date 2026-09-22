import { createHash } from "node:crypto";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.js";
import { prisma } from "./lib/prisma.js";
import { encryptSensitive } from "./lib/crypto.js";
import { closeQueueConnections, removeWatchRepeatable } from "./lib/queue.js";

/** Synthetic checksum-valid IDs only — never real people. */
const ID_A = "110105199003074018";
const ID_B = "110101199001011237";

function emailFp(email: string): string {
  return createHash("sha256").update(email).digest("hex").slice(0, 12);
}

/**
 * intake-confirm-traveler-select:
 * Conversational /intake confirm binds saved travelers → WatchJob.travelerIds.
 * Unauthorized ownership / length mismatch → 400. List APIs stay redacted.
 */
describe("intake-confirm-traveler-select", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token = "";
  let otherToken = "";
  const email = `intake-traveler-${Date.now()}@example.com`;
  const otherEmail = `intake-traveler-other-${Date.now()}@example.com`;
  let travelerA = "";
  let travelerB = "";
  let otherTraveler = "";
  let requestId = "";
  let watchJobId = "";
  let sessionId = "";
  const prev = {
    PROVIDER_MODE: process.env.PROVIDER_MODE,
    BOOKING_STUB: process.env.BOOKING_STUB,
    TRAIN_REAL_SUBMIT: process.env.TRAIN_REAL_SUBMIT,
  };

  before(async () => {
    process.env.PROVIDER_MODE = "fixture";
    process.env.BOOKING_STUB = "1";
    delete process.env.TRAIN_REAL_SUBMIT;
    process.env.ALLOW_PUBLIC_REGISTER = "1";
    process.env.ENCRYPTION_KEY =
      process.env.ENCRYPTION_KEY || "test-encryption-key-intake-traveler";
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      if (watchJobId) {
        const job = await prisma.watchJob.findUnique({ where: { id: watchJobId } });
        if (job) {
          await removeWatchRepeatable({
            id: job.id,
            intervalMinutes: job.intervalMinutes,
            endsAt: job.endsAt,
            bullJobId: job.bullJobId,
          });
        }
      }
      for (const em of [email, otherEmail]) {
        const user = await prisma.user.findUnique({ where: { email: em } });
        if (!user) continue;
        await prisma.notificationEvent.deleteMany({
          where: { request: { userId: user.id } },
        });
        await prisma.watchJob.deleteMany({ where: { request: { userId: user.id } } });
        await prisma.ticketRequest.deleteMany({ where: { userId: user.id } });
        await prisma.traveler.deleteMany({ where: { userId: user.id } });
        await prisma.userActivity.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
      }
    } catch {
      /* ignore */
    }
    await app.close();
    await closeQueueConnections();
    await prisma.$disconnect();
  });

  function auth(t = token) {
    return { authorization: `Bearer ${t}` };
  }

  async function readyTrainSession(pax = 2): Promise<string> {
    const message = `北京南到上海虹桥 2026-10-20 08:00-12:00 二等座 ${pax}人 立刻开抢`;
    const res = await app.inject({
      method: "POST",
      url: "/intake/turn",
      payload: { message },
    });
    assert.equal(res.statusCode, 200, res.body);
    const last = res.json() as {
      readyForConfirm?: boolean;
      sessionId?: string;
      confirmation?: unknown;
      fields?: { passengers?: number };
    };
    assert.equal(last.readyForConfirm, true, JSON.stringify(last));
    assert.ok(last.confirmation);
    assert.equal(last.fields?.passengers, pax);
    return last.sessionId!;
  }

  it("register + 2 travelers (self + authorized consent)", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password: "password123", name: "Intake Traveler" },
    });
    assert.equal(reg.statusCode, 200, reg.body);
    token = reg.json().token;
    // eslint-disable-next-line no-console
    console.log(`emailFp=${emailFp(email)}`);

    const a = await app.inject({
      method: "POST",
      url: "/travelers",
      headers: auth(),
      payload: {
        name: "出行甲",
        idType: "id_card",
        idNumber: ID_A,
        relationship: "self",
        type: "adult",
      },
    });
    assert.equal(a.statusCode, 201, a.body);
    travelerA = a.json().id;
    assert.equal(a.json().idNumberHint, "****4018");
    assert.equal(a.json().idNumber, undefined);

    const b = await app.inject({
      method: "POST",
      url: "/travelers",
      headers: auth(),
      payload: {
        name: "出行乙",
        idType: "id_card",
        idNumber: ID_B,
        relationship: "authorized",
        authorizedConsent: true,
        type: "adult",
      },
    });
    assert.equal(b.statusCode, 201, b.body);
    travelerB = b.json().id;
    assert.equal(b.json().idNumberHint, "****1237");

    const other = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: otherEmail, password: "password123", name: "Other User" },
    });
    assert.equal(other.statusCode, 200, other.body);
    otherToken = other.json().token;
    const ot = await app.inject({
      method: "POST",
      url: "/travelers",
      headers: auth(otherToken),
      payload: {
        name: "他人",
        idType: "id_card",
        idNumber: ID_A,
        relationship: "self",
        type: "adult",
      },
    });
    assert.equal(ot.statusCode, 201, ot.body);
    otherTraveler = ot.json().id;
  });

  it("confirm with 2 travelers → watch has travelerIds; /grabs redacted", async () => {
    sessionId = await readyTrainSession(2);
    const conf = await app.inject({
      method: "POST",
      url: "/intake/confirm",
      headers: auth(),
      payload: {
        sessionId,
        confirmed: true,
        travelerIds: [travelerA, travelerB],
      },
    });
    assert.equal(conf.statusCode, 201, conf.body);
    const body = conf.json() as {
      request: { id: string };
      watchJob: { id: string; travelerIds: string[] };
      travelers: { name: string; idNumberHint?: string; idNumber?: string }[];
    };
    requestId = body.request.id;
    watchJobId = body.watchJob.id;
    assert.deepEqual(body.watchJob.travelerIds, [travelerA, travelerB]);
    assert.equal(body.travelers.length, 2);
    for (const t of body.travelers) {
      assert.ok(t.idNumberHint?.startsWith("****"));
      assert.equal(t.idNumber, undefined);
      assert.ok(!JSON.stringify(t).includes(ID_A));
      assert.ok(!JSON.stringify(t).includes(ID_B));
    }

    const row = await prisma.watchJob.findUnique({ where: { id: watchJobId } });
    assert.ok(row);
    assert.deepEqual(row!.travelerIds, [travelerA, travelerB]);

    const grabs = await app.inject({ method: "GET", url: "/grabs", headers: auth() });
    assert.equal(grabs.statusCode, 200, grabs.body);
    const items = grabs.json().items as {
      id: string;
      travelerIds?: string[];
      travelers?: { idNumberHint?: string; idNumber?: string; name?: string }[];
    }[];
    const found = items.find((i) => i.id === watchJobId);
    assert.ok(found, "watch should appear in /grabs");
    assert.deepEqual(found!.travelerIds, [travelerA, travelerB]);
    assert.equal(found!.travelers?.length, 2);
    const raw = grabs.body;
    assert.ok(!raw.includes(ID_A));
    assert.ok(!raw.includes(ID_B));
    assert.ok(!raw.includes("idNumberEnc"));
  });

  it("mismatch travelerIds length vs passengers → 400", async () => {
    const sid = await readyTrainSession(2);
    const conf = await app.inject({
      method: "POST",
      url: "/intake/confirm",
      headers: auth(),
      payload: {
        sessionId: sid,
        confirmed: true,
        travelerIds: [travelerA],
      },
    });
    assert.equal(conf.statusCode, 400, conf.body);
    assert.match(conf.json().error ?? "", /不一致|数量/);
  });

  it("unauthorized traveler (other user) → 400", async () => {
    const sid = await readyTrainSession(2);
    const conf = await app.inject({
      method: "POST",
      url: "/intake/confirm",
      headers: auth(),
      payload: {
        sessionId: sid,
        confirmed: true,
        travelerIds: [travelerA, otherTraveler],
      },
    });
    assert.equal(conf.statusCode, 400, conf.body);
    assert.match(conf.json().error ?? "", /不存在|不属于/);
  });

  it("authorized without consent → 400", async () => {
    const user = await prisma.user.findUnique({ where: { email } });
    assert.ok(user);
    const rogue = await prisma.traveler.create({
      data: {
        userId: user!.id,
        name: "无同意代购",
        idType: "id_card",
        idNumberEnc: encryptSensitive("11010119900101123X"),
        idNumberHint: "****123X",
        relationship: "authorized",
        authorizedConsent: false,
        authorizedConsentAt: null,
        type: "adult",
      },
    });
    const sid = await readyTrainSession(2);
    const conf = await app.inject({
      method: "POST",
      url: "/intake/confirm",
      headers: auth(),
      payload: {
        sessionId: sid,
        confirmed: true,
        travelerIds: [travelerA, rogue.id],
      },
    });
    assert.equal(conf.statusCode, 400, conf.body);
    assert.match(conf.json().error ?? "", /授权同意|authorizedConsent/);
    await prisma.traveler.delete({ where: { id: rogue.id } }).catch(() => undefined);
  });

  it("GET /travelers list stays redacted", async () => {
    const list = await app.inject({ method: "GET", url: "/travelers", headers: auth() });
    assert.equal(list.statusCode, 200, list.body);
    assert.ok(!list.body.includes(ID_A));
    assert.ok(!list.body.includes(ID_B));
    assert.ok(!list.body.includes("idNumberEnc"));
    const rows = list.json() as { idNumberHint?: string; idNumber?: string }[];
    assert.ok(rows.some((r) => r.idNumberHint === "****4018"));
    for (const r of rows) assert.equal(r.idNumber, undefined);
  });

  it("guest turn still works without auth (no task create)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/intake/turn",
      payload: { message: "火车" },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.ok(res.json().sessionId);
    assert.equal(res.json().readyForConfirm, false);
  });
});
