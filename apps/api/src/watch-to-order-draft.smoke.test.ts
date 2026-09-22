import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.js";
import { prisma } from "./lib/prisma.js";
import { closeQueueConnections, removeWatchRepeatable } from "./lib/queue.js";

/** Synthetic checksum-valid IDs only — never real people. */
const ID_A = "110105199003074018";
const ID_B = "110101199001011237";

/**
 * watch-to-order-draft:
 * watch with 2 travelerIds + shortlist → POST /grabs/:id/create-order → draft
 * with both pax → submit still 403 TRAIN_REAL_SUBMIT_DISABLED (no live 12306).
 */
describe("watch-to-order-draft", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token = "";
  const email = `watch-draft-${Date.now()}@example.com`;
  let travelerA = "";
  let travelerB = "";
  let requestId = "";
  let watchJobId = "";
  let orderId = "";
  let fetchCalls: string[] = [];
  let originalFetch: typeof globalThis.fetch;
  const prev = {
    PROVIDER_MODE: process.env.PROVIDER_MODE,
    BOOKING_STUB: process.env.BOOKING_STUB,
    TRAIN_REAL_SUBMIT: process.env.TRAIN_REAL_SUBMIT,
    TRAIN_SUBMIT_ENABLED: process.env.TRAIN_SUBMIT_ENABLED,
  };

  before(async () => {
    process.env.PROVIDER_MODE = "fixture";
    process.env.BOOKING_STUB = "0";
    delete process.env.TRAIN_REAL_SUBMIT;
    delete process.env.TRAIN_SUBMIT_ENABLED;
    process.env.ALLOW_PUBLIC_REGISTER = "1";
    process.env.ENCRYPTION_KEY =
      process.env.ENCRYPTION_KEY || "test-encryption-key-watch-draft";

    originalFetch = globalThis.fetch;
    fetchCalls = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      fetchCalls.push(url);
      if (/12306|kyfw\.12306/.test(url)) {
        throw new Error(`UNEXPECTED_12306_NETWORK: ${url}`);
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    globalThis.fetch = originalFetch;
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
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        await prisma.notificationEvent.deleteMany({
          where: { OR: [{ order: { userId: user.id } }, { request: { userId: user.id } }] },
        });
        await prisma.order.deleteMany({ where: { userId: user.id } });
        await prisma.watchJob.deleteMany({
          where: { request: { userId: user.id } },
        });
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
      /* ignore cleanup errors */
    }
    await app.close();
    await closeQueueConnections();
    await prisma.$disconnect();
  });

  function auth() {
    return { authorization: `Bearer ${token}` };
  }

  it("health trainRealSubmit=false", async () => {
    const h = await app.inject({ method: "GET", url: "/health" });
    assert.equal(h.statusCode, 200, h.body);
    const j = h.json() as { trainRealSubmit?: boolean };
    assert.equal(j.trainRealSubmit, false);
  });

  it("register + 2 travelers (synthetic IDs)", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password: "password123", name: "Watch Draft" },
    });
    assert.equal(reg.statusCode, 200, reg.body);
    token = reg.json().token;

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
    assert.ok(String(a.json().idNumberHint || "").includes("4018"));

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
  });

  it("watch with 2 travelers + shortlist → create-order draft", async () => {
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
    requestId = req.json().id as string;

    const search = await app.inject({
      method: "POST",
      url: `/requests/${requestId}/search`,
      headers: auth(),
      payload: {},
    });
    assert.equal(search.statusCode, 200, search.body);
    const items = search.json().result.items as { id: string }[];
    assert.ok(items.length > 0, "fixture shortlist should be non-empty");

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
    watchJobId = watch.json().id as string;
    assert.deepEqual(watch.json().travelerIds, [travelerA, travelerB]);

    const created = await app.inject({
      method: "POST",
      url: `/grabs/${watchJobId}/create-order`,
      headers: auth(),
      payload: {},
    });
    assert.equal(created.statusCode, 201, created.body);
    const body = created.json() as {
      orderId: string;
      status: string;
      reused: boolean;
      travelerIds: string[];
      travelers: { name: string; idNumberHint?: string; idNumber?: string }[];
      nextSteps: string[];
      orderPath: string;
      trainRealSubmit: boolean;
    };
    assert.equal(body.status, "draft");
    assert.equal(body.reused, false);
    assert.equal(body.trainRealSubmit, false);
    assert.deepEqual(body.travelerIds, [travelerA, travelerB]);
    assert.equal(body.travelers.length, 2);
    for (const t of body.travelers) {
      assert.ok(t.name);
      assert.ok(t.idNumberHint);
      assert.equal(t.idNumber, undefined);
    }
    assert.ok(body.nextSteps.length >= 3);
    assert.ok(body.orderPath.includes(body.orderId));
    orderId = body.orderId;

    const detail = await app.inject({
      method: "GET",
      url: `/orders/${orderId}`,
      headers: auth(),
    });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.equal(detail.json().status, "draft");
    assert.deepEqual(detail.json().travelerIds, [travelerA, travelerB]);
    assert.equal(detail.json().travelers?.length, 2);
  });

  it("create-order is idempotent for same watch+item", async () => {
    const again = await app.inject({
      method: "POST",
      url: `/grabs/${watchJobId}/create-order`,
      headers: auth(),
      payload: {},
    });
    assert.ok([200, 201].includes(again.statusCode), again.body);
    const body = again.json() as { orderId: string; reused: boolean; status: string };
    assert.equal(body.orderId, orderId);
    assert.equal(body.reused, true);
    assert.ok(["draft", "awaiting_login"].includes(body.status));
  });

  it("submit draft still 403 TRAIN_REAL_SUBMIT_DISABLED", async () => {
    fetchCalls = [];
    const submit = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/submit`,
      headers: auth(),
      payload: {},
    });
    assert.equal(submit.statusCode, 403, submit.body);
    const body = submit.json() as {
      code: string;
      trainRealSubmit: boolean;
      nextSteps: string[];
      status: string;
    };
    assert.equal(body.code, "TRAIN_REAL_SUBMIT_DISABLED");
    assert.equal(body.trainRealSubmit, false);
    assert.ok(Array.isArray(body.nextSteps) && body.nextSteps.length >= 3);
    assert.ok(["draft", "awaiting_login", "failed"].includes(body.status));
    assert.ok(!["paid", "候补成功", "awaiting_payment"].includes(body.status));
    assert.equal(
      fetchCalls.filter((u) => /12306|kyfw/.test(u)).length,
      0,
      "gated submit must not hit 12306"
    );
  });

  it("rejects create-order without travelerIds", async () => {
    const req = await app.inject({
      method: "POST",
      url: "/requests",
      headers: auth(),
      payload: {
        channel: "train",
        fields: { from: "北京南", to: "上海虹桥", date: "2026-11-01", passengers: 1 },
      },
    });
    assert.equal(req.statusCode, 201, req.body);
    const rid = req.json().id as string;
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
      payload: { intervalMinutes: 30 },
    });
    assert.equal(watch.statusCode, 201, watch.body);
    const wid = watch.json().id as string;
    const bad = await app.inject({
      method: "POST",
      url: `/grabs/${wid}/create-order`,
      headers: auth(),
      payload: {},
    });
    assert.equal(bad.statusCode, 400, bad.body);
    assert.equal(bad.json().code, "TRAVELER_IDS_REQUIRED");
    // cleanup this watch
    try {
      const job = await prisma.watchJob.findUnique({ where: { id: wid } });
      if (job) {
        await removeWatchRepeatable({
          id: job.id,
          intervalMinutes: job.intervalMinutes,
          endsAt: job.endsAt,
          bullJobId: job.bullJobId,
        });
      }
    } catch {
      /* ignore */
    }
  });
});
