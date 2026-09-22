import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chineseIdChecksumOk,
  createTravelerSchema,
  idNumberHint,
  toPublicTraveler,
  validateTravelerIdNumber,
} from "./traveler.js";

/** Synthetic checksum-valid IDs (not real people). */
const VALID_A = "110105199003074018";
const VALID_B = "110101199001011237";
const INVALID_CHECKSUM = "11010519900307401X"; // same digits, wrong check char

describe("chineseIdChecksumOk / validateTravelerIdNumber", () => {
  it("accepts checksum-valid 18-digit IDs", () => {
    assert.equal(chineseIdChecksumOk(VALID_A), true);
    assert.equal(chineseIdChecksumOk(VALID_B), true);
    assert.equal(validateTravelerIdNumber("id_card", VALID_A).ok, true);
    assert.equal(validateTravelerIdNumber("id_card", VALID_B).ok, true);
  });

  it("rejects bad checksum", () => {
    assert.equal(chineseIdChecksumOk(INVALID_CHECKSUM), false);
    const r = validateTravelerIdNumber("id_card", INVALID_CHECKSUM);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /校验位|GB11643/);
  });

  it("rejects short / malformed id_card", () => {
    assert.equal(validateTravelerIdNumber("id_card", "123").ok, false);
    assert.equal(validateTravelerIdNumber("id_card", "abcdefghijklmnopqr").ok, false);
  });

  it("accepts legacy 15-digit format without checksum", () => {
    assert.equal(validateTravelerIdNumber("id_card", "110105900307401").ok, true);
  });

  it("soft-checks passport", () => {
    assert.equal(validateTravelerIdNumber("passport", "E12345678").ok, true);
    assert.equal(validateTravelerIdNumber("passport", "AB").ok, false);
  });
});

describe("authorized consent", () => {
  it("rejects authorized without consent", () => {
    assert.throws(() =>
      createTravelerSchema.parse({
        name: "测试乙",
        idType: "id_card",
        idNumber: VALID_B,
        relationship: "authorized",
        authorizedConsent: false,
      })
    );
  });

  it("accepts authorized with consent", () => {
    const t = createTravelerSchema.parse({
      name: "测试乙",
      idType: "id_card",
      idNumber: VALID_B,
      relationship: "authorized",
      authorizedConsent: true,
    });
    assert.equal(t.relationship, "authorized");
    assert.equal(t.authorizedConsent, true);
  });

  it("defaults relationship to self", () => {
    const t = createTravelerSchema.parse({
      name: "测试甲",
      idNumber: VALID_A,
    });
    assert.equal(t.relationship, "self");
  });
});

describe("publicTraveler shape", () => {
  it("never exposes idNumber or idNumberEnc", () => {
    const pub = toPublicTraveler({
      id: "t1",
      name: "测试甲",
      idType: "id_card",
      idNumberHint: idNumberHint(VALID_A),
      phone: null,
      type: "adult",
      relationship: "self",
      authorizedConsent: false,
      authorizedConsentAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const keys = Object.keys(pub);
    assert.ok(!keys.includes("idNumber"));
    assert.ok(!keys.includes("idNumberEnc"));
    assert.equal(pub.idNumberHint, "****4018");
    assert.equal(pub.relationship, "self");
    // JSON round-trip must not smuggle secrets
    const json = JSON.stringify(pub);
    assert.ok(!json.includes(VALID_A));
    assert.ok(!json.includes("idNumberEnc"));
  });
});
