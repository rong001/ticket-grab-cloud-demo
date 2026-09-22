import type { ShortlistItem, ShortlistResult, ShowFields } from "../types.js";
import type { AdapterSearchInput, TicketAdapter } from "./types.js";
import {
  fetchJson,
  finalizeSearchResult,
  resolveProviderMode,
  type LiveAttempt,
} from "./liveMode.js";

/** Best-effort Dianping/Gewara myshow cityId map (client-side cityName filter is authoritative). */
export const SHOW_CITY_IDS: Record<string, string> = {
  上海: "1",
  北京: "2",
  广州: "4",
  深圳: "7",
  成都: "8",
  杭州: "14",
  重庆: "19",
  武汉: "20",
  西安: "21",
  苏州: "18",
  南京: "16",
  天津: "17",
  长沙: "22",
  郑州: "30",
  东莞: "91",
  青岛: "60",
  沈阳: "66",
  宁波: "11",
  昆明: "114",
  无锡: "13",
  厦门: "15",
  福州: "44",
  合肥: "110",
  济南: "96",
  大连: "67",
  哈尔滨: "79",
  南宁: "33",
  贵阳: "107",
  南昌: "70",
  石家庄: "24",
  太原: "26",
  长春: "116",
  兰州: "100",
  佛山: "92",
  珠海: "108",
  常州: "93",
  嘉兴: "102",
  温州: "12",
};

function fixtureItems(fields: ShowFields): ShortlistItem[] {
  const name = fields.eventName;
  const city = fields.city ?? "上海";
  const venue = fields.venue ?? "梅赛德斯-奔驰文化中心";
  const date = fields.date ?? "2026-10-18";
  const date2 = fields.date
    ? (() => {
        const d = new Date(`${fields.date}T12:00:00+08:00`);
        d.setDate(d.getDate() + 1);
        return d.toISOString().slice(0, 10);
      })()
    : "2026-10-19";
  const baseMeta = {
    platform: "fixture-damai-style",
    venue,
    city,
    posterUrl: null as string | null,
    priceRange: "580-1280",
    source: "fixture",
    sourceLabel: "演示",
    saleStatusLabel: "在售",
  };
  return [
    {
      id: `show-fix-vip-${date}`,
      channel: "show",
      title: name,
      subtitle: `${city} · ${venue} · ${date} 周六 19:30 · VIP`,
      datetime: `${date}T19:30:00+08:00`,
      price: 1280,
      currency: "CNY",
      availability: "sold_out",
      meta: {
        ...baseMeta,
        performanceId: "fixture-1",
        showId: "fx-s1",
        sessionName: `${date} 周六 19:30`,
        sessionDate: date,
        sessionTime: "19:30",
        tier: "VIP",
        saleStatusLabel: "售罄",
        hasInventory: false,
      },
    },
    {
      id: `show-fix-a-${date}`,
      channel: "show",
      title: name,
      subtitle: `${city} · ${venue} · ${date} 周六 19:30 · A区`,
      datetime: `${date}T19:30:00+08:00`,
      price: 880,
      currency: "CNY",
      availability: "limited",
      meta: {
        ...baseMeta,
        performanceId: "fixture-1",
        showId: "fx-s1",
        sessionName: `${date} 周六 19:30`,
        sessionDate: date,
        sessionTime: "19:30",
        tier: "A",
        saleStatusLabel: "即将开售",
        hasInventory: false,
        remainingHint: "少量",
      },
    },
    {
      id: `show-fix-b-${date}`,
      channel: "show",
      title: name,
      subtitle: `${city} · ${venue} · ${date} 周六 19:30 · B区`,
      datetime: `${date}T19:30:00+08:00`,
      price: 580,
      currency: "CNY",
      availability: "available",
      meta: {
        ...baseMeta,
        performanceId: "fixture-1",
        showId: "fx-s1",
        sessionName: `${date} 周六 19:30`,
        sessionDate: date,
        sessionTime: "19:30",
        tier: "B",
        saleStatusLabel: "在售",
        hasInventory: true,
      },
    },
    {
      id: `show-fix-s2-${date2}`,
      channel: "show",
      title: name,
      subtitle: `${city} · ${venue} · ${date2} 周日 19:30`,
      datetime: `${date2}T19:30:00+08:00`,
      price: 580,
      currency: "CNY",
      availability: "available",
      meta: {
        ...baseMeta,
        performanceId: "fixture-1",
        showId: "fx-s2",
        sessionName: `${date2} 周日 19:30`,
        sessionDate: date2,
        sessionTime: "19:30",
        saleStatusLabel: "在售",
        hasInventory: true,
      },
    },
  ];
}

/** Human-readable sale badge: 在售 / 即将开售 / 缺货登记 / 售罄 */
export function saleStatusLabel(opts: {
  ticketStatus?: unknown;
  saleLabel?: unknown;
  stockOut?: boolean;
  stockOutRegister?: unknown;
  hasInventory?: boolean;
  availability?: ShortlistItem["availability"];
}): string {
  if (opts.stockOut || opts.availability === "sold_out") {
    if (Number(opts.stockOutRegister) === 1) return "缺货登记";
    return "售罄";
  }
  if (opts.hasInventory === true || opts.availability === "available") return "在售";
  const s = Number(opts.ticketStatus);
  const sale = Number(opts.saleLabel);
  if (s === 3 || sale === 3 || opts.availability === "limited") return "即将开售";
  if (s === 1 || s === 2 || sale === 1 || sale === 2) return "在售";
  if (s === 0) return Number(opts.stockOutRegister) === 1 ? "缺货登记" : "售罄";
  if (opts.availability === "waitlist") return "缺货登记";
  return "未知";
}

/** Map Dianping/Gewara ticketStatus / saleLabel to availability. */
export function mapShowAvailability(
  ticketStatus: unknown,
  saleLabel?: unknown,
  hasInventory?: boolean
): ShortlistItem["availability"] {
  if (hasInventory === true) return "available";
  if (hasInventory === false) {
    const s = Number(ticketStatus);
    const sale = Number(saleLabel);
    if (s === 3 || sale === 3) return "limited"; // 即将开售
    if (s === 0) return "sold_out";
    // On-sale performance but this session has no inventory → waitlist/缺货登记
    if (s === 1 || s === 2 || sale === 1 || sale === 2) return "waitlist";
  }
  const s = Number(ticketStatus);
  const sale = Number(saleLabel);
  if (s === 1 || s === 2) return "available";
  if (sale === 1 || sale === 2) return "available";
  if (s === 3 || sale === 3) return "limited";
  if (s === 0) return "sold_out";
  return "unknown";
}

export function extractPerformanceId(fields: ShowFields): string | null {
  if (fields.performanceId != null && String(fields.performanceId).trim()) {
    return String(fields.performanceId).trim();
  }
  if (fields.detailUrl) {
    const m =
      fields.detailUrl.match(/\/(?:detail|p)\/(\d+)/i) ??
      fields.detailUrl.match(/[?&]id=(\d+)/i);
    if (m) return m[1];
  }
  const m2 = fields.eventName.match(/#(\d{4,})/);
  return m2 ? m2[1] : null;
}

export function resolveCityId(city?: string): string {
  if (!city) return "1";
  const trimmed = city.trim();
  if (SHOW_CITY_IDS[trimmed]) return SHOW_CITY_IDS[trimmed];
  for (const [name, id] of Object.entries(SHOW_CITY_IDS)) {
    if (trimmed.includes(name) || name.includes(trimmed)) return id;
  }
  return "1";
}

export interface DianpingPerformance {
  performanceId?: number;
  name?: string;
  shopName?: string;
  cityName?: string;
  cityId?: number;
  address?: string;
  showTimeRange?: string;
  priceRange?: string;
  lowestPrice?: number;
  ticketStatus?: number;
  saleStatus?: number;
  performanceLabelVO?: { saleLabel?: number };
  stockOut?: boolean;
  stockOutRegister?: number;
  posterUrl?: string;
  saleRemindVO?: {
    needRemind?: number;
    onSaleTime?: number;
    onSaleStatus?: number;
  };
}

export interface DianpingShowSession {
  name?: string;
  showId?: number;
  performanceId?: number;
  startTimeDateFormatted?: string;
  startTimeWeekFormatted?: string;
  startTimeTimeFormatted?: string;
  hasInventory?: boolean;
  startTime?: number;
  endTime?: number;
  ticketClassIds?: number[];
  showNote?: string;
  ticketIdHasInventoryMap?: Record<string, boolean>;
}

export interface DianpingTicketClass {
  ticketClassId?: number;
  performanceId?: number;
  ticketPrice?: number;
  name?: string | null;
  hasInventory?: boolean;
  showIds?: number[];
}

export function matchCityFilter(
  performanceCity: string | undefined,
  wanted?: string
): boolean {
  if (!wanted?.trim()) return true;
  if (!performanceCity) return true;
  const w = wanted.trim();
  return performanceCity.includes(w) || w.includes(performanceCity);
}

export function matchDateFilter(
  sessionDate: string | undefined,
  wanted?: string
): boolean {
  if (!wanted?.trim()) return true;
  if (!sessionDate) return true;
  return sessionDate.startsWith(wanted.trim());
}

function msToIso(ms?: number): string | undefined {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return undefined;
  try {
    return new Date(ms).toISOString();
  } catch {
    return undefined;
  }
}

function priceFromPerformance(data: DianpingPerformance): number | undefined {
  if (typeof data.lowestPrice === "number") return data.lowestPrice;
  if (data.priceRange) {
    const n = Number(String(data.priceRange).split("-")[0]);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Dedupe ticket classes by price; prefer rows with inventory / matching showId. */
export function uniqueTicketTiers(
  tickets: DianpingTicketClass[],
  showId?: number
): DianpingTicketClass[] {
  const relevant = tickets.filter((t) => {
    if (!t.showIds || t.showIds.length === 0) return true;
    if (showId == null) return true;
    return t.showIds.includes(showId);
  });
  const byPrice = new Map<number, DianpingTicketClass>();
  for (const t of relevant) {
    if (typeof t.ticketPrice !== "number") continue;
    const existing = byPrice.get(t.ticketPrice);
    if (!existing || (t.hasInventory && !existing.hasInventory)) {
      byPrice.set(t.ticketPrice, t);
    }
  }
  return Array.from(byPrice.values()).sort(
    (a, b) => (a.ticketPrice ?? 0) - (b.ticketPrice ?? 0)
  );
}

/**
 * Suggest 开售提醒 / 预约抢票 schedule from live meta.
 * Aligns startsAt to onSaleTime when known; uses 1-min interval near onsale.
 */
export function suggestShowWatch(items: Array<{ availability?: string; meta?: Record<string, unknown> | null }>): {
  startsAt?: Date;
  intervalMinutes: number;
  reason: string;
  onSaleTimeMs?: number;
} {
  const now = Date.now();
  const onSaleTimes = items
    .map((i) => i.meta?.onSaleTime)
    .filter((t): t is number => typeof t === "number" && Number.isFinite(t));
  const future = onSaleTimes.filter((t) => t > now - 60_000);
  if (future.length) {
    const soonest = Math.min(...future);
    const msUntil = soonest - now;
    const startsAt = new Date(Math.max(now, soonest - 30_000));
    const intervalMinutes = msUntil <= 2 * 60 * 60 * 1000 ? 1 : msUntil <= 24 * 60 * 60 * 1000 ? 5 : 15;
    return {
      startsAt,
      intervalMinutes,
      reason: "已对齐公开开售时间（开售提醒）",
      onSaleTimeMs: soonest,
    };
  }
  if (items.some((i) => i.availability === "limited")) {
    return { intervalMinutes: 1, reason: "即将开售 — 建议 1 分钟高频提醒" };
  }
  if (items.some((i) => i.availability === "available")) {
    return { intervalMinutes: 5, reason: "在售有票 — 有票提醒默认 5 分钟" };
  }
  return { intervalMinutes: 5, reason: "预约抢票默认间隔" };
}

/** Expand one performance + its sessions into shortlist items (场次 × 票档 when API returns tiers). */
export function sessionsToItems(
  performance: DianpingPerformance,
  sessions: DianpingShowSession[],
  fields: ShowFields,
  tickets?: DianpingTicketClass[]
): ShortlistItem[] {
  if (!performance?.name && !performance?.performanceId) return [];
  const perfId = String(performance.performanceId ?? fields.performanceId ?? "unknown");
  const city = performance.cityName ?? fields.city;
  const venue = performance.shopName ?? fields.venue;
  const price = priceFromPerformance(performance);
  const saleLabel = performance.performanceLabelVO?.saleLabel;
  const posterUrl = performance.posterUrl;

  const uniquePrices = Array.from(
    new Set(
      (tickets ?? [])
        .map((t) => t.ticketPrice)
        .filter((p): p is number => typeof p === "number")
        .sort((a, b) => a - b)
    )
  );

  const list = sessions.length
    ? sessions
    : [
        {
          name: performance.showTimeRange ?? "场次待公布",
          showId: 0,
          performanceId: performance.performanceId,
          startTimeDateFormatted: fields.date,
          hasInventory: undefined,
        } satisfies DianpingShowSession,
      ];

  const items: ShortlistItem[] = [];
  for (const session of list) {
    const sessionDate = session.startTimeDateFormatted;
    if (!matchDateFilter(sessionDate, fields.date)) continue;

    const sessionAvailability = performance.stockOut
      ? "sold_out"
      : mapShowAvailability(
          performance.ticketStatus,
          saleLabel,
          session.hasInventory
        );
    const sessionName =
      session.name ??
      [sessionDate, session.startTimeWeekFormatted, session.startTimeTimeFormatted]
        .filter(Boolean)
        .join(" ");
    const showId = session.showId != null ? String(session.showId) : "0";
    const datetime =
      msToIso(session.startTime) ??
      (sessionDate && session.startTimeTimeFormatted
        ? `${sessionDate}T${session.startTimeTimeFormatted}:00+08:00`
        : undefined);

    const tiers = uniqueTicketTiers(tickets ?? [], session.showId);
    const tierList: Array<DianpingTicketClass | undefined> = tiers.length ? tiers : [undefined];

    for (const tier of tierList) {
      const availability = tier
        ? performance.stockOut
          ? "sold_out"
          : mapShowAvailability(
              performance.ticketStatus,
              saleLabel,
              tier.hasInventory ?? session.hasInventory
            )
        : sessionAvailability;
      const label = saleStatusLabel({
        ticketStatus: performance.ticketStatus,
        saleLabel,
        stockOut: performance.stockOut,
        stockOutRegister: performance.stockOutRegister,
        hasInventory: tier?.hasInventory ?? session.hasInventory,
        availability,
      });
      const tierName =
        (typeof tier?.name === "string" && tier.name.trim()) ||
        (tier?.ticketPrice != null ? `¥${tier.ticketPrice}` : undefined);
      const itemPrice = tier?.ticketPrice ?? price;
      const tierSuffix = tier?.ticketClassId != null ? `-t${tier.ticketClassId}` : "";

      items.push({
        id: `show-${perfId}-${showId}${tierSuffix}`,
        channel: "show",
        title: performance.name ?? fields.eventName,
        subtitle: [
          city,
          venue,
          sessionName,
          tierName,
          performance.priceRange ? `¥${performance.priceRange}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        datetime,
        price: itemPrice,
        currency: "CNY",
        availability,
        meta: {
          platform: "gewara/dianping-myshow",
          performanceId: performance.performanceId ?? (Number(perfId) || perfId),
          showId: session.showId ?? 0,
          sessionName,
          sessionDate,
          sessionTime: session.startTimeTimeFormatted,
          sessionWeek: session.startTimeWeekFormatted,
          venue,
          city,
          address: performance.address,
          posterUrl,
          showTimeRange: performance.showTimeRange,
          priceRange: performance.priceRange,
          ticketPrices: uniquePrices,
          ticketClassId: tier?.ticketClassId,
          tier: tierName,
          ticketStatus: performance.ticketStatus,
          saleStatus: performance.saleStatus,
          saleStatusLabel: label,
          hasInventory: (tier?.hasInventory ?? session.hasInventory) === true,
          stockOutRegister: performance.stockOutRegister,
          onSaleTime: performance.saleRemindVO?.onSaleTime,
          source: "m.dianping.com/myshow",
          sourceLabel: "实时(猫眼/格瓦拉/点评场次)",
        },
      });
    }
  }
  return items;
}

/** Legacy single-item mapper (kept for tests / search list without sessions). */
export function performanceToItems(
  data: DianpingPerformance,
  fields: ShowFields
): ShortlistItem[] {
  return sessionsToItems(data, [], fields);
}

const DIANPING_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://www.gewara.com/",
  Origin: "https://www.gewara.com",
};

async function fetchPerformanceDetailRaw(
  performanceId: string
): Promise<LiveAttempt<DianpingPerformance>> {
  const url = `https://m.dianping.com/myshow/ajax/performance/${performanceId};poi=false?sellChannel=7`;
  const res = await fetchJson<{ code?: number; data?: DianpingPerformance; msg?: string }>(url, {
    timeoutMs: 12_000,
    headers: DIANPING_HEADERS,
  });
  if (!res.ok || !res.data) {
    return { ok: false, error: res.error ?? `HTTP ${res.status}` };
  }
  if (res.data.code !== 200 || !res.data.data) {
    return {
      ok: false,
      error: `Dianping myshow detail code=${res.data.code} msg=${res.data.msg ?? ""}`.trim(),
    };
  }
  return { ok: true, data: res.data.data };
}

async function fetchShowSessions(
  performanceId: string
): Promise<LiveAttempt<DianpingShowSession[]>> {
  const url = `https://m.dianping.com/myshow/ajax/performance/${performanceId}/shows?sellChannel=7`;
  const res = await fetchJson<{ code?: number; data?: DianpingShowSession[]; msg?: string }>(url, {
    timeoutMs: 12_000,
    headers: DIANPING_HEADERS,
  });
  if (!res.ok || !res.data) {
    return { ok: false, error: res.error ?? `HTTP ${res.status}` };
  }
  if (res.data.code !== 200 || !Array.isArray(res.data.data)) {
    return {
      ok: false,
      error: `Dianping shows code=${res.data.code} msg=${res.data.msg ?? ""}`.trim(),
    };
  }
  return { ok: true, data: res.data.data };
}

async function fetchTicketClasses(
  performanceId: string,
  showId?: string | number
): Promise<LiveAttempt<DianpingTicketClass[]>> {
  const qs = showId != null ? `?showId=${showId}&sellChannel=7` : `?sellChannel=7`;
  const url = `https://m.dianping.com/myshow/ajax/performance/${performanceId}/tickets${qs}`;
  const res = await fetchJson<{ code?: number; data?: DianpingTicketClass[]; msg?: string }>(url, {
    timeoutMs: 12_000,
    headers: DIANPING_HEADERS,
  });
  if (!res.ok || !res.data) {
    return { ok: false, error: res.error ?? `HTTP ${res.status}` };
  }
  if (res.data.code !== 200 || !Array.isArray(res.data.data)) {
    return {
      ok: false,
      error: `Dianping tickets code=${res.data.code} msg=${res.data.msg ?? ""}`.trim(),
    };
  }
  return { ok: true, data: res.data.data };
}

async function expandPerformanceSessions(
  performance: DianpingPerformance,
  fields: ShowFields
): Promise<ShortlistItem[]> {
  const id = String(performance.performanceId ?? "");
  if (!id) return performanceToItems(performance, fields);

  const [showsRes, ticketsRes] = await Promise.all([
    fetchShowSessions(id),
    fetchTicketClasses(id),
  ]);
  const sessions = showsRes.ok && showsRes.data ? showsRes.data : [];
  const tickets = ticketsRes.ok && ticketsRes.data ? ticketsRes.data : [];
  const items = sessionsToItems(performance, sessions, fields, tickets);
  if (items.length) return items;
  // Fallback: performance card without expandable sessions
  return performanceToItems(performance, fields);
}

async function fetchPerformanceDetail(performanceId: string, fields: ShowFields): Promise<LiveAttempt<ShortlistItem[]>> {
  const detail = await fetchPerformanceDetailRaw(performanceId);
  if (!detail.ok || !detail.data) {
    return { ok: false, error: detail.error ?? "detail fetch failed" };
  }
  const items = await expandPerformanceSessions(detail.data, {
    ...fields,
    eventName: detail.data.name ?? fields.eventName,
    performanceId,
  });
  if (!items.length) return { ok: false, error: "performance has no parseable sessions" };
  return { ok: true, data: items };
}

async function searchPerformances(fields: ShowFields): Promise<LiveAttempt<ShortlistItem[]>> {
  const cityId = resolveCityId(fields.city);
  const keyword = encodeURIComponent(fields.eventName);
  const url =
    `https://m.dianping.com/myshow/ajax/performances/0;st=0;k=${keyword};p=1;s=10;tft=0?cityId=${cityId}&sellChannel=7`;
  const res = await fetchJson<{ code?: number; data?: DianpingPerformance[]; msg?: string }>(url, {
    timeoutMs: 12_000,
    headers: DIANPING_HEADERS,
  });
  if (!res.ok || !res.data) return { ok: false, error: res.error ?? `HTTP ${res.status}` };
  if (res.data.code !== 200 || !Array.isArray(res.data.data) || res.data.data.length === 0) {
    return {
      ok: false,
      error: `Dianping search empty/code=${res.data.code} msg=${res.data.msg ?? ""}`.trim(),
    };
  }

  const filtered = res.data.data.filter((d) => matchCityFilter(d.cityName, fields.city));
  const pool = filtered.length ? filtered : res.data.data;
  // Expand top matches into live 场次 (cap to keep latency reasonable)
  const top = pool.slice(0, 5);
  const batches = await Promise.all(top.map((p) => expandPerformanceSessions(p, fields)));
  const items = batches.flat();
  if (!items.length) {
    // Search hit but date filter / session expand emptied — report honestly
    const fallback = pool.flatMap((d) => performanceToItems(d, fields));
    if (!fallback.length) return { ok: false, error: "search returned rows but none parseable" };
    return { ok: true, data: fallback };
  }
  return { ok: true, data: items };
}

async function liveSearchConfiguredApi(fields: ShowFields): Promise<LiveAttempt<ShortlistItem[]>> {
  const base = process.env.SHOW_PUBLIC_API_URL;
  if (!base) return { ok: false, error: "SHOW_PUBLIC_API_URL not set" };
  const url = new URL("/shows/search", base);
  url.searchParams.set("q", fields.eventName);
  if (fields.city) url.searchParams.set("city", fields.city);
  if (fields.date) url.searchParams.set("date", fields.date);
  const res = await fetchJson<{ items?: ShortlistItem[] }>(url.toString(), { timeoutMs: 8000 });
  if (!res.ok || !res.data?.items?.length) {
    return { ok: false, error: res.error ?? "empty SHOW_PUBLIC_API_URL response" };
  }
  return { ok: true, data: res.data.items };
}

async function liveSearch(fields: ShowFields): Promise<LiveAttempt<ShortlistItem[]>> {
  if (process.env.SHOW_PUBLIC_API_URL) {
    const viaApi = await liveSearchConfiguredApi(fields);
    if (viaApi.ok) return viaApi;
  }
  const id = extractPerformanceId(fields);
  if (id) {
    const detail = await fetchPerformanceDetail(id, fields);
    if (detail.ok) return detail;
    const search = await searchPerformances(fields);
    if (search.ok) return search;
    return { ok: false, error: detail.error ?? search.error };
  }
  return searchPerformances(fields);
}


export type VenueOption = {
  value: string;
  label: string;
  city: string;
  category: string;
  performanceCount?: number;
  source: string;
};

/** Well-known venues used when live city search is sparse or fails (labeled curated, not live). */
export const CURATED_SHOW_VENUES: Record<string, string[]> = {
  北京: ["国家体育场（鸟巢）", "工人体育馆", "首都体育馆", "国家体育馆", "北京展览馆剧场", "保利剧院"],
  上海: ["梅赛德斯-奔驰文化中心", "上海体育馆", "虹口足球场", "静安体育中心", "上海大剧院", "美琪大戏院"],
  广州: ["广州体育馆", "宝能观致文化中心", "广州大剧院", "天河体育中心"],
  深圳: ["深圳湾体育中心", "春茧体育馆", "宝安体育场", "深圳保利剧院", "深圳音乐厅"],
  成都: ["成都东安湖体育公园", "成都凤凰山体育公园", "成都体育中心", "保利剧院"],
  杭州: ["杭州奥体中心", "黄龙体育中心", "杭州大剧院"],
  南京: ["南京奥体中心", "南京五台山体育中心", "江苏大剧院"],
  武汉: ["武汉体育中心", "武汉琴台大剧院", "武汉客厅中国文化博览中心"],
  西安: ["西安奥体中心", "陕西省体育场", "西安音乐厅"],
  重庆: ["重庆奥体中心", "华熙LIVE·鱼洞", "重庆大剧院"],
};

/**
 * Derive venue list for a city from live Dianping/Gewara public search.
 * Cascades multiple keywords when sparse; merges curated venues (source=curated) as fallback.
 * Uses public myshow search (no Damai auth). Dedupes by shopName.
 */
export async function searchVenuesByCity(
  city: string,
  opts?: { keyword?: string; limit?: number }
): Promise<{
  ok: boolean;
  items: VenueOption[];
  error?: string;
  source: string;
  liveCount: number;
  curatedCount: number;
  sparse: boolean;
}> {
  const cityName = city.trim();
  if (!cityName) {
    return {
      ok: false,
      items: [],
      error: "city required",
      source: "dianping-myshow",
      liveCount: 0,
      curatedCount: 0,
      sparse: true,
    };
  }
  const limit = Math.min(Math.max(opts?.limit ?? 40, 1), 80);
  const cityId = resolveCityId(cityName);
  const userKw = opts?.keyword?.trim();
  // Cascade: user keyword first, then category + venue-ish terms, then city name.
  const keywords = [
    userKw,
    "演唱会",
    "音乐剧",
    "话剧",
    "体育",
    "脱口秀",
    "剧院",
    "体育场",
    "体育馆",
    "演出",
    cityName,
  ].filter((k): k is string => !!k && k.length > 0);
  // Dedupe keywords while preserving order
  const seenKw = new Set<string>();
  const uniqueKw = keywords.filter((k) => {
    if (seenKw.has(k)) return false;
    seenKw.add(k);
    return true;
  });

  const seen = new Map<string, VenueOption>();
  let lastError: string | undefined;
  let anyLiveOk = false;

  for (const kw of uniqueKw) {
    if (seen.size >= limit) break;
    const url =
      `https://m.dianping.com/myshow/ajax/performances/0;st=0;k=${encodeURIComponent(kw)};p=1;s=20;tft=0?cityId=${cityId}&sellChannel=7`;
    const res = await fetchJson<{ code?: number; data?: DianpingPerformance[]; msg?: string }>(url, {
      timeoutMs: 10_000,
      headers: DIANPING_HEADERS,
    });
    if (!res.ok || !res.data) {
      lastError = res.error ?? `HTTP ${res.status}`;
      continue;
    }
    if (res.data.code !== 200 || !Array.isArray(res.data.data)) {
      lastError = `code=${res.data.code} msg=${res.data.msg ?? ""}`.trim();
      continue;
    }
    anyLiveOk = true;
    for (const row of res.data.data) {
      if (!matchCityFilter(row.cityName, cityName) && row.cityName) continue;
      const venue = (row.shopName ?? "").trim();
      if (!venue) continue;
      const key = venue.toLowerCase();
      const existing = seen.get(key);
      if (existing) {
        existing.performanceCount = (existing.performanceCount ?? 1) + 1;
        continue;
      }
      seen.set(key, {
        value: venue,
        label: venue,
        city: row.cityName ?? cityName,
        category: cityName,
        performanceCount: 1,
        source: "dianping-myshow",
      });
      if (seen.size >= limit) break;
    }
    // If we already have a healthy set after first few cascades, stop early.
    if (seen.size >= Math.min(12, limit) && !userKw) break;
  }

  const liveCount = seen.size;
  const sparse = liveCount < 5;

  // Merge curated when sparse or empty — clearly labeled, never as live inventory.
  let curatedCount = 0;
  const curated = CURATED_SHOW_VENUES[cityName] ?? [];
  if (sparse || !anyLiveOk) {
    for (const name of curated) {
      if (seen.size >= limit) break;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      if (userKw && !name.includes(userKw) && !userKw.includes(name.slice(0, 2))) continue;
      seen.set(key, {
        value: name,
        label: `${name}（常用场馆）`,
        city: cityName,
        category: cityName,
        performanceCount: 0,
        source: "curated",
      });
      curatedCount += 1;
    }
  }

  const items = [...seen.values()].sort(
    (a, b) =>
      (b.source === "dianping-myshow" ? 1 : 0) - (a.source === "dianping-myshow" ? 1 : 0) ||
      (b.performanceCount ?? 0) - (a.performanceCount ?? 0) ||
      a.label.localeCompare(b.label, "zh")
  );

  if (!items.length) {
    return {
      ok: false,
      items: [],
      error: lastError ?? "no venues found for city",
      source: "dianping-myshow",
      liveCount: 0,
      curatedCount: 0,
      sparse: true,
    };
  }

  const source =
    liveCount > 0 && curatedCount > 0
      ? "dianping-myshow+curated"
      : liveCount > 0
        ? "dianping-myshow"
        : "curated";

  return {
    ok: anyLiveOk && liveCount > 0,
    items,
    error: anyLiveOk ? undefined : lastError,
    source,
    liveCount,
    curatedCount,
    sparse,
  };
}


export const showAdapter: TicketAdapter = {
  id: "show",
  channel: "show",
  async search(input: AdapterSearchInput): Promise<ShortlistResult> {
    const mode = resolveProviderMode(input.mode);
    const fields = input.fields as unknown as ShowFields;
    const live =
      mode === "live" ? await liveSearch(fields) : { ok: false as const, error: "fixture mode" };

    const result = finalizeSearchResult({
      channel: "show",
      provider: "show",
      requestedMode: mode,
      live,
      fixtureItems: fixtureItems(fields),
      fixtureNotes: "Fixture mode — sample Damai-inspired sessions/tiers (not live inventory).",
    });

    if (result.liveOk) {
      result.notes =
        "Live sessions from Dianping/Gewara myshow (猫眼/格瓦拉/点评公开场次). Damai official APIs often need login/risk control — checkout remains assistive handoff to 大麦/猫眼.";
    }
    return result;
  },
};
