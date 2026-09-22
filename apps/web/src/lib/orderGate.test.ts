import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  gateInfoBanner,
  isPurchaseGateCode,
  resolveGateOffFromApiError,
  resolveGateOffFromOrderDetail,
} from "./orderGate.ts";

describe("orderGate mapping", () => {
  it("keeps FLIGHT_INVENTORY_UNAVAILABLE (does not collapse to SHOW)", () => {
    const g = resolveGateOffFromOrderDetail({
      errorMessage: "FLIGHT_INVENTORY_UNAVAILABLE",
      payload: { nextSteps: ["a"], notes: "flight note" },
    });
    assert.ok(g);
    assert.equal(g!.code, "FLIGHT_INVENTORY_UNAVAILABLE");
    assert.equal(g!.message, "flight note");
  });

  it("maps SHOW and TRAIN codes distinctly", () => {
    const show = resolveGateOffFromOrderDetail({
      payload: { gate: { code: "SHOW_AUTO_BUY_UNAVAILABLE" }, nextSteps: [] },
    });
    assert.equal(show!.code, "SHOW_AUTO_BUY_UNAVAILABLE");

    const train = resolveGateOffFromOrderDetail({
      payload: { gate: { code: "TRAIN_REAL_SUBMIT_DISABLED" }, nextSteps: [] },
    });
    assert.equal(train!.code, "TRAIN_REAL_SUBMIT_DISABLED");
  });

  it("generic 403 is not a purchase gate", () => {
    assert.equal(isPurchaseGateCode(undefined), false);
    assert.equal(isPurchaseGateCode("FORBIDDEN"), false);
    const g = resolveGateOffFromApiError({
      status: 403,
      code: "FORBIDDEN",
      message: "not yours",
      nextSteps: [],
    });
    assert.equal(g, null);
  });

  it("explicit gate codes from ApiError map correctly", () => {
    const g = resolveGateOffFromApiError({
      status: 403,
      code: "FLIGHT_AUTO_BUY_UNAVAILABLE",
      message: "gated",
      nextSteps: ["x"],
    });
    assert.equal(g!.code, "FLIGHT_AUTO_BUY_UNAVAILABLE");
    assert.match(gateInfoBanner(g!.code), /机票/);
  });
});
