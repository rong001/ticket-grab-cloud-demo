/**
 * Full 12306 station-name allowlist for conversational intake.
 * Data: ./data/stations.json (fetched 2026-09-22 from kyfw.12306.cn station_name.js).
 * See ./data/SOURCE.md.
 */
import stationNames from "./data/stations.json" with { type: "json" };

const NAMES = stationNames as string[];

/** Full set of known PRC passenger-station Chinese names (~3388). */
export const KNOWN_TRAIN_STATIONS: ReadonlySet<string> = new Set(NAMES);

/** Prefix → candidates (for unique / ambiguous fuzzy match). Built once. */
const BY_PREFIX = new Map<string, string[]>();
for (const name of NAMES) {
  // Index every prefix length 2..min(6, name.length) for clarify lookups
  const max = Math.min(6, name.length);
  for (let i = 2; i <= max; i++) {
    const p = name.slice(0, i);
    const arr = BY_PREFIX.get(p);
    if (arr) arr.push(name);
    else BY_PREFIX.set(p, [name]);
  }
}

export function normalizeStationInput(name: string): string {
  return name.trim().replace(/站$/u, "");
}

export function isKnownTrainStationName(name: string): boolean {
  const raw = name.trim();
  if (!raw) return false;
  if (KNOWN_TRAIN_STATIONS.has(raw)) return true;
  if (raw.endsWith("站") && KNOWN_TRAIN_STATIONS.has(raw.slice(0, -1))) return true;
  return false;
}

export type StationResolve =
  | { kind: "exact"; name: string }
  | { kind: "unique"; name: string }
  | { kind: "ambiguous"; query: string; candidates: string[] }
  | { kind: "unknown"; query: string };

/**
 * Resolve a user place token against the 12306 index.
 * - Exact / trailing「站」→ exact
 * - Unique prefix / unique contains → unique (auto-accept)
 * - Multiple real matches → ambiguous (ask clarify; do not confirm)
 * - Else → unknown (reject)
 */
export function resolveTrainStation(raw: string): StationResolve {
  const q = normalizeStationInput(raw);
  if (!q || q.length < 2 || /\d|[./]|到|去|至|→/.test(q)) {
    return { kind: "unknown", query: raw.trim() };
  }
  if (KNOWN_TRAIN_STATIONS.has(q)) return { kind: "exact", name: q };

  // Prefix candidates (prefer longer shared prefix)
  const prefixKey = q.slice(0, Math.min(6, q.length));
  let cands = (BY_PREFIX.get(prefixKey) ?? []).filter(
    (n) => n.startsWith(q) || n.includes(q)
  );
  // Also: stations that equal query+方位 suffix already covered by startsWith
  if (cands.length === 0) {
    // Fallback scan for short queries (rare) — limit to includes
    cands = NAMES.filter((n) => n.includes(q)).slice(0, 20);
  } else {
    // Deduplicate and prefer startsWith over contains
    const starts = cands.filter((n) => n.startsWith(q));
    cands = starts.length ? starts : cands;
    cands = [...new Set(cands)].slice(0, 12);
  }

  if (cands.length === 1) return { kind: "unique", name: cands[0]! };
  if (cands.length > 1) return { kind: "ambiguous", query: q, candidates: cands };
  return { kind: "unknown", query: q };
}

export function stationIndexSize(): number {
  return NAMES.length;
}
