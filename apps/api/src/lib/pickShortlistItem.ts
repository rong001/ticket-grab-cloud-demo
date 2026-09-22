import type { ShortlistItem } from "@ticket-grab/shared";

export type PickShortlistResult =
  | { ok: true; item: ShortlistItem }
  | {
      ok: false;
      code: "SHORTLIST_EMPTY" | "SHORTLIST_ITEM_NOT_FOUND" | "NO_MATCHING_SHORTLIST";
      error: string;
    };

/** Collapse whitespace / full-width spaces; trim. */
export function normalizePrefToken(raw: string): string {
  return String(raw ?? "")
    .replace(/[\u3000\s]+/g, " ")
    .trim();
}

/** Train numbers compared case-insensitively after normalize. */
export function normalizeTrainNo(raw: string): string {
  return normalizePrefToken(raw).toUpperCase();
}

/**
 * True only when the preference string itself explicitly asks for fuzzy/range matching.
 * Conditions (any one):
 * - trailing/embedded `*` or `?` glob (e.g. `G1*`, `二等*`)
 * - explicit range separators between non-empty sides: `-` / `~` / `～` / `到` / `至`
 *   (e.g. `G1~G9`, `280-580`) — not a bare hyphenated seat name alone without digits/letters both sides
 * - prefs flag `fuzzyPrefs: true` (caller-checked separately)
 *
 * Bare exact prefs like `G1` / `380` / `二等座` must NEVER enable fuzzy.
 */
export function isExplicitFuzzyOrRangePref(pref: string): boolean {
  const t = normalizePrefToken(pref);
  if (!t) return false;
  if (/[*?]/.test(t)) return true;
  // Range: both sides non-empty around a range separator (ASCII/fullwidth/Chinese).
  if (/^.+[-~～到至].+$/.test(t) && /[A-Za-z0-9\u4e00-\u9fff]/.test(t)) {
    // Avoid treating normal Chinese seat labels that happen to contain 到 as ranges
    // unless both sides look like codes/prices (letter/digit on each side or price-like).
    const parts = t.split(/[-~～到至]/);
    if (parts.length >= 2) {
      const left = parts[0]!.trim();
      const right = parts[parts.length - 1]!.trim();
      if (left && right && /[A-Za-z0-9]/.test(left) && /[A-Za-z0-9]/.test(right)) {
        return true;
      }
    }
  }
  return false;
}

/** Simple glob: `*` → any chars, `?` → one char; otherwise exact. */
function globMatch(pattern: string, value: string): boolean {
  const esc = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${esc}$`).test(value);
}

function rangeMatch(pref: string, value: string): boolean {
  const t = normalizePrefToken(pref);
  const parts = t.split(/[-~～到至]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  const lo = parts[0]!;
  const hi = parts[parts.length - 1]!;
  // Numeric tier/price range
  if (/^\d+(\.\d+)?$/.test(lo) && /^\d+(\.\d+)?$/.test(hi) && /^\d+(\.\d+)?$/.test(value)) {
    const n = Number(value);
    return n >= Number(lo) && n <= Number(hi);
  }
  // Lexicographic train-code range (same prefix letter)
  const v = value.toUpperCase();
  const a = lo.toUpperCase();
  const b = hi.toUpperCase();
  return v >= a && v <= b;
}

/**
 * Exact whole-token equality after normalize.
 * For tier strings like "看台 380", preferred "380" matches as a whole token;
 * preferred "380" does NOT match token "1380" (no substring).
 */
export function exactTokenEquals(candidate: string, preferred: string): boolean {
  const c = normalizePrefToken(candidate);
  const p = normalizePrefToken(preferred);
  if (!c || !p) return false;
  if (c === p) return true;
  const tokens = c.split(" ").filter(Boolean);
  return tokens.some((tok) => tok === p);
}

function trainNoEquals(candidate: string, preferred: string): boolean {
  const c = normalizeTrainNo(candidate);
  const p = normalizeTrainNo(preferred);
  return !!c && !!p && c === p;
}

function matchTrainPref(trainNo: string, pref: string, fuzzyAllowed: boolean): boolean {
  if (fuzzyAllowed && isExplicitFuzzyOrRangePref(pref)) {
    const c = normalizeTrainNo(trainNo);
    const p = normalizeTrainNo(pref);
    if (/[*?]/.test(p)) return globMatch(p, c);
    if (rangeMatch(pref, c)) return true;
    return false;
  }
  return trainNoEquals(trainNo, pref);
}

function matchSeatOrTierPref(
  structured: string,
  pref: string,
  fuzzyAllowed: boolean
): boolean {
  if (fuzzyAllowed && isExplicitFuzzyOrRangePref(pref)) {
    const c = normalizePrefToken(structured);
    const p = normalizePrefToken(pref);
    if (/[*?]/.test(p)) {
      if (globMatch(p, c)) return true;
      return c.split(" ").some((tok) => globMatch(p, tok));
    }
    // Range against numeric tokens inside structured field
    for (const tok of [c, ...c.split(" ").filter(Boolean)]) {
      if (rangeMatch(pref, tok)) return true;
    }
    return false;
  }
  return exactTokenEquals(structured, pref);
}

/**
 * Strict shortlist pick for create-order.
 * - Explicit selectedId: exact match only (no pool widening).
 * - Auto: only available/limited; preferences MUST match when set.
 * - Preference matching uses **normalized exact token / whole-field equality**
 *   on structured meta fields (trainNo / seatClass / tier).
 * - Missing structured fields → cannot claim match via loose title/subtitle substring
 *   (prevents G1⊂G10/G100 and 380⊂1380).
 * - Fuzzy/range matching ONLY when the preference string itself explicitly expresses
 *   glob/range (see isExplicitFuzzyOrRangePref) OR preferences.fuzzyPrefs === true
 *   together with an explicit fuzzy/range token.
 * - Never silently falls back to sold-out or to items outside preferred trains/seats/tiers.
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
  // Opt-in flag only; still requires each pref token to be explicit fuzzy/range.
  const fuzzyPrefsFlag = prefs.fuzzyPrefs === true;

  if (preferredTrains.length) {
    const filtered = pool.filter((i) => {
      const structured = i.meta?.trainNo;
      // Missing structured trainNo → cannot claim match via title substring.
      if (structured == null || String(structured).trim() === "") return false;
      const no = String(structured);
      return preferredTrains.some((t) =>
        matchTrainPref(no, t, fuzzyPrefsFlag || isExplicitFuzzyOrRangePref(t))
      );
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
      const structured = i.meta?.seatClass;
      // Missing structured seatClass → cannot claim match via title/subtitle substring.
      if (structured == null || String(structured).trim() === "") return false;
      const seat = String(structured);
      return preferredSeats.some((s) =>
        matchSeatOrTierPref(seat, s, fuzzyPrefsFlag || isExplicitFuzzyOrRangePref(s))
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
      const structured = i.meta?.tier;
      // Missing structured tier → cannot claim match via loose includes on other fields.
      if (structured == null || String(structured).trim() === "") return false;
      const tier = String(structured);
      return preferredTiers.some((t) =>
        matchSeatOrTierPref(tier, t, fuzzyPrefsFlag || isExplicitFuzzyOrRangePref(t))
      );
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
