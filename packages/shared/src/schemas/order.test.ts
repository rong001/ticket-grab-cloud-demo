import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertTransition,
  canTransition,
  channelToPlatform,
  createOrderSchema,
  orderStatusSchema,
  platformsForChannel,
} from "./order.js";
import {
  createTravelerSchema,
  idNumberHint,
  validateTravelerIdNumber,
} from "./traveler.js";
import { prepareCheckout, submitOrder } from "../booking/index.js";

describe("order state machine", () => {
  it("allows draft → awaiting_login / submitting / cancelled", () => {
    assert.equal(canTransition("draft", "awaiting_login"), true);
    assert.equal(canTransition("draft", "submitting"), true);
    assert.equal(canTransition("draft", "cancelled"), true);
    assert.equal(canTransition("draft", "paid"), false);
  });

  it("allows submitting → awaiting_payment / 候补中 / awaiting_login", () => {
    assert.equal(canTransition("submitting", "awaiting_payment"), true);
    assert.equal(canTransition("submitting", "候补中"), true);
    assert.equal(canTransition("submitting", "awaiting_login"), true);
    assert.throws(() => assertTransition("paid", "draft"));
  });

  it("parses all status labels including 候补中", () => {
    assert.equal(orderStatusSchema.parse("候补中"), "候补中");
  });

  it("maps channels to platforms", () => {
    assert.equal(channelToPlatform("train"), "12306");
    assert.equal(channelToPlatform("show"), "damai");
    assert.equal(channelToPlatform("flight"), "airline");
    assert.deepEqual(platformsForChannel("show"), ["damai", "maoyan"]);
    assert.deepEqual(platformsForChannel("flight"), ["airline"]);
  });

  it("validates create order body", () => {
    const ok = createOrderSchema.parse({
      selectedShortlistItemId: "item-1",
      travelerIds: ["t1"],
    });
    assert.equal(ok.travelerIds.length, 1);
    assert.throws(() =>
      createOrderSchema.parse({ selectedShortlistItemId: "x", travelerIds: [] })
    );
  });
});

describe("traveler validation", () => {
  it("accepts 18-digit id card", () => {
    const r = validateTravelerIdNumber("id_card", "11010519900307401X");
    assert.equal(r.ok, true);
  });

  it("rejects bad id card", () => {
    const r = validateTravelerIdNumber("id_card", "123");
    assert.equal(r.ok, false);
  });

  it("hints last 4", () => {
    assert.equal(idNumberHint("11010519900307401X"), "****401X");
  });

  it("parses create traveler schema", () => {
    const t = createTravelerSchema.parse({
      name: "张三",
      idType: "id_card",
      idNumber: "11010519900307401X",
      phone: "13800138000",
      type: "adult",
    });
    assert.equal(t.name, "张三");
  });
});

describe("booking adapters (honest)", () => {
  const travelers = [
    { id: "t1", name: "张三", idType: "id_card", idNumberHint: "****401X", type: "adult" as const },
  ];
  const item = { id: "i1", channel: "train" as const, title: "G100", availability: "available" as const, price: 100 };

  it("prepareCheckout without session → awaiting_login + checkout path", async () => {
    const r = await prepareCheckout({
      channel: "train",
      orderId: "ord12345678",
      shortlistItem: item,
      travelers,
      session: {
        platform: "12306",
        sessionStatus: "unlinked",
        hasEncryptedSession: false,
      },
      webBaseUrl: "http://localhost:3000",
    });
    assert.equal(r.status, "awaiting_login");
    assert.equal(r.requiresInteractiveLogin, true);
    assert.equal(r.checkoutPath, "/checkout/ord12345678");
    assert.ok(r.nextSteps.some((s) => s.includes("结账页")));
  });

  it("submit without session does not claim success", async () => {
    const r = await submitOrder({
      channel: "train",
      orderId: "ord12345678",
      shortlistItem: item,
      travelers,
      session: {
        platform: "12306",
        sessionStatus: "unlinked",
        hasEncryptedSession: false,
      },
      webBaseUrl: "http://localhost:3000",
    });
    assert.equal(r.status, "awaiting_login");
    assert.equal(r.confirmation?.confirmed, false);
    assert.equal(r.confirmation?.source, "none");
  });

  it("stub mode with linked session yields awaiting_payment + stub confirmation", async () => {
    const r = await submitOrder({
      channel: "train",
      orderId: "ord12345678",
      shortlistItem: item,
      travelers,
      session: {
        platform: "12306",
        sessionStatus: "linked",
        hasEncryptedSession: true,
      },
      webBaseUrl: "http://localhost:3000",
      stubMode: true,
    });
    assert.equal(r.status, "awaiting_payment");
    assert.equal(r.confirmation?.source, "stub");
    assert.equal(r.confirmation?.confirmed, true);
    assert.ok(r.externalOrderId?.startsWith("STUB-12306-"));
  });

  it("linked session without stub does not fake paid", async () => {
    const r = await submitOrder({
      channel: "train",
      orderId: "ord12345678",
      shortlistItem: item,
      travelers,
      session: {
        platform: "12306",
        sessionStatus: "linked",
        hasEncryptedSession: true,
      },
      webBaseUrl: "http://localhost:3000",
      stubMode: false,
    });
    assert.notEqual(r.status, "paid");
    assert.equal(r.confirmation?.confirmed, false);
  });
});


describe("show / flight booking adapters (parity)", () => {
  const travelers = [
    { id: "t1", name: "李四", idType: "id_card", idNumberHint: "****401X", type: "adult" as const },
  ];

  it("show sold_out + stub → 候补中 with STUB-SHOW-", async () => {
    const r = await submitOrder({
      channel: "show",
      orderId: "ordshow01",
      shortlistItem: {
        id: "show-vip",
        channel: "show",
        title: "演唱会 · VIP",
        availability: "sold_out",
        price: 1280,
        meta: { tier: "VIP", platform: "Damai" },
      },
      travelers,
      session: {
        platform: "damai",
        sessionStatus: "linked",
        hasEncryptedSession: true,
      },
      webBaseUrl: "http://localhost:3000",
      stubMode: true,
    });
    assert.equal(r.status, "候补中");
    assert.ok(r.externalOrderId?.startsWith("STUB-SHOW-"));
    assert.equal(r.confirmation?.source, "stub");
    assert.equal(r.confirmation?.fields?.waitlist, true);
  });

  it("show available + stub → awaiting_payment", async () => {
    const r = await submitOrder({
      channel: "show",
      orderId: "ordshow02",
      shortlistItem: {
        id: "show-b",
        channel: "show",
        title: "演唱会 · B区",
        availability: "available",
        price: 580,
        meta: { tier: "B" },
      },
      travelers,
      session: {
        platform: "maoyan",
        sessionStatus: "linked",
        hasEncryptedSession: true,
      },
      webBaseUrl: "http://localhost:3000",
      stubMode: true,
    });
    assert.equal(r.status, "awaiting_payment");
    assert.ok(r.externalOrderId?.startsWith("STUB-SHOW-"));
    assert.equal(r.confirmation?.fields?.waitlist, false);
  });

  it("show without session → awaiting_login", async () => {
    const r = await prepareCheckout({
      channel: "show",
      orderId: "ordshow03",
      shortlistItem: { id: "x", channel: "show", title: "x", availability: "available" },
      travelers,
      session: {
        platform: "damai",
        sessionStatus: "unlinked",
        hasEncryptedSession: false,
      },
      webBaseUrl: "http://localhost:3000",
    });
    assert.equal(r.status, "awaiting_login");
    assert.ok(r.nextSteps.some((s) => s.includes("大麦") || s.includes("猫眼")));
  });

  it("flight stub → awaiting_payment + STUB-FLT- + cabin field", async () => {
    const r = await submitOrder({
      channel: "flight",
      orderId: "ordflt001",
      shortlistItem: {
        id: "CA1801",
        channel: "flight",
        title: "CA1801 北京 → 上海",
        availability: "available",
        price: 860,
        meta: { flightNo: "CA1801", cabin: "economy" },
      },
      travelers,
      session: {
        platform: "airline",
        sessionStatus: "linked",
        hasEncryptedSession: true,
      },
      webBaseUrl: "http://localhost:3000",
      stubMode: true,
    });
    assert.equal(r.status, "awaiting_payment");
    assert.ok(r.externalOrderId?.startsWith("STUB-FLT-"));
    assert.equal(r.confirmation?.fields?.cabin, "economy");
    assert.ok(r.paymentPath?.includes("step=pay"));
  });

  it("flight without stub uses assistive handoff (not fake paid)", async () => {
    const r = await submitOrder({
      channel: "flight",
      orderId: "ordflt002",
      shortlistItem: {
        id: "CA1801",
        channel: "flight",
        title: "CA1801",
        availability: "available",
        price: 860,
      },
      travelers,
      session: {
        platform: "airline",
        sessionStatus: "linked",
        hasEncryptedSession: true,
      },
      webBaseUrl: "http://localhost:3000",
      stubMode: false,
    });
    // Real airline API unavailable — linked session still completes to awaiting_payment handoff.
    assert.equal(r.status, "awaiting_payment");
    assert.notEqual(r.status, "paid");
    assert.ok(r.externalOrderId?.startsWith("HAND-FLT-"));
    assert.equal(r.confirmation?.fields?.assistiveHandoff, true);
  });

  it("show without stub + linked + sold_out → 候补中 handoff", async () => {
    const r = await submitOrder({
      channel: "show",
      orderId: "ordshow04",
      shortlistItem: {
        id: "show-sold",
        channel: "show",
        title: "演唱会",
        availability: "sold_out",
        price: 480,
        meta: { tier: "看台" },
      },
      travelers,
      session: {
        platform: "damai",
        sessionStatus: "linked",
        hasEncryptedSession: true,
      },
      webBaseUrl: "http://localhost:3000",
      stubMode: false,
    });
    assert.equal(r.status, "候补中");
    assert.ok(r.externalOrderId?.startsWith("HAND-SHOW-"));
    assert.equal(r.confirmation?.fields?.assistiveHandoff, true);
    assert.equal(r.confirmation?.fields?.waitlist, true);
  });
});
