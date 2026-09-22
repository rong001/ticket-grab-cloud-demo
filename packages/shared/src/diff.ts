import type { DiffResult, ShortlistItem } from "./types.js";

const AVAIL_RANK: Record<string, number> = {
  sold_out: 0,
  unknown: 1,
  waitlist: 2,
  limited: 3,
  available: 4,
};

export function diffShortlists(
  previous: ShortlistItem[],
  current: ShortlistItem[]
): DiffResult {
  const prevMap = new Map(previous.map((i) => [i.id, i]));
  const currMap = new Map(current.map((i) => [i.id, i]));

  const added: ShortlistItem[] = [];
  const removed: ShortlistItem[] = [];
  const changed: DiffResult["changed"] = [];
  const availabilityImproved: ShortlistItem[] = [];

  for (const [id, item] of currMap) {
    const before = prevMap.get(id);
    if (!before) {
      added.push(item);
      if (item.availability === "available" || item.availability === "limited") {
        availabilityImproved.push(item);
      }
      continue;
    }
    const availChanged = before.availability !== item.availability;
    const priceChanged = before.price !== item.price;
    if (availChanged || priceChanged) {
      changed.push({ before, after: item });
      const beforeRank = AVAIL_RANK[before.availability] ?? 0;
      const afterRank = AVAIL_RANK[item.availability] ?? 0;
      if (afterRank > beforeRank) availabilityImproved.push(item);
    }
  }

  for (const [id, item] of prevMap) {
    if (!currMap.has(id)) removed.push(item);
  }

  return { added, removed, changed, availabilityImproved };
}
