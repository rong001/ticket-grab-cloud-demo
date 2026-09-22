import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ShortlistItem } from "@ticket-grab/shared";
import {
  pickShortlistItem,
  sameTravelerIdSet,
  watchDraftFingerprint,
  isExplicitFuzzyOrRangePref,
  exactTokenEquals,
  normalizeTrainNo,
} from "./pickShortlistItem.js";

function item(
  partial: Partial<ShortlistItem> & { id: string; title: string }
): ShortlistItem {
  return {
    channel: "train",
    availability: "available",
    ...partial,
  } as ShortlistItem;
}

describe("pickShortlistItem strict prefs", () => {
  it("returns SHORTLIST_EMPTY for empty list", () => {
    const r = pickShortlistItem([], null);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "SHORTLIST_EMPTY");
  });

  it("does not silently pick sold_out when no available/limited", () => {
    const items = [
      item({
        id: "s1",
        title: "G1001",
        availability: "sold_out",
        meta: { trainNo: "G1001", seatClass: "二等座" },
      }),
    ];
    const r = pickShortlistItem(items, null);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "NO_MATCHING_SHORTLIST");
  });

  it("preferred train with no match → NO_MATCHING_SHORTLIST", () => {
    const items = [
      item({
        id: "a",
        title: "G1001 北京 → 上海",
        meta: { trainNo: "G1001", seatClass: "二等座" },
      }),
    ];
    const r = pickShortlistItem(items, { preferredTrains: ["Z9999"] });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, "NO_MATCHING_SHORTLIST");
      assert.match(r.error, /无符合项/);
    }
  });

  it("preferred seat with no match → NO_MATCHING_SHORTLIST", () => {
    const items = [
      item({
        id: "a",
        title: "G1001",
        meta: { trainNo: "G1001", seatClass: "二等座" },
      }),
    ];
    const r = pickShortlistItem(items, { preferredSeats: ["硬卧"] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "NO_MATCHING_SHORTLIST");
  });

  it("preferred tier with no match → NO_MATCHING_SHORTLIST", () => {
    const items = [
      item({
        id: "a",
        title: "Show A",
        channel: "show",
        meta: { tier: "看台 280" },
      }),
    ];
    const r = pickShortlistItem(items, { preferredTiers: ["内场 1880"] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "NO_MATCHING_SHORTLIST");
  });

  it("matching preferred train returns that item (no silent broaden)", () => {
    const items = [
      item({
        id: "a",
        title: "G1001",
        meta: { trainNo: "G1001", seatClass: "二等座" },
      }),
      item({
        id: "b",
        title: "G2033",
        meta: { trainNo: "G2033", seatClass: "二等座" },
      }),
    ];
    const r = pickShortlistItem(items, { preferredTrains: ["G2033"] });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.item.id, "b");
  });

  it("explicit selectedId still works even if sold_out", () => {
    const items = [
      item({
        id: "s1",
        title: "G1001",
        availability: "sold_out",
        meta: { trainNo: "G1001" },
      }),
    ];
    const r = pickShortlistItem(items, { preferredTrains: ["Z9"] }, "s1");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.item.id, "s1");
  });

  it("prefers non-scheduleOnly when both match", () => {
    const items = [
      item({
        id: "sched",
        title: "CA1234",
        channel: "flight",
        meta: { scheduleOnly: true, trainNo: "CA1234" },
      }),
      item({
        id: "fare",
        title: "CA1234 fare",
        channel: "flight",
        meta: { scheduleOnly: false, trainNo: "CA1234" },
      }),
    ];
    const r = pickShortlistItem(items, null);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.item.id, "fare");
  });

  it("NEG: preferred G1 must NOT match pool G10/G100 (no substring)", () => {
    const items = [
      item({
        id: "g10",
        title: "G10 北京 → 上海",
        meta: { trainNo: "G10", seatClass: "二等座" },
      }),
      item({
        id: "g100",
        title: "G100 北京 → 上海",
        meta: { trainNo: "G100", seatClass: "二等座" },
      }),
    ];
    const r = pickShortlistItem(items, { preferredTrains: ["G1"] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "NO_MATCHING_SHORTLIST");
  });

  it("POS: preferred G10 selects exact G10 in pool", () => {
    const items = [
      item({
        id: "g10",
        title: "G10",
        meta: { trainNo: "G10", seatClass: "二等座" },
      }),
      item({
        id: "g100",
        title: "G100",
        meta: { trainNo: "G100", seatClass: "二等座" },
      }),
    ];
    const r = pickShortlistItem(items, { preferredTrains: ["G10"] });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.item.id, "g10");
  });

  it("NEG: preferred 380 must NOT match tier 1380 (no substring)", () => {
    const items = [
      item({
        id: "t1380",
        title: "Show 1380",
        channel: "show",
        meta: { tier: "1380" },
      }),
    ];
    const r = pickShortlistItem(items, { preferredTiers: ["380"] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "NO_MATCHING_SHORTLIST");
  });

  it("POS: preferred 380 selects exact tier 380", () => {
    const items = [
      item({
        id: "t380",
        title: "Show 380",
        channel: "show",
        meta: { tier: "380" },
      }),
      item({
        id: "t1380",
        title: "Show 1380",
        channel: "show",
        meta: { tier: "1380" },
      }),
    ];
    const r = pickShortlistItem(items, { preferredTiers: ["380"] });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.item.id, "t380");
  });

  it("POS: preferred 380 matches whole-token in '看台 380' but not '看台 1380'", () => {
    const items = [
      item({
        id: "a",
        title: "A",
        channel: "show",
        meta: { tier: "看台 380" },
      }),
      item({
        id: "b",
        title: "B",
        channel: "show",
        meta: { tier: "看台 1380" },
      }),
    ];
    const r = pickShortlistItem(items, { preferredTiers: ["380"] });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.item.id, "a");
  });

  it("missing structured trainNo → cannot match via title substring", () => {
    const items = [
      item({
        id: "a",
        title: "G10 北京南",
        meta: { seatClass: "二等座" }, // no trainNo
      }),
    ];
    const r = pickShortlistItem(items, { preferredTrains: ["G10"] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "NO_MATCHING_SHORTLIST");
  });

  it("explicit fuzzy glob G1* matches G10/G100 when pref contains *", () => {
    const items = [
      item({
        id: "g10",
        title: "G10",
        meta: { trainNo: "G10", seatClass: "二等座" },
      }),
      item({
        id: "g100",
        title: "G100",
        meta: { trainNo: "G100", seatClass: "二等座" },
      }),
      item({
        id: "d1",
        title: "D1",
        meta: { trainNo: "D1", seatClass: "二等座" },
      }),
    ];
    const r = pickShortlistItem(items, { preferredTrains: ["G1*"] });
    assert.equal(r.ok, true);
    if (r.ok) assert.ok(["g10", "g100"].includes(r.item.id));
  });

  it("explicit numeric tier range 300-400 matches 380 only", () => {
    const items = [
      item({
        id: "t280",
        title: "280",
        channel: "show",
        meta: { tier: "280" },
      }),
      item({
        id: "t380",
        title: "380",
        channel: "show",
        meta: { tier: "380" },
      }),
      item({
        id: "t1380",
        title: "1380",
        channel: "show",
        meta: { tier: "1380" },
      }),
    ];
    const r = pickShortlistItem(items, { preferredTiers: ["300-400"] });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.item.id, "t380");
  });
});

describe("pref normalize / fuzzy detection", () => {
  it("normalizeTrainNo uppercases", () => {
    assert.equal(normalizeTrainNo(" g10 "), "G10");
  });

  it("exactTokenEquals does not substring", () => {
    assert.equal(exactTokenEquals("1380", "380"), false);
    assert.equal(exactTokenEquals("380", "380"), true);
    assert.equal(exactTokenEquals("看台 380", "380"), true);
  });

  it("bare G1 is not fuzzy; G1* and 280-580 are", () => {
    assert.equal(isExplicitFuzzyOrRangePref("G1"), false);
    assert.equal(isExplicitFuzzyOrRangePref("380"), false);
    assert.equal(isExplicitFuzzyOrRangePref("G1*"), true);
    assert.equal(isExplicitFuzzyOrRangePref("280-580"), true);
    assert.equal(isExplicitFuzzyOrRangePref("G1~G9"), true);
  });
});

describe("watchDraftFingerprint", () => {
  it("is order-independent for traveler set", () => {
    const a = watchDraftFingerprint("u1", "w1", "i1", ["t2", "t1"]);
    const b = watchDraftFingerprint("u1", "w1", "i1", ["t1", "t2"]);
    assert.equal(a, b);
  });

  it("sameTravelerIdSet ignores order", () => {
    assert.equal(sameTravelerIdSet(["a", "b"], ["b", "a"]), true);
    assert.equal(sameTravelerIdSet(["a"], ["a", "b"]), false);
  });
});
