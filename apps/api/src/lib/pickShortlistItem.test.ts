import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ShortlistItem } from "@ticket-grab/shared";
import {
  pickShortlistItem,
  sameTravelerIdSet,
  watchDraftFingerprint,
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
