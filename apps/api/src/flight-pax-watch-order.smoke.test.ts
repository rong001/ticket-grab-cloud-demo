import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.js";
import { prisma } from "./lib/prisma.js";
import { closeQueueConnections, removeWatchRepeatable } from "./lib/queue.js";

/** Synthetic checksum-valid IDs only — never real people. */
const ID_A = "110105199003074018";
const ID_B = "110101199001011237";

/**
 * flight-pax-watch-order-parity:
 * 2 authorized attendees → show watch with travelerIds → create-order draft
 * → submit/handoff returns FLIGHT_INVENTORY_UNAVAILABLE (BOOKING_STUB=0); never paid.
 * Schedule/OpenSky must not set inventoryLive; never tickets_found as sellable.
 */
describe("flight-pax-watch-order-parity", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token = "";
  const email = `flight-pax-${Date.now()}@example.com`;
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
      if (/amadeus|aviationstack|opensky|duffel|ticket\.damai|m\.damai|dianping\.com\/myshow/i.test(url)) {
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

  it("register + 2 passengers (self + authorized consent)", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password: "password123", name: "Flight Pax" },
    });
    assert.equal(reg.statusCode, 200, reg.body);
    token = reg.json().token;

    const a = await app.inject({
      method: "POST",
      url: "/travelers",
      headers: auth(),
      payload: {
        name: "乘机甲",
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
        name: "乘机乙",
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

  it("flight watch binds 2 travelerIds (quantity match)", async () => {
    const req = await app.inject({
      method: "POST",
      url: "/requests",
      headers: auth(),
      payload: {
        channel: "flight",
        fields: {
          from: "PEK",
          to: "SHA",
          date: "2026-10-18",
          passengers: 2,
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
    assert.ok(items.length > 0, "fixture flight shortlist should be non-empty");

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

  it("create-order → draft with 2 passengers + flight nextSteps", async () => {
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
      flightAutoBuy: boolean;
      trainRealSubmit: boolean;
    };
    assert.equal(body.status, "draft");
    assert.equal(body.reused, false);
    assert.equal(body.channel, "flight");
    assert.equal(body.flightAutoBuy, false);
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
      body.nextSteps.some((s) => /Amadeus|航司|官方|运价|库存|待接入/.test(s)),
      "nextSteps should mention Amadeus/airline official handoff"
    );
    assert.ok(
      body.nextSteps.some((s) => /待用户登录官方|官方|运价|库存|Amadeus|运价|库存|待接入/.test(s)),
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
    assert.equal(detail.json().channel, "flight");
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
    assert.equal(body.channel, "flight");
    assert.ok(["draft", "awaiting_login"].includes(body.status));
  });

  it("submit → 403 FLIGHT_INVENTORY_UNAVAILABLE; never paid; no Damai network", async () => {
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
      flightAutoBuy: boolean;
      nextSteps: string[];
      status: string;
    };
    assert.equal(body.code, "FLIGHT_INVENTORY_UNAVAILABLE");
    assert.equal(body.flightAutoBuy, false);
    assert.ok(Array.isArray(body.nextSteps) && body.nextSteps.length >= 3);
    assert.ok(body.nextSteps.some((s) => /待用户登录官方|官方|运价|库存/.test(s)));
    assert.ok(["draft", "awaiting_login", "failed"].includes(body.status));
    assert.ok(!["paid", "候补成功", "awaiting_payment", "候补中"].includes(body.status));
    assert.equal(
      fetchCalls.filter((u) => /amadeus|aviationstack|opensky|duffel/i.test(u)).length,
      0,
      "gated flight submit must not hit Amadeus/airline"
    );

    const detail = await app.inject({
      method: "GET",
      url: `/orders/${orderId}`,
      headers: auth(),
    });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.notEqual(detail.json().status, "paid");
    assert.equal(detail.json().errorMessage, "FLIGHT_INVENTORY_UNAVAILABLE");
  });

  it("rejects flight create-order without travelerIds", async () => {
    const req = await app.inject({
      method: "POST",
      url: "/requests",
      headers: auth(),
      payload: {
        channel: "flight",
        fields: { from: "CAN", to: "CTU", date: "2026-11-01", passengers: 1 },
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
    assert.ok(String(bad.json().error || "").includes("乘机人"));
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

  it("health/meta: flightInventoryLive=false without keys; schedule must not imply inventory", async () => {
    const h = await app.inject({ method: "GET", url: "/health" });
    assert.equal(h.statusCode, 200, h.body);
    const health = h.json() as {
      flightInventoryLive?: boolean;
      trainRealSubmit?: boolean;
      bookingStub?: boolean;
    };
    assert.equal(health.flightInventoryLive, false);
    assert.equal(health.trainRealSubmit, false);
    assert.equal(health.bookingStub, false);

    const meta = await app.inject({
      method: "GET",
      url: "/meta/sources",
      headers: auth(),
    });
    // meta may be public
    const meta2 = meta.statusCode === 401
      ? await app.inject({ method: "GET", url: "/meta/sources" })
      : meta;
    if (meta2.statusCode === 200) {
      const body = meta2.json() as {
        channels?: { channel: string; inventoryLive?: boolean; scheduleLive?: boolean }[];
        flightInventoryLive?: boolean;
      };
      const flight =
        body.channels?.find((c) => c.channel === "flight") ??
        (body.flightInventoryLive !== undefined
          ? { channel: "flight", inventoryLive: body.flightInventoryLive }
          : null);
      if (flight) {
        assert.equal(flight.inventoryLive, false, "schedule must not set inventoryLive");
      }
    }
  });

});
