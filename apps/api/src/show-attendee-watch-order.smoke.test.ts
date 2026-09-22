import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.js";
import { prisma } from "./lib/prisma.js";
import { closeQueueConnections, removeWatchRepeatable } from "./lib/queue.js";

/** Synthetic checksum-valid IDs only — never real people. */
const ID_A = "110105199003074018";
const ID_B = "110101199001011237";

/**
 * show-attendee-watch-order-parity:
 * 2 authorized attendees → show watch with travelerIds → create-order draft
 * → submit/handoff returns SHOW_AUTO_BUY_UNAVAILABLE (BOOKING_STUB=0); never paid.
 */
describe("show-attendee-watch-order-parity", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token = "";
  const email = `show-attendee-${Date.now()}@example.com`;
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
      process.env.ENCRYPTION_KEY || "test-encryption-key-show-attendee";

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
      if (/damai|maoyan|ticket\.damai|m\.damai|dianping\.com\/myshow/i.test(url)) {
        throw new Error(`UNEXPECTED_SHOW_NETWORK: ${url}`);
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

  it("register + 2 attendees (self + authorized consent)", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password: "password123", name: "Show Attendee" },
    });
    assert.equal(reg.statusCode, 200, reg.body);
    token = reg.json().token;

    const a = await app.inject({
      method: "POST",
      url: "/travelers",
      headers: auth(),
      payload: {
        name: "观演甲",
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
        name: "观演乙",
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

  it("show watch binds 2 travelerIds (quantity match)", async () => {
    const req = await app.inject({
      method: "POST",
      url: "/requests",
      headers: auth(),
      payload: {
        channel: "show",
        fields: {
          eventName: "测试演唱会",
          city: "上海",
          date: "2026-10-18",
          quantity: 2,
        },
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
    assert.ok(items.length > 0, "fixture show shortlist should be non-empty");

    const badCount = await app.inject({
      method: "POST",
      url: `/requests/${requestId}/watch`,
      headers: auth(),
      payload: { intervalMinutes: 15, travelerIds: [travelerA] },
    });
    assert.equal(badCount.statusCode, 400, badCount.body);

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
    assert.equal(watch.json().travelers?.length, 2);
  });

  it("create-order → draft with 2 attendees + show nextSteps", async () => {
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
      channel: string;
      travelerIds: string[];
      travelers: { name: string; idNumberHint?: string; idNumber?: string }[];
      nextSteps: string[];
      orderPath: string;
      showAutoBuy: boolean;
      trainRealSubmit: boolean;
    };
    assert.equal(body.status, "draft");
    assert.equal(body.reused, false);
    assert.equal(body.channel, "show");
    assert.equal(body.showAutoBuy, false);
    assert.equal(body.trainRealSubmit, false);
    assert.deepEqual(body.travelerIds, [travelerA, travelerB]);
    assert.equal(body.travelers.length, 2);
    for (const t of body.travelers) {
      assert.ok(t.name);
      assert.ok(t.idNumberHint);
      assert.equal(t.idNumber, undefined);
    }
    assert.ok(body.nextSteps.length >= 3);
    assert.ok(
      body.nextSteps.some((s) => /大麦|猫眼|官方/.test(s)),
      "nextSteps should mention Damai/Maoyan official handoff"
    );
    assert.ok(
      body.nextSteps.some((s) => /待用户登录官方|官方收银台/.test(s)),
      "nextSteps should list 待用户登录官方 pay condition"
    );
    assert.ok(body.orderPath.includes(body.orderId));
    orderId = body.orderId;

    const detail = await app.inject({
      method: "GET",
      url: `/orders/${orderId}`,
      headers: auth(),
    });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.equal(detail.json().status, "draft");
    assert.equal(detail.json().channel, "show");
    assert.deepEqual(detail.json().travelerIds, [travelerA, travelerB]);
    assert.equal(detail.json().travelers?.length, 2);
  });

  it("create-order idempotent for same show watch+item", async () => {
    const again = await app.inject({
      method: "POST",
      url: `/grabs/${watchJobId}/create-order`,
      headers: auth(),
      payload: {},
    });
    assert.ok([200, 201].includes(again.statusCode), again.body);
    const body = again.json() as { orderId: string; reused: boolean; status: string; channel: string };
    assert.equal(body.orderId, orderId);
    assert.equal(body.reused, true);
    assert.equal(body.channel, "show");
    assert.ok(["draft", "awaiting_login"].includes(body.status));
  });

  it("submit → 403 SHOW_AUTO_BUY_UNAVAILABLE; never paid; no Damai network", async () => {
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
      showAutoBuy: boolean;
      nextSteps: string[];
      status: string;
    };
    assert.equal(body.code, "SHOW_AUTO_BUY_UNAVAILABLE");
    assert.equal(body.showAutoBuy, false);
    assert.ok(Array.isArray(body.nextSteps) && body.nextSteps.length >= 3);
    assert.ok(body.nextSteps.some((s) => /待用户登录官方|官方/.test(s)));
    assert.ok(["draft", "awaiting_login", "failed"].includes(body.status));
    assert.ok(!["paid", "候补成功", "awaiting_payment", "候补中"].includes(body.status));
    assert.equal(
      fetchCalls.filter((u) => /damai|maoyan/i.test(u)).length,
      0,
      "gated show submit must not hit Damai/Maoyan"
    );

    const detail = await app.inject({
      method: "GET",
      url: `/orders/${orderId}`,
      headers: auth(),
    });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.notEqual(detail.json().status, "paid");
    assert.equal(detail.json().errorMessage, "SHOW_AUTO_BUY_UNAVAILABLE");
  });

  it("rejects show create-order without travelerIds", async () => {
    const req = await app.inject({
      method: "POST",
      url: "/requests",
      headers: auth(),
      payload: {
        channel: "show",
        fields: { eventName: "无观演人", city: "北京", date: "2026-11-01", quantity: 1 },
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
    assert.ok(String(bad.json().error || "").includes("观演人"));
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
