import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.js";
import { prisma } from "./lib/prisma.js";
import { closeQueueConnections, removeWatchRepeatable } from "./lib/queue.js";

/** Synthetic checksum-valid IDs only — never real people. */
const ID_A = "110105199003074018";
const ID_B = "110101199001011237";
const ID_C = "110101199001011501";

/**
 * watch-draft-correctness:
 * 1) preferred train/seat with no match → 400 NO_MATCHING_SHORTLIST, no order
 * 2) sold-out-only shortlist → 400, no silent success
 * 3) concurrent create-order → exactly ONE draft for same combo
 * 4) different watch must not share that draft
 */
describe("watch-draft-correctness", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token = "";
  let tokenOther = "";
  const email = `wdc-${Date.now()}@example.com`;
  const emailOther = `wdc-other-${Date.now()}@example.com`;
  let travelerA = "";
  let travelerB = "";
  let travelerOther = "";
  const requestIds: string[] = [];
  const watchIds: string[] = [];
  let prev: Record<string, string | undefined>;

  before(async () => {
    prev = {
      PROVIDER_MODE: process.env.PROVIDER_MODE,
      BOOKING_STUB: process.env.BOOKING_STUB,
      TRAIN_REAL_SUBMIT: process.env.TRAIN_REAL_SUBMIT,
      TRAIN_SUBMIT_ENABLED: process.env.TRAIN_SUBMIT_ENABLED,
    };
    process.env.PROVIDER_MODE = "fixture";
    process.env.BOOKING_STUB = "0";
    delete process.env.TRAIN_REAL_SUBMIT;
    delete process.env.TRAIN_SUBMIT_ENABLED;
    process.env.ALLOW_PUBLIC_REGISTER = "1";
    process.env.ENCRYPTION_KEY =
      process.env.ENCRYPTION_KEY || "test-encryption-key-wdc";

    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      for (const wid of watchIds) {
        const job = await prisma.watchJob.findUnique({ where: { id: wid } });
        if (job) {
          await removeWatchRepeatable({
            id: job.id,
            intervalMinutes: job.intervalMinutes,
            endsAt: job.endsAt,
            bullJobId: job.bullJobId,
          });
        }
      }
      for (const em of [email, emailOther]) {
        const user = await prisma.user.findUnique({ where: { email: em } });
        if (!user) continue;
        await prisma.notificationEvent.deleteMany({
          where: { OR: [{ order: { userId: user.id } }, { request: { userId: user.id } }] },
        });
        await prisma.order.deleteMany({ where: { userId: user.id } });
        await prisma.watchJob.deleteMany({ where: { request: { userId: user.id } } });
        await prisma.shortlistSnapshot.deleteMany({
          where: { request: { userId: user.id } },
        });
        await prisma.ticketRequest.deleteMany({ where: { userId: user.id } });
        await prisma.platformCredential.deleteMany({ where: { userId: user.id } });
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

  it("register primary + other user + travelers", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password: "password123", name: "WDC Primary" },
    });
    assert.equal(reg.statusCode, 200, reg.body);
    token = reg.json().token;

    const reg2 = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: emailOther, password: "password123", name: "WDC Other" },
    });
    assert.equal(reg2.statusCode, 200, reg2.body);
    tokenOther = reg2.json().token;

    const a = await app.inject({
      method: "POST",
      url: "/travelers",
      headers: auth(),
      payload: {
        name: "测试甲",
        idType: "id_card",
        idNumber: ID_A,
        relationship: "self",
        type: "adult",
      },
    });
    assert.equal(a.statusCode, 201, a.body);
    travelerA = a.json().id;

    const b = await app.inject({
      method: "POST",
      url: "/travelers",
      headers: auth(),
      payload: {
        name: "测试乙",
        idType: "id_card",
        idNumber: ID_B,
        relationship: "authorized",
        authorizedConsent: true,
        type: "adult",
      },
    });
    assert.equal(b.statusCode, 201, b.body);
    travelerB = b.json().id;

    const c = await app.inject({
      method: "POST",
      url: "/travelers",
      headers: auth(tokenOther),
      payload: {
        name: "测试丙",
        idType: "id_card",
        idNumber: ID_C,
        relationship: "self",
        type: "adult",
      },
    });
    assert.equal(c.statusCode, 201, c.body);
    travelerOther = c.json().id;
  });

  it("preferred train with no match → 400 NO_MATCHING_SHORTLIST; no order", async () => {
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
    const rid = req.json().id as string;
    requestIds.push(rid);

    const search = await app.inject({
      method: "POST",
      url: `/requests/${rid}/search`,
      headers: auth(),
      payload: {},
    });
    assert.equal(search.statusCode, 200, search.body);

    const watch = await app.inject({
      method: "POST",
      url: `/requests/${rid}/watch`,
      headers: auth(),
      payload: {
        intervalMinutes: 15,
        travelerIds: [travelerA, travelerB],
        preferences: { preferredTrains: ["Z9999NOMATCH"] },
      },
    });
    assert.equal(watch.statusCode, 201, watch.body);
    const wid = watch.json().id as string;
    watchIds.push(wid);

    const before = await prisma.order.count({
      where: { userId: (await prisma.user.findUniqueOrThrow({ where: { email } })).id },
    });

    const created = await app.inject({
      method: "POST",
      url: `/grabs/${wid}/create-order`,
      headers: auth(),
      payload: {},
    });
    assert.equal(created.statusCode, 400, created.body);
    const body = created.json() as { code?: string; error?: string };
    assert.equal(body.code, "NO_MATCHING_SHORTLIST");
    assert.match(String(body.error ?? ""), /无符合项/);

    const after = await prisma.order.count({
      where: { userId: (await prisma.user.findUniqueOrThrow({ where: { email } })).id },
    });
    assert.equal(after, before, "no order created on pref miss");
  });

  it("preferred seat with no match → 400 NO_MATCHING_SHORTLIST", async () => {
    const req = await app.inject({
      method: "POST",
      url: "/requests",
      headers: auth(),
      payload: {
        channel: "train",
        fields: { from: "北京南", to: "上海虹桥", date: "2026-10-02", passengers: 1 },
      },
    });
    assert.equal(req.statusCode, 201, req.body);
    const rid = req.json().id as string;
    requestIds.push(rid);

    await app.inject({
      method: "POST",
      url: `/requests/${rid}/search`,
      headers: auth(),
      payload: {},
    });

    const watch = await app.inject({
      method: "POST",
      url: `/requests/${rid}/watch`,
      headers: auth(),
      payload: {
        intervalMinutes: 15,
        travelerIds: [travelerA],
        preferences: { preferredSeats: ["硬卧卧铺不存在XYZ"] },
      },
    });
    assert.equal(watch.statusCode, 201, watch.body);
    watchIds.push(watch.json().id);

    const created = await app.inject({
      method: "POST",
      url: `/grabs/${watch.json().id}/create-order`,
      headers: auth(),
      payload: {},
    });
    assert.equal(created.statusCode, 400, created.body);
    assert.equal(created.json().code, "NO_MATCHING_SHORTLIST");
  });

  it("sold-out-only shortlist → 400; does not pick sold_out as success", async () => {
    const req = await app.inject({
      method: "POST",
      url: "/requests",
      headers: auth(),
      payload: {
        channel: "train",
        fields: { from: "北京南", to: "上海虹桥", date: "2026-10-03", passengers: 1 },
      },
    });
    assert.equal(req.statusCode, 201, req.body);
    const rid = req.json().id as string;
    requestIds.push(rid);

    await prisma.shortlistSnapshot.create({
      data: {
        requestId: rid,
        provider: "fixture",
        mode: "fixture",
        liveOk: true,
        items: [
          {
            id: "sold-only-1",
            channel: "train",
            title: "G1001 sold",
            availability: "sold_out",
            meta: { trainNo: "G1001", seatClass: "二等座" },
          },
        ],
        notes: "test sold-out-only",
      },
    });

    const watch = await app.inject({
      method: "POST",
      url: `/requests/${rid}/watch`,
      headers: auth(),
      payload: {
        intervalMinutes: 15,
        travelerIds: [travelerA],
      },
    });
    assert.equal(watch.statusCode, 201, watch.body);
    const wid = watch.json().id as string;
    watchIds.push(wid);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const before = await prisma.order.count({ where: { userId: user.id } });

    const created = await app.inject({
      method: "POST",
      url: `/grabs/${wid}/create-order`,
      headers: auth(),
      payload: {},
    });
    assert.equal(created.statusCode, 400, created.body);
    assert.equal(created.json().code, "NO_MATCHING_SHORTLIST");

    const after = await prisma.order.count({ where: { userId: user.id } });
    assert.equal(after, before);
  });

  it("concurrent create-order → exactly ONE draft for same combo", async () => {
    const req = await app.inject({
      method: "POST",
      url: "/requests",
      headers: auth(),
      payload: {
        channel: "train",
        fields: { from: "北京南", to: "上海虹桥", date: "2026-10-04", passengers: 2 },
      },
    });
    assert.equal(req.statusCode, 201, req.body);
    const rid = req.json().id as string;
    requestIds.push(rid);

    const search = await app.inject({
      method: "POST",
      url: `/requests/${rid}/search`,
      headers: auth(),
      payload: {},
    });
    assert.equal(search.statusCode, 200, search.body);
    const items = search.json().result.items as { id: string }[];
    assert.ok(items.length > 0);

    const watch = await app.inject({
      method: "POST",
      url: `/requests/${rid}/watch`,
      headers: auth(),
      payload: {
        intervalMinutes: 15,
        travelerIds: [travelerA, travelerB],
      },
    });
    assert.equal(watch.statusCode, 201, watch.body);
    const wid = watch.json().id as string;
    watchIds.push(wid);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const before = await prisma.order.count({
      where: { userId: user.id, requestId: rid, status: { in: ["draft", "awaiting_login"] } },
    });

    const [r1, r2, r3] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/grabs/${wid}/create-order`,
        headers: auth(),
        payload: {},
      }),
      app.inject({
        method: "POST",
        url: `/grabs/${wid}/create-order`,
        headers: auth(),
        payload: {},
      }),
      app.inject({
        method: "POST",
        url: `/grabs/${wid}/create-order`,
        headers: auth(),
        payload: {},
      }),
    ]);

    for (const r of [r1, r2, r3]) {
      assert.ok([200, 201].includes(r.statusCode), r.body);
    }
    const ids = [r1, r2, r3].map((r) => (r.json() as { orderId: string }).orderId);
    assert.equal(new Set(ids).size, 1, `expected one orderId, got ${ids.join(",")}`);
    const reusedFlags = [r1, r2, r3].map((r) => (r.json() as { reused: boolean }).reused);
    assert.ok(reusedFlags.filter((x) => x === false).length <= 1);
    assert.ok(reusedFlags.some((x) => x === true) || reusedFlags.every((x) => x === false));

    const after = await prisma.order.count({
      where: { userId: user.id, requestId: rid, status: { in: ["draft", "awaiting_login"] } },
    });
    assert.equal(after - before, 1, `DB must have exactly one new draft, got ${after - before}`);

    // Different watch on same user must NOT share that draft
    const req2 = await app.inject({
      method: "POST",
      url: "/requests",
      headers: auth(),
      payload: {
        channel: "train",
        fields: { from: "北京南", to: "上海虹桥", date: "2026-10-05", passengers: 2 },
      },
    });
    const rid2 = req2.json().id as string;
    requestIds.push(rid2);
    await app.inject({
      method: "POST",
      url: `/requests/${rid2}/search`,
      headers: auth(),
      payload: {},
    });
    const watch2 = await app.inject({
      method: "POST",
      url: `/requests/${rid2}/watch`,
      headers: auth(),
      payload: {
        intervalMinutes: 15,
        travelerIds: [travelerA, travelerB],
      },
    });
    const wid2 = watch2.json().id as string;
    watchIds.push(wid2);

    const otherWatchOrder = await app.inject({
      method: "POST",
      url: `/grabs/${wid2}/create-order`,
      headers: auth(),
      payload: {},
    });
    assert.equal(otherWatchOrder.statusCode, 201, otherWatchOrder.body);
    assert.notEqual(
      (otherWatchOrder.json() as { orderId: string }).orderId,
      ids[0],
      "different watch must not reuse first draft"
    );

    // Different user must not share
    const reqO = await app.inject({
      method: "POST",
      url: "/requests",
      headers: auth(tokenOther),
      payload: {
        channel: "train",
        fields: { from: "北京南", to: "上海虹桥", date: "2026-10-06", passengers: 1 },
      },
    });
    const ridO = reqO.json().id as string;
    requestIds.push(ridO);
    await app.inject({
      method: "POST",
      url: `/requests/${ridO}/search`,
      headers: auth(tokenOther),
      payload: {},
    });
    const watchO = await app.inject({
      method: "POST",
      url: `/requests/${ridO}/watch`,
      headers: auth(tokenOther),
      payload: {
        intervalMinutes: 15,
        travelerIds: [travelerOther],
      },
    });
    const widO = watchO.json().id as string;
    watchIds.push(widO);
    const otherUserOrder = await app.inject({
      method: "POST",
      url: `/grabs/${widO}/create-order`,
      headers: auth(tokenOther),
      payload: {},
    });
    assert.equal(otherUserOrder.statusCode, 201, otherUserOrder.body);
    assert.notEqual((otherUserOrder.json() as { orderId: string }).orderId, ids[0]);
  });
});
