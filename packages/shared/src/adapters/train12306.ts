import type { ShortlistItem, ShortlistResult, TrainFields } from "../types.js";
import type { AdapterSearchInput, TicketAdapter } from "./types.js";
import {
  fetchJson,
  fetchText,
  finalizeSearchResult,
  resolveProviderMode,
  type LiveAttempt,
} from "./liveMode.js";

let stationIndex: Map<string, string> | null = null;
let stationRecords: StationRecord[] | null = null;
let stationLoadError: string | null = null;
/** When the in-memory station index was last successfully loaded (ms). */
let stationLoadedAt = 0;
/** Refresh station_name.js at most this often (default 6h). Override via TRAIN_STATION_CACHE_MS. */
const STATION_CACHE_MS = () => {
  const raw = Number(process.env.TRAIN_STATION_CACHE_MS);
  if (Number.isFinite(raw) && raw >= 60_000) return raw;
  return 6 * 60 * 60 * 1000;
};

/** Full 12306 station_name.js row (name → telecode + city). */
export type StationRecord = {
  name: string;
  telecode: string;
  pinyin: string;
  shortCode: string;
  cityCode: string;
  cityName: string;
};

const BUILTIN_STATION_ROWS: Array<[string, string, string]> = [
  ["北京", "BJP", "北京"],
  ["北京南", "VNP", "北京"],
  ["北京西", "BXP", "北京"],
  ["北京北", "VAP", "北京"],
  ["上海", "SHH", "上海"],
  ["上海虹桥", "AOH", "上海"],
  ["上海南", "SNH", "上海"],
  ["广州", "GZQ", "广州"],
  ["广州南", "IZQ", "广州"],
  ["广州东", "GGQ", "广州"],
  ["深圳", "SZQ", "深圳"],
  ["深圳北", "IOQ", "深圳"],
  ["深圳东", "BJQ", "深圳"],
  ["深圳西", "OSQ", "深圳"],
  ["福田", "NZQ", "深圳"],
  ["汕尾", "OGQ", "汕尾"],
  ["杭州东", "HGH", "杭州"],
  ["杭州", "HZH", "杭州"],
  ["南京南", "NKH", "南京"],
  ["武汉", "WHN", "武汉"],
  ["成都东", "ICW", "成都"],
  ["重庆北", "CUW", "重庆"],
  ["西安北", "EAY", "西安"],
  ["天津", "TJP", "天津"],
  ["长沙南", "CWQ", "长沙"],
];

const BUILTIN_STATIONS: Record<string, string> = Object.fromEntries(
  BUILTIN_STATION_ROWS.map(([name, code]) => [name, code])
);

function builtinRecords(): StationRecord[] {
  return BUILTIN_STATION_ROWS.map(([name, telecode, cityName]) => ({
    name,
    telecode,
    pinyin: "",
    shortCode: "",
    cityCode: "",
    cityName,
  }));
}

function fixtureItems(fields: TrainFields): ShortlistItem[] {
  const date = fields.date;
  return [
    {
      id: `G1001-${date}`,
      channel: "train",
      title: `G1001 ${fields.from} → ${fields.to}`,
      subtitle: `${date} 08:15–10:42 · 二等座`,
      datetime: `${date}T08:15:00+08:00`,
      price: 289,
      currency: "CNY",
      availability: "available",
      meta: {
        trainNo: "G1001",
        trainType: "G",
        depTime: "08:15",
        arrTime: "10:42",
        durationMin: 147,
        seatClass: "二等座",
        seats: {
          business: { label: "商务/特等", token: "9", availability: "limited" },
          first: { label: "一等座", token: "有", availability: "available" },
          second: { label: "二等座", token: "有", availability: "available" },
          softSleeper: { label: "软卧", token: "--", availability: "sold_out" },
          hardSleeper: { label: "硬卧", token: "--", availability: "sold_out" },
          hardSeat: { label: "硬座", token: "--", availability: "sold_out" },
          noSeat: { label: "无座", token: "有", availability: "available" },
        },
      },
    },
    {
      id: `G2033-${date}`,
      channel: "train",
      title: `G2033 ${fields.from} → ${fields.to}`,
      subtitle: `${date} 14:20–16:55 · 一等座`,
      datetime: `${date}T14:20:00+08:00`,
      price: 462,
      currency: "CNY",
      availability: "limited",
      meta: {
        trainNo: "G2033",
        trainType: "G",
        depTime: "14:20",
        arrTime: "16:55",
        seatClass: "一等座",
        remaining: 3,
        seats: {
          business: { label: "商务/特等", token: "无", availability: "sold_out" },
          first: { label: "一等座", token: "3", availability: "limited" },
          second: { label: "二等座", token: "有", availability: "available" },
          softSleeper: { label: "软卧", token: "--", availability: "sold_out" },
          hardSleeper: { label: "硬卧", token: "--", availability: "sold_out" },
          hardSeat: { label: "硬座", token: "--", availability: "sold_out" },
          noSeat: { label: "无座", token: "无", availability: "sold_out" },
        },
      },
    },
    {
      id: `D5678-${date}`,
      channel: "train",
      title: `D5678 ${fields.from} → ${fields.to}`,
      subtitle: `${date} 19:05–22:10 · 二等座`,
      datetime: `${date}T19:05:00+08:00`,
      price: 198,
      currency: "CNY",
      availability: "waitlist",
      meta: {
        trainNo: "D5678",
        trainType: "D",
        depTime: "19:05",
        arrTime: "22:10",
        seatClass: "二等座",
        queue: "候补",
        seats: {
          business: { label: "商务/特等", token: "--", availability: "sold_out" },
          first: { label: "一等座", token: "无", availability: "sold_out" },
          second: { label: "二等座", token: "候补", availability: "waitlist" },
          softSleeper: { label: "软卧", token: "--", availability: "sold_out" },
          hardSleeper: { label: "硬卧", token: "--", availability: "sold_out" },
          hardSeat: { label: "硬座", token: "--", availability: "sold_out" },
          noSeat: { label: "无座", token: "无", availability: "sold_out" },
        },
      },
    },
  ];
}

/** Parse 12306 station_name.js into full records (city-aware). */
export function parseStationRecords(text: string): StationRecord[] {
  const out: StationRecord[] = [];
  const seen = new Set<string>();
  for (const part of text.split("@")) {
    if (!part || !part.includes("|")) continue;
    const f = part.split("|");
    const name = (f[1] ?? "").trim();
    const telecode = (f[2] ?? "").trim().toUpperCase();
    if (!name || !/^[A-Z]{3}$/.test(telecode)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      telecode,
      pinyin: (f[3] ?? "").trim(),
      shortCode: (f[0] ?? "").trim(),
      cityCode: (f[6] ?? "").trim(),
      cityName: (f[7] ?? "").trim(),
    });
  }
  return out;
}

function parseStationJs(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of parseStationRecords(text)) {
    map.set(r.name, r.telecode);
  }
  return map;
}

function mergeBuiltin(records: StationRecord[]): StationRecord[] {
  const byName = new Map(records.map((r) => [r.name, r]));
  for (const b of builtinRecords()) {
    if (!byName.has(b.name)) {
      byName.set(b.name, b);
      records.push(b);
    }
  }
  return records;
}

function indexFromRecords(records: StationRecord[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of records) map.set(r.name, r.telecode);
  return map;
}

async function ensureStationData(force = false): Promise<StationRecord[]> {
  const cacheMs = STATION_CACHE_MS();
  const fresh =
    stationRecords &&
    stationIndex &&
    stationLoadedAt > 0 &&
    Date.now() - stationLoadedAt < cacheMs;
  if (fresh && !force) return stationRecords!;

  // Optional local file (tests / air-gapped): TRAIN_STATION_JS_PATH
  const localPath = process.env.TRAIN_STATION_JS_PATH;
  if (localPath) {
    try {
      const { readFileSync } = await import("node:fs");
      const text = readFileSync(localPath, "utf8");
      if (/@[^|]*\|[^|]+\|[A-Z]{3}\|/.test(text)) {
        stationRecords = mergeBuiltin(parseStationRecords(text));
        stationIndex = indexFromRecords(stationRecords);
        stationLoadError = null;
        stationLoadedAt = Date.now();
        return stationRecords;
      }
    } catch (err) {
      stationLoadError = err instanceof Error ? err.message : String(err);
    }
  }

  const url =
    process.env.TRAIN_STATION_JS_URL ??
    "https://kyfw.12306.cn/otn/resources/js/framework/station_name.js";

  const res = await fetchText(url, {
    timeoutMs: 15_000,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; TicketGrabAssist/1.0)" },
  });

  if (res.ok && /@[^|]*\|[^|]+\|[A-Z]{3}\|/.test(res.text)) {
    stationRecords = mergeBuiltin(parseStationRecords(res.text));
    stationIndex = indexFromRecords(stationRecords);
    stationLoadError = null;
    stationLoadedAt = Date.now();
    return stationRecords;
  }

  stationLoadError = res.error ?? `HTTP ${res.status}`;
  // Keep previous full index if we still have one from an earlier successful load.
  if (stationRecords && stationRecords.length > 50 && stationIndex) {
    return stationRecords;
  }
  stationRecords = builtinRecords();
  stationIndex = indexFromRecords(stationRecords);
  stationLoadedAt = Date.now();
  return stationRecords;
}

export async function loadStationIndex(force = false): Promise<Map<string, string>> {
  await ensureStationData(force);
  return stationIndex!;
}

/** Full station rows from 12306 station_name.js (or builtin fallback). */
export async function loadStationRecords(force = false): Promise<StationRecord[]> {
  return ensureStationData(force);
}

/**
 * All stations in a city from the live/full index.
 * Matches cityName or cityCode; also includes name-prefix matches when city field is empty.
 */
export async function listStationsByCity(opts: {
  city?: string;
  cityCode?: string;
}): Promise<StationRecord[]> {
  const records = await loadStationRecords();
  const city = (opts.city ?? "").trim();
  const cityCode = (opts.cityCode ?? "").trim();
  if (!city && !cityCode) return [];

  const byCode = cityCode
    ? records.filter((r) => r.cityCode && r.cityCode === cityCode)
    : [];
  if (byCode.length) return sortStations(byCode);

  if (!city) return [];

  const exactCity = records.filter((r) => r.cityName === city);
  if (exactCity.length) return sortStations(exactCity);

  const softCity = records.filter(
    (r) => r.cityName && (r.cityName.includes(city) || city.includes(r.cityName))
  );
  if (softCity.length) return sortStations(softCity);

  // Fallback when cityName missing in some rows: station name starts with city
  const prefix = records.filter(
    (r) => r.name === city || r.name.startsWith(city)
  );
  return sortStations(prefix);
}

/** Distinct cities present in the station index (for city-first picker). */
export async function listTrainCities(q = "", limit = 80): Promise<
  Array<{ cityName: string; cityCode: string; stationCount: number }>
> {
  const records = await loadStationRecords();
  const map = new Map<string, { cityName: string; cityCode: string; stationCount: number }>();
  for (const r of records) {
    const name = r.cityName || inferCityFromStationName(r.name);
    if (!name) continue;
    const key = name;
    const cur = map.get(key);
    if (cur) {
      cur.stationCount += 1;
      if (!cur.cityCode && r.cityCode) cur.cityCode = r.cityCode;
    } else {
      map.set(key, { cityName: name, cityCode: r.cityCode, stationCount: 1 });
    }
  }
  const ql = q.trim().toLowerCase();
  let rows = [...map.values()];
  if (ql) {
    rows = rows.filter(
      (c) =>
        c.cityName.includes(q.trim()) ||
        c.cityName.toLowerCase().includes(ql) ||
        c.cityCode === q.trim()
    );
  }
  rows.sort((a, b) => b.stationCount - a.stationCount || a.cityName.localeCompare(b.cityName, "zh"));
  return rows.slice(0, Math.min(Math.max(limit, 1), 200));
}

function inferCityFromStationName(name: string): string {
  return name.replace(/(东|西|南|北|站)$/g, "") || name;
}

function sortStations(rows: StationRecord[]): StationRecord[] {
  return [...rows].sort((a, b) => {
    // Prefer exact city-name station first (深圳 before 深圳北)
    if (a.cityName && a.name === a.cityName) return -1;
    if (b.cityName && b.name === b.cityName) return 1;
    return a.name.localeCompare(b.name, "zh");
  });
}

export function stationLoadStatus(): {
  error: string | null;
  count: number;
  loadedAt: string | null;
  cacheMs: number;
  stale: boolean;
} {
  const cacheMs = STATION_CACHE_MS();
  const loadedAt = stationLoadedAt > 0 ? new Date(stationLoadedAt).toISOString() : null;
  const stale = !stationLoadedAt || Date.now() - stationLoadedAt >= cacheMs;
  return {
    error: stationLoadError,
    count: stationRecords?.length ?? stationIndex?.size ?? 0,
    loadedAt,
    cacheMs,
    stale,
  };
}

export async function resolveStationTelecode(nameOrCode: string): Promise<string | null> {
  const raw = nameOrCode.trim();
  if (/^[A-Z]{3}$/i.test(raw)) return raw.toUpperCase();
  const index = await loadStationIndex();
  return index.get(raw) ?? index.get(raw.replace(/站$/, "")) ?? null;
}

function seatAvailability(token: string | undefined): ShortlistItem["availability"] {
  if (!token || token === "" || token === "--" || token === "无" || token === "*") {
    return "sold_out";
  }
  if (token === "有") return "available";
  if (token === "候补") return "waitlist";
  const n = Number(token);
  if (!Number.isNaN(n)) {
    if (n <= 0) return "sold_out";
    if (n <= 9) return "limited";
    return "available";
  }
  return "unknown";
}

function pickBestSeat(parts: string[]): {
  seatClass: string;
  token: string;
  availability: ShortlistItem["availability"];
} {
  const candidates: Array<[string, number]> = [
    ["二等座", 30],
    ["一等座", 31],
    ["商务座", 32],
    ["硬卧", 28],
    ["软卧", 23],
    ["硬座", 29],
    ["无座", 26],
  ];
  let fallback: { seatClass: string; token: string; availability: ShortlistItem["availability"] } | null =
    null;
  for (const [label, idx] of candidates) {
    const token = parts[idx] ?? "";
    const availability = seatAvailability(token);
    if (availability === "available" || availability === "limited") {
      return { seatClass: label, token, availability };
    }
    if (!fallback) fallback = { seatClass: label, token, availability };
  }
  
return fallback ?? { seatClass: "二等座", token: "", availability: "unknown" };
}

/** 12306 left-ticket column indices → timetable-style seat columns. */
export const SEAT_COLUMNS: Array<{ key: string; label: string; index: number }> = [
  { key: "business", label: "商务/特等", index: 32 },
  { key: "first", label: "一等座", index: 31 },
  { key: "second", label: "二等座", index: 30 },
  { key: "softSleeper", label: "软卧", index: 23 },
  { key: "hardSleeper", label: "硬卧", index: 28 },
  { key: "hardSeat", label: "硬座", index: 29 },
  { key: "noSeat", label: "无座", index: 26 },
];

function seatMatrix(
  parts: string[]
): Record<string, { label: string; token: string; availability: ShortlistItem["availability"] }> {
  const out: Record<
    string,
    { label: string; token: string; availability: ShortlistItem["availability"] }
  > = {};
  for (const col of SEAT_COLUMNS) {
    const token = parts[col.index] ?? "";
    out[col.key] = { label: col.label, token, availability: seatAvailability(token) };
  }
  return out;
}

function trainCategory(trainNo: string): "G" | "D" | "C" | "Z" | "T" | "K" | "other" {
  const c = (trainNo || "").trim().charAt(0).toUpperCase();
  if (c === "G" || c === "D" || c === "C" || c === "Z" || c === "T" || c === "K") return c;
  return "other";
}


/** Parse 12306 left-ticket `data.result` pipe rows into shortlist items. */
export function parse12306LeftTicket(
  payload: { data?: { result?: string[]; map?: Record<string, string> } },
  fields: TrainFields,
  limit = 40
): ShortlistItem[] {
  const rows = payload.data?.result ?? [];
  const map = payload.data?.map ?? {};
  const items: ShortlistItem[] = [];

  for (const row of rows) {
    const parts = row.split("|");
    if (parts.length < 14) continue;
    const trainNo = parts[3];
    const fromCode = parts[6];
    const toCode = parts[7];
    const dep = parts[8];
    const arr = parts[9];
    const dur = parts[10];
    const dateRaw = parts[13];
    if (!trainNo || !dep) continue;

    const date =
      fields.date ||
      (dateRaw && dateRaw.length === 8
        ? `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`
        : fields.date);

    const fromName = map[fromCode] ?? fields.from;
    const toName = map[toCode] ?? fields.to;
    const seat = pickBestSeat(parts);

    const secretStr = parts[0] && parts[0] !== "" ? decodeURIComponent(parts[0]) : undefined;

    items.push({
      id: `${trainNo}-${fromCode}-${toCode}-${date}-${dep.replace(":", "")}`,
      channel: "train",
      title: `${trainNo} ${fromName} → ${toName}`,
      subtitle: `${date} ${dep}–${arr} · ${dur} · ${seat.seatClass}${
        seat.token && seat.token !== "有" ? ` (${seat.token})` : ""
      }`,
      datetime: `${date}T${dep}:00+08:00`,
      currency: "CNY",
      availability: seat.availability,
      meta: {
        trainNo,
        trainType: trainCategory(trainNo),
        fromTelecode: fromCode,
        toTelecode: toCode,
        fromName,
        toName,
        date,
        depTime: dep,
        arrTime: arr,
        duration: dur,
        seatClass: seat.seatClass,
        seatToken: seat.token,
        seats: seatMatrix(parts),
        secretStr,
        source: "kyfw.12306.cn",
        // secretStr is for official assistive submit only — user must complete captcha/SMS/face
      },
    });

    if (items.length >= limit) break;
  }

  return items;
}

type LeftTicketPayload = {
  httpstatus?: number;
  status?: boolean;
  data?: { result?: string[]; map?: Record<string, string> };
  c_url?: string;
  messages?: string[];
};

function collectCookies(res: Response, jar: Map<string, string>): void {
  const raw =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie")!]
        : [];
  for (const line of raw) {
    const pair = line.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

async function fetch12306Json(
  url: string,
  headers: Record<string, string>,
  jar: Map<string, string>,
  timeoutMs = 15_000
): Promise<{ ok: boolean; status: number; data?: LeftTicketPayload; error?: string; text?: string }> {
  try {
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(url, {
      headers: cookie ? { ...headers, Cookie: cookie } : headers,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    collectCookies(res, jar);
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}`, text: text.slice(0, 400) };
    }
    if (!text.trim().startsWith("{") && !text.trim().startsWith("[")) {
      return {
        ok: false,
        status: res.status,
        error: "12306 returned non-JSON (likely captcha/HTML interstitial)",
        text: text.slice(0, 400),
      };
    }
    return { ok: true, status: res.status, data: JSON.parse(text) as LeftTicketPayload };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function liveSearch12306(fields: TrainFields): Promise<LiveAttempt<ShortlistItem[]>> {
  const override = process.env.TRAIN_12306_QUERY_URL;
  const fromCode = await resolveStationTelecode(fields.from);
  const toCode = await resolveStationTelecode(fields.to);
  if (!fromCode || !toCode) {
    return {
      ok: false,
      error: `Could not resolve station telecodes (from=${fields.from}→${fromCode}, to=${fields.to}→${toCode})${
        stationLoadError ? `; station list: ${stationLoadError}` : ""
      }`,
    };
  }

  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "*/*",
    Referer: "https://kyfw.12306.cn/otn/leftTicket/init?linktypeid=dc",
  };

  const jar = new Map<string, string>();
  // Warm-up to obtain JSESSIONID / BIGipServerotn — required for JSON left-ticket responses
  try {
    const warm = await fetch("https://kyfw.12306.cn/otn/leftTicket/init?linktypeid=dc", {
      headers,
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    collectCookies(warm, jar);
    await warm.arrayBuffer();
  } catch {
    // continue; query may still work with partial cookies
  }

  const buildUrl = (path: string) =>
    `https://kyfw.12306.cn/otn/${path}?leftTicketDTO.train_date=${encodeURIComponent(
      fields.date
    )}&leftTicketDTO.from_station=${fromCode}&leftTicketDTO.to_station=${toCode}&purpose_codes=ADULT`;

  const url = override ?? buildUrl("leftTicket/queryG");
  let res = await fetch12306Json(url, headers, jar);

  if (res.ok && res.data?.c_url && !res.data.data?.result?.length) {
    res = await fetch12306Json(buildUrl(res.data.c_url), headers, jar);
  }

  if ((!res.ok || !res.data?.data?.result?.length) && !override) {
    const alt = await fetch12306Json(buildUrl("leftTicket/query"), headers, jar);
    if (alt.ok && alt.data?.c_url) {
      res = await fetch12306Json(buildUrl(alt.data.c_url), headers, jar);
    } else if (alt.ok && alt.data?.data?.result?.length) {
      res = alt;
    }
  }

  if (!res.ok || !res.data) {
    return { ok: false, error: res.error ?? `12306 HTTP ${res.status}` };
  }

  if (!res.data.data?.result?.length) {
    return {
      ok: false,
      error:
        "12306 returned empty result (often captcha/IP block). Assistive-only — no captcha bypass attempted.",
    };
  }

  const items = parse12306LeftTicket(res.data, fields);
  if (!items.length) return { ok: false, error: "parsed 0 trains from 12306 payload" };
  return { ok: true, data: items };
}

async function liveSearchConfiguredApi(fields: TrainFields): Promise<LiveAttempt<ShortlistItem[]>> {
  const base = process.env.TRAIN_PUBLIC_API_URL;
  if (!base) return { ok: false, error: "TRAIN_PUBLIC_API_URL not set" };
  const url = new URL("/trains/search", base);
  url.searchParams.set("from", fields.from);
  url.searchParams.set("to", fields.to);
  url.searchParams.set("date", fields.date);
  const res = await fetchJson<{ items?: ShortlistItem[] }>(url.toString(), { timeoutMs: 8000 });
  if (!res.ok || !res.data?.items?.length) {
    return { ok: false, error: res.error ?? "empty TRAIN_PUBLIC_API_URL response" };
  }
  return { ok: true, data: res.data.items };
}

async function liveSearch(fields: TrainFields): Promise<LiveAttempt<ShortlistItem[]>> {
  if (process.env.TRAIN_PUBLIC_API_URL) {
    const viaApi = await liveSearchConfiguredApi(fields);
    if (viaApi.ok) return viaApi;
  }
  return liveSearch12306(fields);
}

export const train12306Adapter: TicketAdapter = {
  id: "train12306",
  channel: "train",
  async search(input: AdapterSearchInput): Promise<ShortlistResult> {
    const mode = resolveProviderMode(input.mode);
    const fields = input.fields as unknown as TrainFields;
    const live =
      mode === "live" ? await liveSearch(fields) : { ok: false as const, error: "fixture mode" };

    return finalizeSearchResult({
      channel: "train",
      provider: "train12306",
      requestedMode: mode,
      live,
      fixtureItems: fixtureItems(fields),
      fixtureNotes: "Fixture mode — sample 12306-style shortlist (not live inventory).",
    });
  },
};
