import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.js";
import { prisma } from "./lib/prisma.js";
import { encryptSensitive } from "./lib/crypto.js";
import { closeQueueConnections, removeWatchRepeatable } from "./lib/queue.js";

/** Synthetic checksum-valid IDs only — never real people. */
const ID_A = "110105199003074018";
const ID_B = "110101199001011237";

describe("multi-pax travelers → watch bind", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token = "";
  const email = `multi-pax-${Date.now()}@example.com`;
  let travelerA = "";
  let travelerB = "";
  let requestId = "";
  let watchJobId = "";

  before(async () => {
    process.env.PROVIDER_MODE = "fixture";
    process.env.BOOKING_STUB = "1";
    process.env.ALLOW_PUBLIC_REGISTER = "1";
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-encryption-key-multipax";
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
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
      if (requestId) {
        await prisma.watchJob.deleteMany({ where: { requestId } });
        await prisma.notificationEvent.deleteMany({ where: { requestId } });
        await prisma.ticketRequest.deleteMany({ where: { id: requestId } });
      }
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
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

  function auth() {
    return { authorization: `Bearer ${token}` };
  }

  it("register", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password: "password123", name: "Multi Pax" },
    });
    assert.equal(reg.statusCode, 200, reg.body);
    token = reg.json().token;
  });

  it("rejects authorized without consent", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/travelers",
      headers: auth(),
      payload: {
        name: "未授权代购",
        idType: "id_card",
        idNumber: ID_B,
        relationship: "authorized",
        authorizedConsent: false,
      },
    });
    assert.equal(res.statusCode, 400, res.body);
  });

  it("rejects bad ID checksum", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/travelers",
      headers: auth(),
      payload: {
        name: "坏校验",
        idType: "id_card",
        idNumber: "11010519900307401X",
        relationship: "self",
      },
    });
    assert.equal(res.statusCode, 400, res.body);
  });

  it("creates 2 travelers; response has hints only; enc ≠ plaintext", async () => {
    const a = await app.inject({
      method: "POST",
      url: "/travelers",
      headers: auth(),
      payload: {
        name: "测试甲",
        idType: "id_card",
        idNumber: ID_A,
        type: "adult",
        relationship: "self",
      },
    });
    assert.equal(a.statusCode, 201, a.body);
    const aj = a.json();
    travelerA = aj.id;
    assert.equal(aj.idNumberHint, "****4018");
    assert.equal(aj.relationship, "self");
    assert.ok(!("idNumber" in aj));
    assert.ok(!("idNumberEnc" in aj));
    assert.ok(!JSON.stringify(aj).includes(ID_A));

    const b = await app.inject({
      method: "POST",
      url: "/travelers",
      headers: auth(),
      payload: {
        name: "测试乙",
        idType: "id_card",
        idNumber: ID_B,
        type: "adult",
        relationship: "authorized",
        authorizedConsent: true,
      },
    });
    assert.equal(b.statusCode, 201, b.body);
    const bj = b.json();
    travelerB = bj.id;
    assert.equal(bj.relationship, "authorized");
    assert.equal(bj.authorizedConsent, true);
    assert.ok(bj.authorizedConsentAt);
    assert.ok(!("idNumber" in bj));
    assert.ok(!JSON.stringify(bj).includes(ID_B));

    const stored = await prisma.traveler.findUnique({ where: { id: travelerA } });
    assert.ok(stored);
    assert.notEqual(stored!.idNumberEnc, ID_A);
    assert.ok(!stored!.idNumberEnc.startsWith("plain:"), "ENCRYPTION_KEY must encrypt");
    assert.ok(stored!.idNumberEnc.startsWith("v1:"));
    // encryptSensitive with same key produces different IV — just ensure format
    const sample = encryptSensitive("probe");
    assert.ok(sample.startsWith("v1:"));
  });

  it("rejects watch when travelerIds length ≠ passengers", async () => {
    const req = await app.inject({
      method: "POST",
      url: "/requests",
      headers: auth(),
      payload: {
        channel: "train",
        fields: { from: "北京南", to: "上海虹桥", date: "2026-10-01", passengers: 2 },
      },
    });
    assert.equal(req.statusCode, 201, req.body);
    requestId = req.json().id;

    const bad = await app.inject({
      method: "POST",
      url: `/requests/${requestId}/watch`,
      headers: auth(),
      payload: { intervalMinutes: 15, travelerIds: [travelerA] },
    });
    assert.equal(bad.statusCode, 400, bad.body);
  });

  it("creates watch with 2 travelerIds; GET returns hints only", async () => {
    const watch = await app.inject({
      method: "POST",
      url: `/requests/${requestId}/watch`,
      headers: auth(),
      payload: {
        intervalMinutes: 15,
        travelerIds: [travelerA, travelerB],
      },
    });
    assert.equal(watch.statusCode, 201, watch.body);
    const wj = watch.json();
    watchJobId = wj.id;
    assert.deepEqual(wj.travelerIds, [travelerA, travelerB]);
    assert.equal(wj.travelers.length, 2);
    for (const t of wj.travelers) {
      assert.ok(t.idNumberHint);
      assert.ok(!("idNumber" in t));
      assert.ok(!("idNumberEnc" in t));
    }
    const blob = JSON.stringify(wj);
    assert.ok(!blob.includes(ID_A));
    assert.ok(!blob.includes(ID_B));

    const grabs = await app.inject({
      method: "GET",
      url: "/grabs?status=all",
      headers: auth(),
    });
    assert.equal(grabs.statusCode, 200, grabs.body);
    const items = grabs.json().items as { id: string; travelers?: unknown[]; travelerIds?: string[] }[];
    const found = items.find((i) => i.id === watchJobId);
    assert.ok(found, "watch job should appear in /grabs");
    assert.equal(found!.travelerIds?.length, 2);
    assert.equal(found!.travelers?.length, 2);
    assert.ok(!JSON.stringify(found).includes(ID_A));
  });

  it("list travelers never returns full idNumber", async () => {
    const list = await app.inject({ method: "GET", url: "/travelers", headers: auth() });
    assert.equal(list.statusCode, 200);
    const rows = list.json() as Record<string, unknown>[];
    assert.ok(rows.length >= 2);
    for (const r of rows) {
      assert.ok(!("idNumber" in r));
      assert.ok(!("idNumberEnc" in r));
    }
    assert.ok(!JSON.stringify(rows).includes(ID_A));
  });
});
