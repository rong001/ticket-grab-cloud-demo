import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.js";
import { prisma } from "./lib/prisma.js";

/**
 * API smoke: register → traveler → request → search → create order → submit → list orders
 * Covers train + show (incl. 候补) + flight with BOOKING_STUB=1.
 * Requires Postgres.
 */
describe("in-system ops API smoke", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token = "";
  const email = `ops-smoke-${Date.now()}@example.com`;
  let travelerId = "";

  before(async () => {
    process.env.PROVIDER_MODE = "fixture";
    process.env.BOOKING_STUB = "1";
    process.env.ALLOW_PUBLIC_REGISTER = "1";
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-encryption-key-ops";
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function authHeaders() {
    return { authorization: `Bearer ${token}` };
  }

  it("register + traveler", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password: "password123", name: "Ops Smoke" },
    });
    assert.equal(reg.statusCode, 200);
    token = reg.json().token;
    assert.ok(token);

    const traveler = await app.inject({
      method: "POST",
      url: "/travelers",
      headers: await authHeaders(),
      payload: {
        name: "测试乘客",
        idType: "id_card",
        idNumber: "11010519900307401X",
        phone: "13800138000",
        type: "adult",
      },
    });
    assert.equal(traveler.statusCode, 201, traveler.body);
    travelerId = traveler.json().id as string;
    assert.ok(traveler.json().idNumberHint?.includes("401X"));
  });

  it("train path: search → link → order → submit → handoff", async () => {
    const headers = await authHeaders();
    const req = await app.inject({
      method: "POST",
      url: "/requests",
      headers,
      payload: {
        channel: "train",
        fields: { from: "北京南", to: "上海虹桥", date: "2026-10-01", passengers: 1 },
      },
    });
    assert.equal(req.statusCode, 201, req.body);
    const requestId = req.json().id as string;

    const search = await app.inject({
      method: "POST",
      url: `/requests/${requestId}/search`,
      headers,
      payload: {},
    });
    assert.equal(search.statusCode, 200, search.body);
    const items = search.json().result.items as { id: string }[];
    assert.ok(items.length > 0);
    const itemId = items[0].id;

    const link = await app.inject({
      method: "POST",
      url: "/platforms/link/complete",
      headers,
      payload: { platform: "12306", sessionToken: "smoke-session-cookie" },
    });
    assert.equal(link.statusCode, 200, link.body);
    assert.equal(link.json().sessionStatus, "linked");

    const orderRes = await app.inject({
      method: "POST",
      url: `/requests/${requestId}/orders`,
      headers,
      payload: { selectedShortlistItemId: itemId, travelerIds: [travelerId] },
    });
    assert.equal(orderRes.statusCode, 201, orderRes.body);
    const orderId = orderRes.json().id as string;
    assert.ok(["draft", "awaiting_login"].includes(orderRes.json().status));

    const submit = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/submit`,
      headers,
      payload: {},
    });
    assert.equal(submit.statusCode, 200, submit.body);
    assert.equal(submit.json().status, "awaiting_payment");
    assert.ok(String(submit.json().externalOrderId || "").startsWith("STUB-"));

    const list = await app.inject({
      method: "GET",
      url: "/orders?channel=train",
      headers,
    });
    assert.equal(list.statusCode, 200);
    assert.ok((list.json() as { id: string }[]).some((o) => o.id === orderId));

    const handoff = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/payment-handoff`,
      headers,
      payload: {},
    });
    assert.equal(handoff.statusCode, 200, handoff.body);
    assert.ok(String(handoff.json().paymentPath).includes(`/checkout/${orderId}`));
    assert.ok(
      (handoff.json().instructions as string[]).some((s) => s.includes("本产品"))
    );
  });

  it("show path: search → link damai → order available → submit awaiting_payment", async () => {
    const headers = await authHeaders();
    const req = await app.inject({
      method: "POST",
      url: "/requests",
      headers,
      payload: {
        channel: "show",
        fields: { eventName: "测试演唱会", city: "上海", date: "2026-10-18", quantity: 1 },
      },
    });
    assert.equal(req.statusCode, 201, req.body);
    const requestId = req.json().id as string;

    const search = await app.inject({
      method: "POST",
      url: `/requests/${requestId}/search`,
      headers,
      payload: {},
    });
    assert.equal(search.statusCode, 200, search.body);
    const items = search.json().result.items as {
      id: string;
      availability: string;
      meta?: { tier?: string };
    }[];
    assert.ok(items.length > 0);

    const available = items.find((i) => i.availability === "available") ?? items[items.length - 1];
    assert.ok(available);

    const link = await app.inject({
      method: "POST",
      url: "/platforms/link/complete",
      headers,
      payload: { platform: "damai", sessionToken: "smoke-damai-session" },
    });
    assert.equal(link.statusCode, 200, link.body);
    assert.equal(link.json().sessionStatus, "linked");

    const orderRes = await app.inject({
      method: "POST",
      url: `/requests/${requestId}/orders`,
      headers,
      payload: {
        selectedShortlistItemId: available.id,
        travelerIds: [travelerId],
        preferredPlatform: "damai",
      },
    });
    assert.equal(orderRes.statusCode, 201, orderRes.body);
    const orderId = orderRes.json().id as string;

    const submit = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/submit`,
      headers,
      payload: {},
    });
    assert.equal(submit.statusCode, 200, submit.body);
    assert.equal(submit.json().status, "awaiting_payment");
    assert.ok(String(submit.json().externalOrderId || "").startsWith("STUB-SHOW-"));

    const list = await app.inject({
      method: "GET",
      url: "/orders?channel=show",
      headers,
    });
    assert.equal(list.statusCode, 200);
    assert.ok((list.json() as { id: string; channel: string }[]).every((o) => o.channel === "show"));
    assert.ok((list.json() as { id: string }[]).some((o) => o.id === orderId));

    const handoff = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/payment-handoff`,
      headers,
      payload: {},
    });
    assert.equal(handoff.statusCode, 200, handoff.body);
    assert.ok(
      (handoff.json().instructions as string[]).some(
        (s) => s.includes("大麦") || s.includes("猫眼")
      )
    );
  });

  it("show waitlist path: sold_out item → 候补中", async () => {
    const headers = await authHeaders();
    const req = await app.inject({
      method: "POST",
      url: "/requests",
      headers,
      payload: {
        channel: "show",
        fields: { eventName: "候补演唱会", city: "上海", date: "2026-10-18", quantity: 1 },
      },
    });
    assert.equal(req.statusCode, 201, req.body);
    const requestId = req.json().id as string;

    const search = await app.inject({
      method: "POST",
      url: `/requests/${requestId}/search`,
      headers,
      payload: {},
    });
    assert.equal(search.statusCode, 200, search.body);
    const items = search.json().result.items as { id: string; availability: string }[];
    const soldOut = items.find((i) => i.availability === "sold_out" || i.availability === "waitlist");
    assert.ok(soldOut, "fixture should include sold_out VIP tier");

    // maoyan link also works for show
    const link = await app.inject({
      method: "POST",
      url: "/platforms/link/complete",
      headers,
      payload: { platform: "maoyan", sessionToken: "smoke-maoyan-session" },
    });
    assert.equal(link.statusCode, 200, link.body);

    const orderRes = await app.inject({
      method: "POST",
      url: `/requests/${requestId}/orders`,
      headers,
      payload: {
        selectedShortlistItemId: soldOut.id,
        travelerIds: [travelerId],
        preferredPlatform: "maoyan",
      },
    });
    assert.equal(orderRes.statusCode, 201, orderRes.body);
    const orderId = orderRes.json().id as string;

    const submit = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/submit`,
      headers,
      payload: {},
    });
    assert.equal(submit.statusCode, 200, submit.body);
    assert.equal(submit.json().status, "候补中");
    assert.ok(String(submit.json().externalOrderId || "").startsWith("STUB-SHOW-"));
  });

  it("flight path: search → link airline → order → submit → handoff", async () => {
    const headers = await authHeaders();
    const req = await app.inject({
      method: "POST",
      url: "/requests",
      headers,
      payload: {
        channel: "flight",
        fields: { from: "北京", to: "上海", date: "2026-10-01", cabin: "economy", passengers: 1 },
      },
    });
    assert.equal(req.statusCode, 201, req.body);
    const requestId = req.json().id as string;

    const search = await app.inject({
      method: "POST",
      url: `/requests/${requestId}/search`,
      headers,
      payload: {},
    });
    assert.equal(search.statusCode, 200, search.body);
    const items = search.json().result.items as { id: string; meta?: { cabin?: string } }[];
    assert.ok(items.length > 0);
    const itemId = items[0].id;

    const link = await app.inject({
      method: "POST",
      url: "/platforms/link/complete",
      headers,
      payload: { platform: "airline", sessionToken: "smoke-airline-session" },
    });
    assert.equal(link.statusCode, 200, link.body);
    assert.equal(link.json().sessionStatus, "linked");

    const orderRes = await app.inject({
      method: "POST",
      url: `/requests/${requestId}/orders`,
      headers,
      payload: { selectedShortlistItemId: itemId, travelerIds: [travelerId] },
    });
    assert.equal(orderRes.statusCode, 201, orderRes.body);
    const orderId = orderRes.json().id as string;

    const submit = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/submit`,
      headers,
      payload: {},
    });
    assert.equal(submit.statusCode, 200, submit.body);
    assert.equal(submit.json().status, "awaiting_payment");
    assert.ok(String(submit.json().externalOrderId || "").startsWith("STUB-FLT-"));

    const list = await app.inject({
      method: "GET",
      url: "/orders?channel=flight",
      headers,
    });
    assert.equal(list.statusCode, 200);
    assert.ok((list.json() as { id: string }[]).some((o) => o.id === orderId));

    const handoff = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/payment-handoff`,
      headers,
      payload: {},
    });
    assert.equal(handoff.statusCode, 200, handoff.body);
    assert.ok(
      (handoff.json().instructions as string[]).some((s) => s.includes("航司") || s.includes("OTA"))
    );

    const detail = await app.inject({
      method: "GET",
      url: `/orders/${orderId}`,
      headers,
    });
    assert.equal(detail.statusCode, 200);
    assert.ok(Array.isArray(detail.json().timeline));
    assert.ok(detail.json().timeline.length >= 1);
  });

  it("rejects order when travelers missing", async () => {
    const headers = await authHeaders();
    const req = await app.inject({
      method: "POST",
      url: "/requests",
      headers,
      payload: {
        channel: "flight",
        fields: { from: "广州", to: "深圳", date: "2026-11-01" },
      },
    });
    const requestId = req.json().id as string;
    await app.inject({
      method: "POST",
      url: `/requests/${requestId}/search`,
      headers,
      payload: {},
    });
    const search = await app.inject({
      method: "POST",
      url: `/requests/${requestId}/search`,
      headers,
      payload: {},
    });
    const itemId = (search.json().result.items as { id: string }[])[0].id;

    const bad = await app.inject({
      method: "POST",
      url: `/requests/${requestId}/orders`,
      headers,
      payload: { selectedShortlistItemId: itemId, travelerIds: [] },
    });
    assert.ok(bad.statusCode === 400 || bad.statusCode === 500);
  });
});
