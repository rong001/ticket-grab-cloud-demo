import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.js";
import { prisma } from "./lib/prisma.js";

/** Synthetic checksum-valid IDs only — never real people. */
const ID_A = "110105199003074018";
const ID_B = "110101199001011237";

/**
 * train-order-assist-gate-loop:
 * 2 travelers → draft order → submit with TRAIN_REAL_SUBMIT=0 → honest 403
 * + gate-on / no session → awaiting_login
 * No live 12306 confirm network calls on gated path.
 */
describe("train-order-assist-gate-loop", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token = "";
  const email = `train-gate-${Date.now()}@example.com`;
  let travelerA = "";
  let travelerB = "";
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
    process.env.BOOKING_STUB = "0"; // force non-stub so route gate applies
    delete process.env.TRAIN_REAL_SUBMIT;
    delete process.env.TRAIN_SUBMIT_ENABLED;
    process.env.ALLOW_PUBLIC_REGISTER = "1";
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-encryption-key-train-gate";

    originalFetch = globalThis.fetch;
    fetchCalls = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
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
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        await prisma.notificationEvent.deleteMany({
          where: { order: { userId: user.id } },
        });
        await prisma.order.deleteMany({ where: { userId: user.id } });
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
    await prisma.$disconnect();
  });

  function auth() {
    return { authorization: `Bearer ${token}` };
  }

  it("health reports trainRealSubmit=false", async () => {
    const h = await app.inject({ method: "GET", url: "/health" });
    assert.equal(h.statusCode, 200, h.body);
    const j = h.json() as { trainRealSubmit?: boolean; bookingStub?: boolean };
    assert.equal(j.trainRealSubmit, false);
    assert.equal(j.bookingStub, false);
  });

  it("register + 2 travelers (synthetic IDs)", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password: "password123", name: "Train Gate" },
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
    assert.equal(a.json().idNumber, undefined);

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
    assert.equal(b.json().relationship, "authorized");
  });

  it("create order with 2 travelerIds → submit → TRAIN_REAL_SUBMIT_DISABLED", async () => {
    fetchCalls = [];
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
    const requestId = req.json().id as string;

    const search = await app.inject({
      method: "POST",
      url: `/requests/${requestId}/search`,
      headers: auth(),
      payload: {},
    });
    assert.equal(search.statusCode, 200, search.body);
    const items = search.json().result.items as { id: string }[];
    assert.ok(items.length > 0);

    const orderRes = await app.inject({
      method: "POST",
      url: `/requests/${requestId}/orders`,
      headers: auth(),
      payload: {
        selectedShortlistItemId: items[0].id,
        travelerIds: [travelerA, travelerB],
      },
    });
    assert.equal(orderRes.statusCode, 201, orderRes.body);
    const orderId = orderRes.json().id as string;
    assert.ok(["draft", "awaiting_login"].includes(orderRes.json().status));
    assert.deepEqual(orderRes.json().travelerIds, [travelerA, travelerB]);

    const before12306 = fetchCalls.filter((u) => /12306|kyfw/.test(u)).length;

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
      order?: { status: string; externalOrderId?: string | null };
    };
    assert.equal(body.code, "TRAIN_REAL_SUBMIT_DISABLED");
    assert.equal(body.trainRealSubmit, false);
    assert.ok(Array.isArray(body.nextSteps) && body.nextSteps.length >= 4);
    assert.ok(body.nextSteps.some((s) => /账号绑定|accounts/i.test(s)));
    assert.ok(body.nextSteps.some((s) => /验证码|短信/.test(s)));
    assert.ok(body.nextSteps.some((s) => /TRAIN_REAL_SUBMIT/.test(s)));
    assert.ok(body.nextSteps.some((s) => /支付|官方/.test(s)));
    assert.ok(["draft", "awaiting_login", "failed"].includes(body.status));
    assert.ok(!["paid", "候补成功", "awaiting_payment"].includes(body.status));
    assert.ok(!body.order?.externalOrderId);

    const after12306 = fetchCalls.filter((u) => /12306|kyfw/.test(u)).length;
    assert.equal(after12306, before12306, "gated submit must not hit 12306 network");

    const detail = await app.inject({
      method: "GET",
      url: `/orders/${orderId}`,
      headers: auth(),
    });
    assert.equal(detail.statusCode, 200, detail.body);
    const d = detail.json() as {
      status: string;
      errorMessage?: string | null;
      payload?: { nextSteps?: string[]; gate?: { code?: string } };
      travelers?: { name: string; idNumberHint?: string; relationship?: string; idNumber?: string }[];
    };
    assert.ok(["draft", "awaiting_login", "failed"].includes(d.status));
    assert.equal(d.errorMessage, "TRAIN_REAL_SUBMIT_DISABLED");
    assert.equal(d.payload?.gate?.code, "TRAIN_REAL_SUBMIT_DISABLED");
    assert.ok((d.payload?.nextSteps?.length ?? 0) >= 4);
    assert.equal(d.travelers?.length, 2);
    for (const t of d.travelers ?? []) {
      assert.ok(t.name);
      assert.ok(t.idNumberHint);
      assert.ok(t.relationship === "self" || t.relationship === "authorized");
      assert.equal((t as { idNumber?: string }).idNumber, undefined);
      assert.equal((t as { idNumberEnc?: string }).idNumberEnc, undefined);
    }
  });

  it("gate on + no linked session → awaiting_login (no 12306 confirm)", async () => {
    process.env.TRAIN_REAL_SUBMIT = "1";
    fetchCalls = [];

    const req = await app.inject({
      method: "POST",
      url: "/requests",
      headers: auth(),
      payload: {
        channel: "train",
        fields: { from: "北京南", to: "上海虹桥", date: "2026-11-01", passengers: 2 },
      },
    });
    assert.equal(req.statusCode, 201, req.body);
    const requestId = req.json().id as string;
    const search = await app.inject({
      method: "POST",
      url: `/requests/${requestId}/search`,
      headers: auth(),
      payload: {},
    });
    const itemId = (search.json().result.items as { id: string }[])[0].id;

    const orderRes = await app.inject({
      method: "POST",
      url: `/requests/${requestId}/orders`,
      headers: auth(),
      payload: {
        selectedShortlistItemId: itemId,
        travelerIds: [travelerA, travelerB],
      },
    });
    assert.equal(orderRes.statusCode, 201, orderRes.body);
    const orderId = orderRes.json().id as string;
    // create may already set awaiting_login when unlinked
    assert.ok(["draft", "awaiting_login"].includes(orderRes.json().status));

    const submit = await app.inject({
      method: "POST",
      url: `/orders/${orderId}/submit`,
      headers: auth(),
      payload: {},
    });
    assert.equal(submit.statusCode, 200, submit.body);
    assert.equal(submit.json().status, "awaiting_login");
    const payload = submit.json().payload as { nextSteps?: string[] } | undefined;
    // GET for full nextSteps
    const detail = await app.inject({
      method: "GET",
      url: `/orders/${orderId}`,
      headers: auth(),
    });
    const steps = (detail.json().payload as { nextSteps?: string[] })?.nextSteps ?? [];
    assert.ok(steps.some((s) => /登录|会话|验证码/.test(s)), JSON.stringify(steps));
    assert.ok(
      !fetchCalls.some((u) => /confirmSingleForQueue|submitOrderRequest/.test(u)),
      "no 12306 order confirm without session"
    );

    delete process.env.TRAIN_REAL_SUBMIT;
  });
});
