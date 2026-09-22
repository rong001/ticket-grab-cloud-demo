import type { ShortlistItem } from "@ticket-grab/shared";

export type PickShortlistResult =
  | { ok: true; item: ShortlistItem }
  | {
      ok: false;
      code: "SHORTLIST_EMPTY" | "SHORTLIST_ITEM_NOT_FOUND" | "NO_MATCHING_SHORTLIST";
      error: string;
    };

/**
 * Strict shortlist pick for create-order.
 * - Explicit selectedId: exact match only (no pool widening).
 * - Auto: only available/limited; preferences MUST match when set.
 * - Never silently falls back to sold-out or to items outside preferred trains/seats/tiers.
 * - scheduleOnly items may be returned only when they survive the same strict filters
 *   (reference draft); callers must not treat them as sellable inventory success.
 */
export function pickShortlistItem(
  items: ShortlistItem[],
  preferences: Record<string, unknown> | null | undefined,
  selectedId?: string
): PickShortlistResult {
  if (!items.length) {
    return {
      ok: false,
      code: "SHORTLIST_EMPTY",
      error: "暂无候选短名单；请等待盯票发现有票或先执行一次搜索",
    };
  }

  if (selectedId) {
    const hit = items.find((i) => i.id === selectedId);
    if (!hit) {
      return {
        ok: false,
        code: "SHORTLIST_ITEM_NOT_FOUND",
        error: "指定的短名单项不存在于最新快照",
      };
    }
    return { ok: true, item: hit };
  }

  // Strict: available/limited only — never widen to sold_out/unknown.
  let pool = items.filter(
    (i) => i.availability === "available" || i.availability === "limited"
  );
  if (!pool.length) {
    return {
      ok: false,
      code: "NO_MATCHING_SHORTLIST",
      error: "无符合项，须用户重新选择（无可售/余票紧张的候选，不会静默选用已售罄项）",
    };
  }

  const prefs = preferences ?? {};
  const preferredTrains = Array.isArray(prefs.preferredTrains)
    ? prefs.preferredTrains.map(String).filter(Boolean)
    : [];
  const preferredSeats = Array.isArray(prefs.preferredSeats)
    ? prefs.preferredSeats.map(String).filter(Boolean)
    : [];
  const preferredTiers = Array.isArray(prefs.preferredTiers)
    ? prefs.preferredTiers.map(String).filter(Boolean)
    : [];

  if (preferredTrains.length) {
    const filtered = pool.filter((i) => {
      const no = String(i.meta?.trainNo ?? i.title.split(" ")[0] ?? "");
      return preferredTrains.some((t) => no.includes(t) || i.title.includes(t));
    });
    if (!filtered.length) {
      return {
        ok: false,
        code: "NO_MATCHING_SHORTLIST",
        error: "无符合项，须用户重新选择（偏好车次无匹配）",
      };
    }
    pool = filtered;
  }

  if (preferredSeats.length) {
    const filtered = pool.filter((i) => {
      const seat = String(i.meta?.seatClass ?? "");
      return preferredSeats.some(
        (s) => seat.includes(s) || i.title.includes(s) || i.subtitle?.includes(s)
      );
    });
    if (!filtered.length) {
      return {
        ok: false,
        code: "NO_MATCHING_SHORTLIST",
        error: "无符合项，须用户重新选择（偏好席别无匹配）",
      };
    }
    pool = filtered;
  }

  if (preferredTiers.length) {
    const filtered = pool.filter((i) => {
      const tier = String(i.meta?.tier ?? "");
      return preferredTiers.some((t) => tier.includes(t));
    });
    if (!filtered.length) {
      return {
        ok: false,
        code: "NO_MATCHING_SHORTLIST",
        error: "无符合项，须用户重新选择（偏好票档无匹配）",
      };
    }
    pool = filtered;
  }

  // Prefer non-scheduleOnly when both exist; scheduleOnly alone is allowed as reference draft only.
  const nonSchedule = pool.filter(
    (i) => (i.meta as { scheduleOnly?: boolean } | undefined)?.scheduleOnly !== true
  );
  if (nonSchedule.length) pool = nonSchedule;

  const item = pool[0];
  if (!item) {
    return {
      ok: false,
      code: "NO_MATCHING_SHORTLIST",
      error: "无符合项，须用户重新选择",
    };
  }
  return { ok: true, item };
}

/** Stable fingerprint for draft idempotency (user + watch + item + traveler set). */
export function watchDraftFingerprint(
  userId: string,
  watchJobId: string,
  selectedShortlistItemId: string,
  travelerIds: string[]
): string {
  const travelers = [...travelerIds].map(String).sort().join(",");
  return `${userId}|${watchJobId}|${selectedShortlistItemId}|${travelers}`;
}

export function sameTravelerIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].map(String).sort();
  const sb = [...b].map(String).sort();
  return sa.every((v, i) => v === sb[i]);
}
