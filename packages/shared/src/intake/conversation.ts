/**
 * Chinese conversational ticket-intake extractor (rule-based, no LLM required).
 * Collects: channel, from/to (station/venue), date, time window, seat/class/tier,
 * passenger count, grab-start time — one missing field at a time.
 */

import { isKnownTrainStationName, resolveTrainStation } from "./knownStations.js";
import {
  resolveAirport,
  formatAirportChoices,
  isConcreteAirportLabel,
  type AirportInfo,
} from "./knownAirports.js";

export type IntakeChannel = "train" | "show" | "flight";

export type IntakeFields = {
  channel?: IntakeChannel;
  from?: string;
  to?: string;
  fromCity?: string;
  toCity?: string;
  venue?: string;
  eventName?: string;
  date?: string;
  timeWindow?: string;
  seatClass?: string;
  tier?: string;
  cabin?: string;
  passengers?: number;
  grabStartAt?: string; // ISO
  intervalMinutes?: number;
};

export type IntakeSession = {
  fields: IntakeFields;
  history: { role: "user" | "assistant"; text: string }[];
};

const FIELD_ORDER_TRAIN: (keyof IntakeFields)[] = [
  "channel",
  "from",
  "to",
  "date",
  "timeWindow",
  "seatClass",
  "passengers",
  "grabStartAt",
];

const FIELD_ORDER_SHOW: (keyof IntakeFields)[] = [
  "channel",
  "eventName",
  "venue",
  "date",
  "tier",
  "passengers",
  "grabStartAt",
];

const FIELD_ORDER_FLIGHT: (keyof IntakeFields)[] = [
  "channel",
  "from",
  "to",
  "date",
  "timeWindow",
  "cabin",
  "passengers",
  "grabStartAt",
];

const QUESTIONS: Record<string, string> = {
  channel: "请问您要找哪类票？回复「火车」「演出」或「机票」。",
  from: "请告诉我确切出发站/机场（不要只写多机场城市）。例如「北京南」「深圳宝安」「SZX」。",
  to: "请告诉我确切到达站/机场（不要只写多机场城市）。例如「上海虹桥」「上海浦东」「PVG」。",
  eventName: "请告诉我演出/活动名称（可附带城市）。",
  venue: "演出场馆是哪里？（没有可回复「未知」）。",
  date: "出行/观演日期是哪天？（格式 YYYY-MM-DD，或「明天」「下周五」）。",
  timeWindow: "希望的时间段？（例如「08:00-12:00」「下午」「晚上」，没有可回复「不限」）。",
  seatClass: "偏好席别？（二等座/一等座/商务座等，没有可回复「不限」）。",
  tier: "偏好票档？（例如「680」「内场」，没有可回复「不限」）。",
  cabin: "舱位偏好？（经济舱/商务舱等，没有可回复「不限」）。",
  passengers: "几位乘客/观演人？（数字 1-9）。",
  grabStartAt: "何时开始盯票/开抢/开售监控？（例如「现在」「今晚20:00」「2026-10-01 09:00」）。",
};

function normalizeDateToken(raw: string, now = new Date()): string | undefined {
  const s = raw.trim();
  const m = s.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (m) {
    return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  }
  const mYear = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日?/);
  if (mYear) {
    return `${mYear[1]}-${mYear[2]!.padStart(2, "0")}-${mYear[3]!.padStart(2, "0")}`;
  }
  const m2 = s.match(/(\d{1,2})月(\d{1,2})日/);
  if (m2) {
    const y = now.getFullYear();
    return `${y}-${m2[1]!.padStart(2, "0")}-${m2[2]!.padStart(2, "0")}`;
  }
  if (/今天|今日/.test(s)) return isoDate(now);
  if (/明天|明日/.test(s)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return isoDate(d);
  }
  if (/后天/.test(s)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    return isoDate(d);
  }
  // Weekday-only (周五 / 下周一) is ambiguous without calendar confirm — do not auto-fill.
  // Caller will ask for exact YYYY-MM-DD via nextMissingField("date").
  if (/下?周[日天一二三四五六]/.test(s)) {
    return undefined;
  }
  return undefined;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Asia/Shanghai wall-clock parts for `now`. */
function shanghaiParts(now: Date): { y: number; m: number; d: number; h: number; min: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).filter((p) => p.type !== "literal").map((p) => [p.type, p.value])
  );
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour === "24" ? "0" : parts.hour),
    min: Number(parts.minute),
  };
}

/** Build ISO Z from Asia/Shanghai local civil time. */
function shanghaiLocalToIso(y: number, m: number, d: number, h: number, min: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return new Date(`${y}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(min)}:00+08:00`).toISOString();
}

/** Format ISO instant as Asia/Shanghai wall clock for confirmation / UI summaries. */
export function formatShanghaiDateTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).filter((p) => p.type !== "literal").map((p) => [p.type, p.value])
  );
  const hh = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day} ${hh}:${parts.minute} +08:00`;
}

function addShanghaiDays(y: number, m: number, d: number, delta: number): { y: number; m: number; d: number } {
  // Noon UTC+8 avoids DST edge issues (China has no DST).
  const base = new Date(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T12:00:00+08:00`);
  base.setTime(base.getTime() + delta * 86400000);
  const p = shanghaiParts(base);
  return { y: p.y, m: p.m, d: p.d };
}

/**
 * Explicit 开抢/盯票 phrasing (or bare 现在/立刻 when that is the whole answer).
 * Travel windows like「上午8点到10点」/「8点出发」 must NOT count.
 */
function hasExplicitGrabStartIntent(s: string): boolean {
  if (/开抢|盯票|开始抢|开始盯|抢票开始|盯票开始|开盯|开始监控|开始看票|开始抢票|开始盯票/.test(s)) {
    return true;
  }
  // Bare immediacy answers (short-answer or standalone)
  if (/^(现在|立刻|马上|立即)([!！。.\s]*)$/.test(s.trim())) return true;
  if (/(现在|立刻|马上|立即)\s*(开抢|盯票|开始抢|开始盯|开始|抢票|盯票)/.test(s)) return true;
  return false;
}

/** True when utterance contains a travel time *range* (never a grab-start by itself). */
function hasTravelTimeRange(s: string): boolean {
  return (
    /(\d{1,2}:\d{2})\s*[-~～到至]\s*(\d{1,2}:\d{2})/.test(s) ||
    /(\d{1,2})\s*[:：点]\s*(?:\d{2}\s*)?[-~～到至]\s*(\d{1,2})\s*[:：点]?/.test(s) ||
    /(上午|早上|早晨|中午|下午|晚上|傍晚).{0,6}(\d{1,2})\s*[:：点].{0,6}(到|至|-|~|～).{0,6}(\d{1,2})\s*[:：点]?/.test(s)
  );
}

/**
 * Parse grab-start datetime.
 * @param requireIntent When true (free-form extract), only accept explicit 开抢/盯票/现在 phrasing.
 *                      When false (assistant asked for grabStartAt), accept short time answers.
 * Times interpreted in Asia/Shanghai; returned as ISO Z. Past times → undefined.
 */
function parseGrabStart(
  raw: string,
  now = new Date(),
  requireIntent = true
): string | undefined {
  const s = raw.trim();
  if (!s) return undefined;

  // Free-form: never invent grabStartAt from travel windows / bare clocks / 出发 times.
  if (requireIntent) {
    if (!hasExplicitGrabStartIntent(s)) return undefined;
  } else {
    // Short-answer mode: still refuse pure travel ranges (user pasted window by mistake)
    if (hasTravelTimeRange(s) && !hasExplicitGrabStartIntent(s)) return undefined;
    if (/出发/.test(s) && !hasExplicitGrabStartIntent(s)) return undefined;
  }

  const sp = shanghaiParts(now);
  const futureOrNear = (iso: string): string | undefined => {
    if (new Date(iso).getTime() < now.getTime() - 60_000) return undefined;
    return iso;
  };

  // Immediacy: 现在 / 立刻开抢 / 马上盯票 — ignore unrelated travel clocks elsewhere.
  // Reject only when a clock is attached to the immediacy word itself (现在8点开抢).
  if (/(现在|立刻|马上|立即)(?!\s*\d)/.test(s)) {
    return now.toISOString();
  }

  const GRAB_KW = String.raw`(?:开抢|盯票|开始抢|开始盯|抢票开始|盯票开始|开盯|开始监控|开始看票|开始抢票|开始盯票|开抢时间)`;

  /**
   * Dual-date priority: explicit calendar datetime in the grab clause
   * (「YYYY-MM-DD HH:MM开始盯票」 / 「11月20日9点开始盯票」) MUST win over
   * 「明天」 inference, travel date alone, or unbound first clock → today/tomorrow.
   */
  const grabCalYmd =
    s.match(
      new RegExp(
        String.raw`(\d{4})[./-](\d{1,2})[./-](\d{1,2})[ T]?(\d{1,2})[:：](\d{2})\s*(?:开始)?` + GRAB_KW
      )
    ) ||
    s.match(
      new RegExp(
        String.raw`(\d{4})年(\d{1,2})月(\d{1,2})日?\s*(\d{1,2})[:：点](\d{2})?\s*(?:开始)?` + GRAB_KW
      )
    );
  if (grabCalYmd) {
    const iso = shanghaiLocalToIso(
      Number(grabCalYmd[1]),
      Number(grabCalYmd[2]),
      Number(grabCalYmd[3]),
      Number(grabCalYmd[4]),
      Number(grabCalYmd[5] ?? 0)
    );
    return futureOrNear(iso);
  }

  const grabCalMd =
    s.match(
      new RegExp(
        String.raw`(\d{1,2})月(\d{1,2})日\s*(\d{1,2})[:：点](\d{2})?\s*(?:开始)?` + GRAB_KW
      )
    );
  if (grabCalMd) {
    const iso = shanghaiLocalToIso(
      sp.y,
      Number(grabCalMd[1]),
      Number(grabCalMd[2]),
      Number(grabCalMd[3]),
      Number(grabCalMd[4] ?? 0)
    );
    return futureOrNear(iso);
  }

  // Explicit calendar + clock near grab even if keyword order is 「开抢 … 2026-11-20 09:00」
  const grabThenCal =
    s.match(
      new RegExp(
        GRAB_KW +
          String.raw`[^\d]{0,12}(\d{4})[./-](\d{1,2})[./-](\d{1,2})[ T]?(\d{1,2})[:：](\d{2})`
      )
    ) ||
    s.match(
      new RegExp(
        GRAB_KW + String.raw`[^\d]{0,12}(\d{1,2})月(\d{1,2})日\s*(\d{1,2})[:：点](\d{2})?`
      )
    );
  if (grabThenCal) {
    const g = grabThenCal;
    if (g[0].includes("月")) {
      const iso = shanghaiLocalToIso(sp.y, Number(g[1]), Number(g[2]), Number(g[3]), Number(g[4] ?? 0));
      return futureOrNear(iso);
    }
    const iso = shanghaiLocalToIso(Number(g[1]), Number(g[2]), Number(g[3]), Number(g[4]), Number(g[5]));
    return futureOrNear(iso);
  }

  // Explicit calendar+clock bound to grab clause (NOT a lone travel date at sentence start).
  // Blocks 「明天」 / today-roll from overriding 「2026-11-20 09:00开始盯票」.
  const hasExplicitGrabCalendar =
    new RegExp(
      String.raw`(?:\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}月\d{1,2}日)\s*\d{1,2}[:：点].{0,12}` +
        GRAB_KW
    ).test(s) ||
    new RegExp(
      GRAB_KW +
        String.raw`.{0,12}(?:\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}月\d{1,2}日)\s*\d{1,2}[:：点]`
    ).test(s);

  // Relative day + clock near grab: 明天8点开抢 / 今晚20:00 — never override explicit calendar grab.
  if (!hasExplicitGrabCalendar) {
    const rel = s.match(
      new RegExp(
        String.raw`(今晚|今天|今日|明天|明日|后天)\s*(\d{1,2})[:：点](\d{2})?\s*(?:开始)?` + GRAB_KW
      )
    ) ||
      // also 「开抢明天8点」 rare; and short-answer 「明天9点」
      (!requireIntent || hasExplicitGrabStartIntent(s)
        ? s.match(/(今晚|今天|今日|明天|明日|后天)\s*(\d{1,2})[:：点](\d{2})?/)
        : null);
    if (rel) {
      let day = { y: sp.y, m: sp.m, d: sp.d };
      const label = rel[1]!;
      if (label === "明天" || label === "明日") day = addShanghaiDays(day.y, day.m, day.d, 1);
      else if (label === "后天") day = addShanghaiDays(day.y, day.m, day.d, 2);
      // 今晚 keeps today
      const iso = shanghaiLocalToIso(day.y, day.m, day.d, Number(rel[2]), Number(rel[3] ?? 0));
      return futureOrNear(iso);
    }
  }

  // Full datetime anywhere (not a travel range start): 2026-11-20 09:00
  // Prefer the match closest to grab keywords when multiple exist.
  const fullRe = /(\d{4})[./-](\d{1,2})[./-](\d{1,2})[ T](\d{1,2})[:：](\d{2})/g;
  let fullBest: RegExpExecArray | null = null;
  let fullBestScore = -Infinity;
  for (let fm = fullRe.exec(s); fm; fm = fullRe.exec(s)) {
    const afterIdx = (fm.index ?? 0) + fm[0].length;
    const after = s.slice(afterIdx, afterIdx + 3);
    if (/^\s*[-~～到至]/.test(after)) continue; // travel window
    const window = s.slice(Math.max(0, (fm.index ?? 0) - 8), afterIdx + 12);
    const nearGrab = new RegExp(GRAB_KW).test(window) || new RegExp(GRAB_KW).test(s.slice(afterIdx, afterIdx + 16));
    const score = nearGrab ? 100 - (fm.index ?? 0) * 0.01 : 10 - (fm.index ?? 0) * 0.01;
    if (score > fullBestScore) {
      fullBestScore = score;
      fullBest = fm;
    }
  }
  if (fullBest && (fullBestScore >= 100 || !requireIntent || hasExplicitGrabStartIntent(s))) {
    // In free-form with grab intent: only accept full datetime if near grab OR it's the only non-range datetime
    // and appears after travel-only date without time. Prefer near-grab (score>=100).
    if (fullBestScore >= 100 || !requireIntent) {
      const iso = shanghaiLocalToIso(
        Number(fullBest[1]),
        Number(fullBest[2]),
        Number(fullBest[3]),
        Number(fullBest[4]),
        Number(fullBest[5])
      );
      const ok = futureOrNear(iso);
      if (ok) return ok;
      // Unreliable / past explicit grab datetime → do not invent tomorrow
      if (fullBestScore >= 100) return undefined;
    }
  }

  // Clock glued to grab keywords: 「8点开抢」「开抢8点」 — only when no explicit calendar grab date
  if (!hasExplicitGrabCalendar) {
    const nearGrabEarly =
      s.match(new RegExp(GRAB_KW + String.raw`[^\d]{0,6}(\d{1,2})[:：点](\d{2})?`)) ||
      s.match(new RegExp(String.raw`(\d{1,2})[:：点](\d{2})?[^\d开抢盯]{0,6}` + GRAB_KW));
    if (nearGrabEarly) {
      let day = { y: sp.y, m: sp.m, d: sp.d };
      let iso = shanghaiLocalToIso(day.y, day.m, day.d, Number(nearGrabEarly[1]), Number(nearGrabEarly[2] ?? 0));
      if (new Date(iso).getTime() < now.getTime() - 60_000) {
        day = addShanghaiDays(day.y, day.m, day.d, 1);
        iso = shanghaiLocalToIso(day.y, day.m, day.d, Number(nearGrabEarly[1]), Number(nearGrabEarly[2] ?? 0));
      }
      return futureOrNear(iso);
    }
  }

  // Bare clock with grab intent (or short-answer): 8点 / 08:00 — never when YYYY-MM-DD present unbound
  if (/出发/.test(s) && !hasExplicitGrabStartIntent(s)) return undefined;

  const nearGrab =
    s.match(new RegExp(GRAB_KW + String.raw`[^\d]{0,6}(\d{1,2})[:：点](\d{2})?`)) ||
    s.match(new RegExp(String.raw`(\d{1,2})[:：点](\d{2})?[^\d开抢盯]{0,6}` + GRAB_KW));
  const hm =
    nearGrab ||
    (!requireIntent || hasExplicitGrabStartIntent(s) ? s.match(/(\d{1,2})[:：点](\d{2})?/) : null);
  if (hm && hasTravelTimeRange(s) && !nearGrab) {
    if (!/开抢|盯票/.test(s)) return undefined;
  }
  // If utterance has a YYYY-MM-DD but we failed to bind it to grab, do NOT invent today/tomorrow from clock
  if (hm && /\d{4}[./-]\d{1,2}[./-]\d{1,2}/.test(s) && !nearGrab && requireIntent) {
    return undefined;
  }
  if (hm && !/\d{4}[./-]\d{1,2}[./-]\d{1,2}/.test(s) && !hasExplicitGrabCalendar) {
    let day = { y: sp.y, m: sp.m, d: sp.d };
    let iso = shanghaiLocalToIso(day.y, day.m, day.d, Number(hm[1]), Number(hm[2] ?? 0));
    if (new Date(iso).getTime() < now.getTime() - 60_000) {
      day = addShanghaiDays(day.y, day.m, day.d, 1);
      iso = shanghaiLocalToIso(day.y, day.m, day.d, Number(hm[1]), Number(hm[2] ?? 0));
    }
    return futureOrNear(iso);
  }

  // Date-only / unreliable explicit grab datetime → ask (no invent)
  return undefined;
}

function detectChannel(text: string): IntakeChannel | undefined {
  if (/火车|高铁|动车|列车|12306|火车票|席别|二等座|一等座|商务座|硬卧|软卧/.test(text)) return "train";
  if (/演出|演唱会|音乐会|话剧|大麦|猫眼|门票|票档/.test(text)) return "show";
  if (/机票|航班|飞机|民航|机场/.test(text)) return "flight";
  if (/^火车$|^高铁$|^列车$/.test(text.trim())) return "train";
  if (/^演出$|^演唱会$|^门票$/.test(text.trim())) return "show";
  if (/^机票$|^航班$|^飞机$/.test(text.trim())) return "flight";
  // Infer train when utterance looks like 站到站 with station suffixes
  if (/[\u4e00-\u9fff]{2,8}[东西南北站]?\s*(?:到|去|至|→)\s*[\u4e00-\u9fff]{2,8}[东西南北站]?/.test(text) &&
      /[东西南北]站?|火车站|高铁站/.test(text)) {
    return "train";
  }
  return undefined;
}

const MULTI_STATION_CITIES = new Set([
  "北京", "上海", "广州", "深圳", "杭州", "成都", "重庆", "武汉", "西安",
  "南京", "天津", "长沙", "郑州", "沈阳", "哈尔滨", "昆明", "厦门", "福州",
  "青岛", "济南", "合肥", "南昌", "石家庄", "太原", "南宁", "贵阳", "兰州",
]);

/** True when place is a city name without a concrete station/airport suffix. */
export function isAmbiguousCityPlace(place?: string): boolean {
  if (!place) return false;
  const p = place.trim().replace(/市$/, "");
  if (/[东西南北]站$|站$|机场$|虹桥|浦东|宝安|萧山|双流|天府|北苑|南站|北站|东站|西站/.test(p)) {
    return false;
  }
  // e.g. 北京南 / 上海虹桥 already concrete
  if (/[东西南北]$/.test(p) && p.length >= 3) return false;
  if (MULTI_STATION_CITIES.has(p)) return true;
  return false;
}

function cleanPlaceToken(raw: string): string {
  return raw
    .trim()
    .replace(/(?:高铁|动车|列车|火车|机票|航班)$/g, "")
    .replace(/[的]?票$/g, "")
    .trim();
}

/** Strip date / weekday / daypart tokens so they never glue onto station names. */
function stripTemporalTokens(text: string): string {
  return text
    .replace(/\d{4}年\d{1,2}月\d{1,2}日?/g, " ")
    .replace(/\d{4}[./-]\d{1,2}[./-]\d{1,2}/g, " ")
    .replace(/\d{1,2}月\d{1,2}日/g, " ")
    .replace(/下?周[日天一二三四五六]?/g, " ")
    .replace(/本周/g, " ")
    .replace(/今天|明天|后天|今晚|周末|今日|明日/g, " ")
    .replace(/早上|早晨|上午|中午|下午|傍晚|晚上|夜间/g, " ");
}

/**
 * Reject date fragments, digit-only garbage, route leftovers, etc.
 * Valid stations must be known allowlist tokens (or city names handled separately).
 */
export function isValidStationToken(place?: string): boolean {
  if (!place) return false;
  const p = cleanPlaceToken(place);
  if (p.length < 2 || p.length > 20) return false;
  // Digits / date-looking / clock tokens never valid
  if (/\d/.test(p)) return false;
  if (/[./]/.test(p)) return false;
  if (/到|去|至|→|->/.test(p)) return false;
  if (/[:：点]/.test(p)) return false;
  if (!/^[\u4e00-\u9fffA-Za-z]+$/.test(p)) return false;
  return isKnownTrainStationName(p);
}

function acceptPlaceCandidate(raw: string, channel?: IntakeChannel): string | undefined {
  const trimmed = raw.trim();
  if (channel === "flight" && /^[A-Za-z]{3}$/.test(trimmed)) {
    const r = resolveAirport(trimmed);
    if (r.kind === "exact") return r.label;
    return undefined;
  }
  const place = cleanPlaceToken(raw);
  if (!place || /\d/.test(place) || /到|去|至|→/.test(place) || /[:：点./]/.test(place)) {
    return undefined;
  }
  if (channel === "flight") {
    const r = resolveAirport(place);
    if (r.kind === "exact") return r.label;
    return undefined; // ambiguous/unknown handled by processTurn clarify
  }
  // Train: exact or unique fuzzy against full 12306 index
  const r = resolveTrainStation(place);
  if (r.kind === "exact" || r.kind === "unique") return r.name;
  return undefined;
}


function extractFromTo(text: string, channel?: IntakeChannel): { from?: string; to?: string } {
  // Prefer "从A到B"; never treat date hyphens as route separators.
  const cleaned = stripTemporalTokens(text);
  const m =
    cleaned.match(/从\s*([^\s到去至→,，。的]{2,20})\s*(?:到|去|至|→|->)\s*([^\s,，。的]{2,20})/) ||
    cleaned.match(
      /([\u4e00-\u9fffA-Za-z]{2,12})\s*(?:到|去|至|→|->)\s*([\u4e00-\u9fffA-Za-z]{2,12})/
    ) ||
    // Hyphen only when BOTH sides are pure Chinese (北京-上海), never 2026-09
    cleaned.match(/([\u4e00-\u9fff]{2,12})\s*[-—]\s*([\u4e00-\u9fff]{2,12})/);
  if (!m) return {};
  const result: { from?: string; to?: string } = {};
  const from = acceptPlaceCandidate(m[1]!, channel);
  const to = acceptPlaceCandidate(m[2]!, channel);
  if (from) result.from = from;
  if (to) result.to = to;
  return result;
}

const CN_NUMERALS: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function extractPassengers(text: string): number | undefined {
  const labeled = text.match(/人数\s*[:：]\s*(\d{1,2})/);
  if (labeled) {
    const n = Number(labeled[1]);
    if (n >= 1 && n <= 10) return n;
  }
  const digit = text.match(/(\d+)\s*(?:人|位|张|名)(?:票)?/) || text.match(/^(\d+)$/);
  if (digit) {
    const n = Number(digit[1]);
    if (n >= 1 && n <= 10) return n;
  }
  const cn = text.match(/([一二三四五六七八九十两])\s*(?:人|位|张|名)(?:票)?/);
  if (cn) {
    const n = CN_NUMERALS[cn[1]!];
    if (n != null && n >= 1 && n <= 10) return n;
  }
  if (/一个人|一人|一位|单人|一张/.test(text)) return 1;
  if (/两个人|两人|两位|双人|两张/.test(text)) return 2;
  return undefined;
}

function extractSeat(text: string): string | undefined {
  const m = text.match(/(商务座|特等座|一等座|二等座|软卧|硬卧|软座|硬座|无座)/);
  if (m) return m[1];
  // Synonyms without 座 suffix (e.g. 「二等，两张票」)
  if (/(?<![一特])二等(?!座)/.test(text)) return "二等座";
  if (/(?<![二特])一等(?!座)/.test(text)) return "一等座";
  if (/商务(?!座|舱)/.test(text)) return "商务座";
  if (/特等(?!座)/.test(text)) return "特等座";
  return undefined;
}

function extractCabin(text: string): string | undefined {
  const m = text.match(/(头等舱|公务舱|商务舱|超级经济舱|经济舱)/);
  return m?.[1];
}

function extractTimeWindow(text: string): string | undefined {
  if (/时间\s*不限|不限\s*时间|时段\s*不限|时间段\s*不限/.test(text)) return "不限";
  if (/^(不限|任意|都行|无所谓)([!！。.\s]*)$/.test(text.trim())) return "不限";
  // Bare 不限 in longer free-form without 时间 → still timeWindow (legacy), unless clearly seat/cabin/tier scoped
  if (
    /不限|任意|都行|无所谓/.test(text) &&
    !/时间/.test(text) &&
    !/(?:席别|座位|舱位|票档)\s*不限|不限\s*(?:席别|座位|舱位|票档)/.test(text) &&
    !/(商务座|特等座|一等座|二等座|软卧|硬卧|软座|硬座|无座|经济舱|商务舱)/.test(text)
  ) {
    return "不限";
  }
  const range = text.match(/(\d{1,2}:\d{2})\s*[-~～到至]\s*(\d{1,2}:\d{2})/);
  if (range) return `${range[1]}-${range[2]}`;
  const cnRange = text.match(/(\d{1,2})\s*[:：点]\s*(?:(\d{2})\s*)?[-~～到至]\s*(\d{1,2})\s*[:：点]?\s*(\d{2})?/);
  if (cnRange) {
    const a = `${cnRange[1]!.padStart(2, "0")}:${(cnRange[2] ?? "00").padStart(2, "0")}`;
    const b = `${cnRange[3]!.padStart(2, "0")}:${(cnRange[4] ?? "00").padStart(2, "0")}`;
    return `${a}-${b}`;
  }
  // Single departure clock: 「9月29日8点出发」 / 「上午8点出发」 → travel window, not grabStartAt
  const depart = text.match(/(\d{1,2})\s*[:：点]\s*(\d{2})?\s*(?:出发|发车|开车)/);
  if (depart) {
    const hh = depart[1]!.padStart(2, "0");
    const mm = (depart[2] ?? "00").padStart(2, "0");
    return `${hh}:${mm}`;
  }
  if (/上午|早上|早晨/.test(text)) return "06:00-12:00";
  if (/中午/.test(text)) return "11:00-14:00";
  if (/下午/.test(text)) return "12:00-18:00";
  if (/晚上|夜间|傍晚/.test(text)) return "18:00-23:59";
  return undefined;
}

/** Labels that bound show field values (stop eventName/tier/venue at these). */
const SHOW_BOUND_LABELS =
  String.raw`(?:演出名|演唱会名|活动名|演出|活动|场馆|地点|日期|票档|票价档|人数|盯票开始|盯票|开抢|开售|时间)`;

/** True when a show field value still contains another field's label / delimiter blob. */
export function isPollutedShowValue(value: string | undefined, kind: "eventName" | "venue" | "tier"): boolean {
  if (!value) return false;
  const v = value.trim();
  if (!v) return true;
  if (/[;；]/.test(v)) return true;
  if (kind === "eventName") {
    if (/(?:场馆|地点|日期|票档|票价档|人数|盯票|开抢|开售)\s*[:：]?/.test(v)) return true;
    if (/\d{4}[./-]\d{1,2}/.test(v)) return true;
    if (/我要|帮我|盯票|抢票|买票/.test(v)) return true;
    if (v.length > 40) return true;
  }
  if (kind === "tier") {
    if (/(?:场馆|地点|日期|人数|盯票|开抢|开售|演出|活动)\s*[:：]?/.test(v)) return true;
    if (v.length > 24) return true;
  }
  if (kind === "venue") {
    if (/(?:日期|票档|票价档|人数|盯票|开抢|开售|演出)\s*[:：]?/.test(v)) return true;
    if (v.length > 40) return true;
  }
  return false;
}

function cleanShowValue(raw: string): string {
  return raw
    .replace(/^[\s:：,，;；]+/, "")
    .replace(/[\s,，;；]+$/, "")
    .trim();
}

/**
 * Explicit labeled show parse: 演出/场馆/日期/票档/人数/盯票开始 with ：/: and
 * ；/;/,/， delimiters. Values stop at the next label or delimiter.
 */
function parseLabeledShowFields(text: string, now = new Date()): Partial<IntakeFields> {
  const patch: Partial<IntakeFields> = {};
  const take = (labels: string): string | undefined => {
    const re = new RegExp(
      `(?:^|[;；,，\\s])(?:${labels})\\s*[:：]\\s*([^;；]*?)(?=\\s*[;；]|\\s*(?:${SHOW_BOUND_LABELS})\\s*[:：]|$)`,
      "i"
    );
    // Also allow ASCII/fullwidth comma as field separator (value must not contain comma)
    const reComma = new RegExp(
      `(?:^|[;；,，\\s])(?:${labels})\\s*[:：]\\s*([^;；,，]*?)(?=\\s*[;；,，]|\\s*(?:${SHOW_BOUND_LABELS})\\s*[:：]|$)`,
      "i"
    );
    const m = text.match(reComma) || text.match(re);
    if (!m?.[1]) return undefined;
    const v = cleanShowValue(m[1]);
    return v.length >= 1 ? v : undefined;
  };

  const eventName = take("演出名|演唱会名|活动名|演出|活动");
  if (
    eventName &&
    !/^(演出|演唱会|音乐会|话剧|门票|活动)$/.test(eventName) &&
    !isPollutedShowValue(eventName, "eventName")
  ) {
    patch.eventName = eventName.slice(0, 80);
  }

  const venue = take("场馆|地点");
  if (venue && !isPollutedShowValue(venue, "venue")) patch.venue = venue.slice(0, 80);

  const dateRaw = take("日期|观演日期|演出日期");
  if (dateRaw) {
    const d = normalizeDateToken(dateRaw);
    if (d) patch.date = d;
  }

  const tier = take("票档|票价档");
  if (tier && !isPollutedShowValue(tier, "tier")) patch.tier = tier.replace(/\s+/g, "").slice(0, 24);

  const paxRaw = take("人数|观演人数");
  if (paxRaw) {
    const n = Number(paxRaw.match(/\d+/)?.[0]);
    if (n >= 1 && n <= 10) patch.passengers = n;
  }

  const grabRaw = take("盯票开始|开售时间|开抢时间|开售|开抢|盯票");
  if (grabRaw) {
    // Re-parse with intent so calendar datetime binds; prefix keyword for parseGrabStart.
    const g =
      parseGrabStart(`盯票开始 ${grabRaw}`, now, true) ||
      parseGrabStart(`盯票开始：${grabRaw}`, now, false);
    if (g) patch.grabStartAt = g;
  }

  return patch;
}

function extractEvent(text: string): { eventName?: string; venue?: string; city?: string } {
  const city = text.match(/(北京|上海|广州|深圳|杭州|成都|重庆|武汉|西安|南京|苏州|天津|长沙|郑州|青岛|厦门|福州)/);

  // Venue: 「场馆XXX」 / 「场馆：XXX」 or 「在/于 …中心|体育场…」
  let venue: string | undefined;
  const venueField = text.match(
    new RegExp(
      String.raw`场馆\s*[:：]?\s*([^\s,，。；;]{2,40}?)(?=\s*[;；,，]|` +
        SHOW_BOUND_LABELS +
        String.raw`\s*[:：]|$)`
    )
  );
  if (venueField?.[1]) {
    venue = cleanShowValue(venueField[1]);
  } else {
    const venueSuffix = text.match(
      /(?:在|于)\s*([^\s,，。；;]{2,30}(?:体育场|体育馆|中心|大剧院|剧场|场馆|Arena|arena))/
    );
    if (venueSuffix?.[1]) venue = cleanShowValue(venueSuffix[1]);
  }
  if (venue && isPollutedShowValue(venue, "venue")) venue = undefined;

  // EventName: labeled first, else「…演唱会/音乐会/…」bounded (date may glue before name)
  let eventName: string | undefined;
  const labeledEvent = text.match(
    new RegExp(
      String.raw`(?:演出名|演唱会名|活动名|演出|活动)\s*[:：]\s*([^;；,，]*?)(?=\s*[;；,，]|` +
        SHOW_BOUND_LABELS +
        String.raw`\s*[:：]|$)`
    )
  );
  if (labeledEvent?.[1]) {
    eventName = cleanShowValue(labeledEvent[1]);
  } else {
    // Digits/hyphens excluded so「我要看2026-12-31周杰伦演唱会」does not swallow date into the name.
    const named = text.match(
      /(?:\d{4}[./-]\d{1,2}[./-]\d{1,2})?\s*([\u4e00-\u9fffA-Za-z·]{2,30}(?:演唱会|音乐会|话剧|巡演))/
    );
    if (named?.[1]) {
      eventName = cleanShowValue(named[1]);
    } else {
      // Short free-form / multi-turn answer: strip filler, stop at bound labels
      let stripped = text
        .replace(/我想|我要|帮我|盯票|抢票|买票|看|听/g, " ")
        .replace(/\d{4}[./-]\d{1,2}[./-]\d{1,2}/g, " ")
        .replace(
          new RegExp(
            String.raw`(?:场馆|地点|日期|票档|票价档|人数|盯票开始|开抢|开售|时间)\s*[:：]?[^;；,，]*`,
            "g"
          ),
          " "
        )
        .replace(/内场\s*\d{0,5}|看台\s*\d{0,5}|\d+\s*张|\d+\s*人/g, " ")
        .replace(/[;；,，]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (stripped.length >= 2 && stripped.length <= 40) eventName = stripped;
    }
  }
  if (eventName && /^(演出|演唱会|音乐会|话剧|门票|活动)$/.test(eventName)) eventName = undefined;
  if (eventName && isPollutedShowValue(eventName, "eventName")) eventName = undefined;
  if (eventName && eventName.length < 2) eventName = undefined;

  return {
    eventName: eventName ? eventName.slice(0, 80) : undefined,
    venue: venue ? venue.slice(0, 80) : undefined,
    city: city?.[1],
  };
}


/** Drop polluted show fields so missing/confirm cannot proceed on swallowed blobs. */
function sanitizeShowFields(fields: IntakeFields): void {
  if (fields.channel !== "show") return;
  if (
    fields.eventName &&
    (isPollutedShowValue(fields.eventName, "eventName") ||
      /^(演出|演唱会|音乐会|话剧|门票|活动)$/.test(fields.eventName.trim()))
  ) {
    delete fields.eventName;
  }
  if (fields.venue && isPollutedShowValue(fields.venue, "venue")) {
    delete fields.venue;
  }
  if (fields.tier && isPollutedShowValue(fields.tier, "tier")) {
    delete fields.tier;
  }
  // Venue must be present for confirm (「未知」 counts as answered)
  // eventName must not contain other labels — already cleared above
}

/** Merge extractions from a user utterance into session fields. */
export function extractIntakePatch(text: string, current: IntakeFields, now = new Date()): Partial<IntakeFields> {
  const patch: Partial<IntakeFields> = {};
  const channel = detectChannel(text) ?? current.channel;
  if (!current.channel && channel) patch.channel = channel;
  const ch = patch.channel ?? current.channel;

  if (ch === "show") {
    const labeled = parseLabeledShowFields(text, now);
    for (const [k, v] of Object.entries(labeled)) {
      if (v !== undefined && (current as Record<string, unknown>)[k] == null) {
        (patch as Record<string, unknown>)[k] = v;
      }
    }
    const ev = extractEvent(text);
    if (ev.eventName && !current.eventName && !patch.eventName) patch.eventName = ev.eventName;
    if (ev.venue && !current.venue && !patch.venue) patch.venue = ev.venue;
    if (ev.city && !current.fromCity) patch.fromCity = ev.city;
    if (/未知|没有|无|不详|skip/i.test(text.trim()) && !current.venue && !patch.venue) patch.venue = "未知";
  } else {
    const ft = extractFromTo(text, ch);
    if (ft.from && !current.from) patch.from = ft.from;
    if (ft.to && !current.to) patch.to = ft.to;
    // When route tokens are cities / unresolved, still capture for disambiguation
    if ((ch === "train" || ch === "flight") && (!ft.from || !ft.to)) {
      const cleaned = stripTemporalTokens(text);
      const m =
        cleaned.match(/从\s*([^\s到去至→,，。的]{2,20})\s*(?:到|去|至|→|->)\s*([^\s,，。的]{2,20})/) ||
        cleaned.match(/([\u4e00-\u9fffA-Za-z]{2,12})\s*(?:到|去|至|→|->)\s*([\u4e00-\u9fffA-Za-z]{2,12})/);
      if (m) {
        const a = cleanPlaceToken(m[1]!);
        const b = cleanPlaceToken(m[2]!);
        if (!ft.from && a && !current.from && !patch.from) {
          if (ch === "flight") {
            const r = resolveAirport(a);
            if (r.kind === "exact") patch.from = r.label;
            else if (r.kind === "ambiguous") patch.fromCity = patch.fromCity ?? r.city;
            else if (!/\d/.test(a)) patch.fromCity = patch.fromCity ?? a;
          } else if (isAmbiguousCityPlace(a) || resolveTrainStation(a).kind === "ambiguous") {
            patch.fromCity = patch.fromCity ?? a;
          } else if (!current.from) {
            const r = resolveTrainStation(a);
            if (r.kind === "exact" || r.kind === "unique") patch.from = r.name;
          }
        }
        if (!ft.to && b && !current.to && !patch.to) {
          if (ch === "flight") {
            const r = resolveAirport(b);
            if (r.kind === "exact") patch.to = r.label;
            else if (r.kind === "ambiguous") patch.toCity = patch.toCity ?? r.city;
            else if (!/\d/.test(b)) patch.toCity = patch.toCity ?? b;
          } else if (isAmbiguousCityPlace(b) || resolveTrainStation(b).kind === "ambiguous") {
            patch.toCity = patch.toCity ?? b;
          } else if (!current.to) {
            const r = resolveTrainStation(b);
            if (r.kind === "exact" || r.kind === "unique") patch.to = r.name;
          }
        }
      }
    }
  }

  const date = normalizeDateToken(text, now);
  if (date && !current.date) patch.date = date;

  const tw = extractTimeWindow(text);
  if (tw && !current.timeWindow) patch.timeWindow = tw;

  // 「时间不限」/「不限」near 时间 → timeWindow only; never clobber seat/cabin/tier.
  const timeScopedUnlimited = /时间\s*不限|不限\s*时间|时段\s*不限|时间段\s*不限/.test(text);
  const seatScopedUnlimited = /席别\s*不限|座位\s*不限|不限\s*席别/.test(text);
  const cabinScopedUnlimited = /舱位\s*不限|不限\s*舱位/.test(text);
  if (timeScopedUnlimited && ch !== "show" && !current.timeWindow) patch.timeWindow = "不限";
  else if (
    /不限|任意|都行/.test(text) &&
    ch !== "show" &&
    !current.timeWindow &&
    !patch.timeWindow &&
    !seatScopedUnlimited &&
    !cabinScopedUnlimited &&
    !/(?:席别|座位|舱位|票档)\s*不限|不限\s*(?:席别|座位|舱位|票档)/.test(text)
  ) {
    patch.timeWindow = "不限";
  }

  const seat = extractSeat(text);
  if (seat && !current.seatClass) patch.seatClass = seat;
  else if (
    ch === "train" &&
    !current.seatClass &&
    !patch.seatClass &&
    (seatScopedUnlimited ||
      (/不限|任意|都行/.test(text) && !timeScopedUnlimited && !/时间/.test(text)))
  ) {
    patch.seatClass = "不限";
  }

  const cabin = extractCabin(text);
  if (cabin && !current.cabin) patch.cabin = cabin;
  else if (
    ch === "flight" &&
    !current.cabin &&
    !patch.cabin &&
    (cabinScopedUnlimited ||
      (/不限|任意|都行/.test(text) && !timeScopedUnlimited && !/时间/.test(text)))
  ) {
    patch.cabin = "不限";
  }

  if (ch === "show") {
    // Do not treat a *whole-answer* YYYY-MM-DD (or bare year) as tier.
    // Free-form with both date and 内场680 must still extract tier.
    // Never use 票档\S+ — that swallows 人数/盯票开始 after fullwidth colon.
    const wholeIsDate =
      /^\d{4}[-/.年]\d{1,2}([-/.月]\d{1,2})?日?$/.test(text.trim()) || /^20\d{2}$/.test(text.trim());
    if (!wholeIsDate && !current.tier && !patch.tier) {
      const tierLabeled = text.match(/票(?:档|价档)\s*[:：]\s*([^\s;；,，]{1,20})/);
      const tierM =
        tierLabeled ||
        text.match(/(内场\s*\d{2,5}|看台\s*\d{2,5}|\d{2,5}\s*元|[A-Z]区|VIP|内场|看台)/i);
      if (tierM) {
        const cand = (tierM[1] || "").trim();
        if (
          cand &&
          !/^\d{4}([-/.年]\d{1,2})?$/.test(cand) &&
          !isPollutedShowValue(cand, "tier")
        ) {
          patch.tier = cand.replace(/\s+/g, "");
        }
      }
    }
    if (
      /不限|任意|都行/.test(text) &&
      !current.tier &&
      !patch.tier &&
      !wholeIsDate &&
      !/时间\s*不限|不限\s*时间/.test(text)
    ) {
      patch.tier = "不限";
    }
  }

  const pax = extractPassengers(text);
  if (pax != null && !current.passengers) patch.passengers = pax;

  // Free-form: grabStartAt only when user EXPLICITLY says 开抢/盯票/现在 etc.
  // Travel windows (上午8点到10点 / 8:00-10:00 / N点出发) must never become grabStartAt.
  const grab = parseGrabStart(text, now, true);
  if (grab && !current.grabStartAt) patch.grabStartAt = grab;

  return patch;
}

/** When the assistant asked for a specific field, accept short answers. */
export function applyShortAnswer(
  field: keyof IntakeFields,
  text: string,
  now = new Date(),
  channel?: IntakeChannel
): Partial<IntakeFields> {
  const t = text.trim();
  if (field === "channel") {
    const c = detectChannel(t);
    return c ? { channel: c } : {};
  }
  if (field === "from" || field === "to" || field === "venue" || field === "eventName") {
    if (/未知|没有|无|不详/.test(t) && field === "venue") return { venue: "未知" };
    if ((field === "from" || field === "to") && t.length >= 1 && t.length <= 40) {
      if (/\d{4}|[./]/.test(t) || /到|去|至/.test(t)) return {};
      const ch = channel ?? "train";
      const place = acceptPlaceCandidate(t, ch);
      if (place) return { [field]: place };
      // Keep bare city / unresolved token so processTurn can clarify (airport/station ambiguous)
      if (!/\d/.test(t) && /^[\u4e00-\u9fffA-Za-z]{2,20}$/.test(t.trim())) {
        return { [field]: t.trim() };
      }
      return {};
    }
    if (t.length >= 1 && t.length <= 40) return { [field]: t };
  }
  if (field === "date") {
    const d = normalizeDateToken(t, now);
    return d ? { date: d } : {};
  }
  if (field === "timeWindow") {
    if (/不限|任意|都行/.test(t)) return { timeWindow: "不限" };
    const tw = extractTimeWindow(t);
    return tw ? { timeWindow: tw } : t ? { timeWindow: t } : {};
  }
  if (field === "seatClass") {
    if (/不限|任意|都行/.test(t)) return { seatClass: "不限" };
    return { seatClass: extractSeat(t) ?? t };
  }
  if (field === "tier") {
    if (/不限|任意|都行/.test(t)) return { tier: "不限" };
    return { tier: t };
  }
  if (field === "cabin") {
    if (/不限|任意|都行/.test(t)) return { cabin: "不限" };
    return { cabin: extractCabin(t) ?? t };
  }
  if (field === "passengers") {
    const p = extractPassengers(t);
    return p != null ? { passengers: p } : {};
  }
  if (field === "grabStartAt") {
    // Assistant asked for grab-start: accept short times / 现在 (intent already implied by question).
    const g = parseGrabStart(t, now, false);
    if (g) return { grabStartAt: g };
    const d = normalizeDateToken(t, now);
    if (d) {
      const iso = new Date(`${d}T00:00:00+08:00`).toISOString();
      if (new Date(iso).getTime() >= now.getTime() - 60_000) return { grabStartAt: iso };
    }
    return {};
  }
  return {};
}

export function fieldOrder(channel?: IntakeChannel): (keyof IntakeFields)[] {
  if (channel === "show") return FIELD_ORDER_SHOW;
  if (channel === "flight") return FIELD_ORDER_FLIGHT;
  if (channel === "train") return FIELD_ORDER_TRAIN;
  return ["channel"];
}

export function nextMissingField(fields: IntakeFields): keyof IntakeFields | null {
  const order = fieldOrder(fields.channel);
  for (const f of order) {
    const v = fields[f];
    if (v === undefined || v === null || v === "") return f;
    // City-only 北京/上海 etc. must be disambiguated to exact station before confirm
    if ((f === "from" || f === "to") && (fields.channel === "train" || fields.channel === "flight")) {
      if (fields.channel === "train" && !isKnownTrainStationName(String(v))) return f;
      if (fields.channel === "flight" && !isConcreteAirportLabel(String(v))) return f;
      if (fields.channel === "train" && isAmbiguousCityPlace(String(v))) return f;
      // Reject digit/date garbage (allow IATA letters; reject digit dates)
      if (/\d{4}|[./]|到|去|至/.test(String(v))) return f;
    }
  }
  return null;
}

export function questionFor(field: keyof IntakeFields): string {
  return QUESTIONS[field] ?? "请补充该信息。";
}

export type ConfirmationCard = {
  channel: IntakeChannel;
  channelLabel: string;
  lines: { label: string; value: string }[];
  capabilityNote: string;
  fields: IntakeFields;
};

export function buildConfirmationCard(fields: IntakeFields): ConfirmationCard | null {
  if (!fields.channel) return null;
  if (fields.channel === "show") {
    if (
      isPollutedShowValue(fields.eventName, "eventName") ||
      isPollutedShowValue(fields.venue, "venue") ||
      isPollutedShowValue(fields.tier, "tier") ||
      !fields.venue
    ) {
      return null;
    }
  }
  const missing = nextMissingField(fields);
  if (missing) return null;

  const channelLabel =
    fields.channel === "train" ? "火车" : fields.channel === "show" ? "演出" : "机票";

  const lines: { label: string; value: string }[] = [];
  if (fields.channel === "show") {
    lines.push({ label: "演出", value: fields.eventName! });
    lines.push({ label: "场馆", value: fields.venue ?? "未知" });
    if (fields.fromCity) lines.push({ label: "城市", value: fields.fromCity });
  } else {
    lines.push({ label: "出发", value: fields.from! });
    lines.push({ label: "到达", value: fields.to! });
  }
  lines.push({ label: "日期", value: fields.date! });
  if (fields.timeWindow) lines.push({ label: "时间段", value: fields.timeWindow });
  if (fields.seatClass) lines.push({ label: "席别", value: fields.seatClass });
  if (fields.tier) lines.push({ label: "票档", value: fields.tier });
  if (fields.cabin) lines.push({ label: "舱位", value: fields.cabin });
  lines.push({ label: "人数", value: String(fields.passengers ?? 1) });
  lines.push({
    label: "盯票开始",
    value: fields.grabStartAt ? formatShanghaiDateTime(fields.grabStartAt) : "现在",
  });

  const capabilityNote =
    fields.channel === "train"
      ? "将创建「监控盯票」任务：定时查询 12306 公开余票并通知。不含官方授权的无人值守占座/购票。"
      : fields.channel === "show"
        ? "将创建「开售/有票监控」：定时检查公开场次信息并通知；有票后请跳转大麦/猫眼等官方平台完成购买。本系统不做自动抢购/代下单。"
        : "将创建「航班监控」：按配置数据源查询并通知；购票请跳转航司或 OTA 官方完成。本系统不做自动出票/代收票款。";

  return { channel: fields.channel, channelLabel, lines, capabilityNote, fields: { ...fields } };
}

export function toRequestPayload(fields: IntakeFields): {
  channel: IntakeChannel;
  fields: Record<string, unknown>;
  notifyOnly: boolean;
  notes?: string;
  watch: { intervalMinutes: number; startsAt?: string; preferences?: Record<string, unknown> };
} {
  if (!fields.channel) throw new Error("channel required");
  const baseWatch = {
    intervalMinutes: fields.intervalMinutes ?? 5,
    startsAt: fields.grabStartAt,
    preferences: {} as Record<string, unknown>,
  };

  if (fields.channel === "train") {
    if (fields.seatClass && fields.seatClass !== "不限") {
      baseWatch.preferences.preferredSeats = [fields.seatClass];
    }
    return {
      channel: "train",
      fields: {
        from: fields.from,
        to: fields.to,
        date: fields.date,
        timeWindow: fields.timeWindow === "不限" ? undefined : fields.timeWindow,
        seatClass: fields.seatClass === "不限" ? undefined : fields.seatClass,
        passengers: fields.passengers ?? 1,
        fromCity: fields.fromCity,
        toCity: fields.toCity,
      },
      notifyOnly: true,
      notes: "created via conversational intake",
      watch: baseWatch,
    };
  }
  if (fields.channel === "show") {
    if (fields.tier && fields.tier !== "不限") {
      baseWatch.preferences.preferredTiers = [fields.tier];
    }
    return {
      channel: "show",
      fields: {
        eventName: fields.eventName,
        city: fields.fromCity,
        venue: fields.venue,
        date: fields.date,
        tier: fields.tier === "不限" ? undefined : fields.tier,
        quantity: fields.passengers ?? 1,
      },
      notifyOnly: true,
      notes: "created via conversational intake",
      watch: baseWatch,
    };
  }
  return {
    channel: "flight",
    fields: {
      from: fields.from,
      to: fields.to,
      date: fields.date,
      cabin: fields.cabin === "不限" ? undefined : fields.cabin,
      passengers: fields.passengers ?? 1,
    },
    notifyOnly: true,
    notes: "created via conversational intake",
    watch: baseWatch,
  };
}

export function processTurn(
  session: IntakeSession,
  userMessage: string,
  now = new Date()
): {
  session: IntakeSession;
  reply: string;
  missing: keyof IntakeFields | null;
  readyForConfirm: boolean;
  confirmation?: ConfirmationCard;
} {
  const asking = nextMissingField(session.fields);
  let patch = extractIntakePatch(userMessage, session.fields, now);
  // Short answers fill only fields extract did not already set (avoid clobbering "A到B")
  if (asking) {
    const short = applyShortAnswer(asking, userMessage, now, session.fields.channel ?? patch.channel);
    for (const [k, v] of Object.entries(short)) {
      if (patch[k as keyof IntakeFields] === undefined) {
        (patch as Record<string, unknown>)[k] = v;
      }
    }
  }

  const fields: IntakeFields = { ...session.fields, ...patch };
  // Invalid / past grabStartAt → clear and ask again (no confirmation card)
  if (fields.grabStartAt) {
    const t = new Date(fields.grabStartAt).getTime();
    if (!Number.isFinite(t) || t < now.getTime() - 60_000) {
      delete fields.grabStartAt;
    }
  }
  sanitizeShowFields(fields);
  // Defaults after channel known
  if (fields.channel && fields.passengers == null && patch.passengers == null) {
    /* still ask */
  }

  // Drop invalid / garbage station/airport tokens; never confirm with date fragments or fakes
  // Use a box so nested assignments are visible to later reads (TS CFA ignores let writes in closures).
  const clarifyBox: {
    airport: { city: string; candidates: AirportInfo[] } | null;
    station: { query: string; candidates: string[] } | null;
  } = { airport: null, station: null };
  if (fields.channel === "train" || fields.channel === "flight") {
    if (fields.channel === "train") {
      const normalizeSide = (side: "from" | "to") => {
        const v = fields[side];
        if (!v) return;
        if (/\d{4}|[./]|到|去|至/.test(v)) {
          delete fields[side];
          return;
        }
        const r = resolveTrainStation(v);
        if (r.kind === "exact" || r.kind === "unique") {
          fields[side] = r.name;
          return;
        }
        if (r.kind === "ambiguous") {
          clarifyBox.station = { query: r.query, candidates: r.candidates };
          if (side === "from") fields.fromCity = fields.fromCity ?? r.query;
          else fields.toCity = fields.toCity ?? r.query;
          delete fields[side];
          return;
        }
        // unknown — if multi-station city name, disambiguate; else drop
        if (isAmbiguousCityPlace(v)) {
          if (side === "from") fields.fromCity = fields.fromCity ?? v;
          else fields.toCity = fields.toCity ?? v;
        }
        delete fields[side];
      };
      normalizeSide("from");
      normalizeSide("to");
      // Known station that is also a multi-station city (北京/上海…) → still force exact
      if (fields.from && isAmbiguousCityPlace(fields.from)) {
        fields.fromCity = fields.fromCity ?? fields.from;
        delete fields.from;
      }
      if (fields.to && isAmbiguousCityPlace(fields.to)) {
        fields.toCity = fields.toCity ?? fields.to;
        delete fields.to;
      }
    } else {
      // flight
      const normalizeAir = (side: "from" | "to") => {
        const v = fields[side];
        if (!v) return;
        if (/\d{4}|[./]|到|去|至/.test(v) && !isConcreteAirportLabel(v)) {
          delete fields[side];
          return;
        }
        const r = resolveAirport(v);
        if (r.kind === "exact") {
          fields[side] = r.label;
          return;
        }
        if (r.kind === "ambiguous") {
          clarifyBox.airport = { city: r.city, candidates: r.candidates };
          if (side === "from") fields.fromCity = fields.fromCity ?? r.city;
          else fields.toCity = fields.toCity ?? r.city;
          delete fields[side];
          return;
        }
        delete fields[side];
      };
      normalizeAir("from");
      normalizeAir("to");
    }
  }
  const airportClarify = clarifyBox.airport;
  const stationClarify = clarifyBox.station;

  const missing = nextMissingField(fields);
  const history = [
    ...session.history,
    { role: "user" as const, text: userMessage },
  ];

  if (!missing) {
    const confirmation = buildConfirmationCard(fields)!;
    const reply =
      `已收集齐全，请确认：\n` +
      confirmation.lines.map((l) => `· ${l.label}：${l.value}`).join("\n") +
      `\n\n${confirmation.capabilityNote}\n确认后才会创建盯票任务。请点击确认，或回复「确认」。`;
    history.push({ role: "assistant", text: reply });
    return {
      session: { fields, history },
      reply,
      missing: null,
      readyForConfirm: true,
      confirmation,
    };
  }

  let reply = questionFor(missing);
  if ((missing === "from" || missing === "to") && fields.channel === "flight") {
    const city = missing === "from" ? fields.fromCity : fields.toCity;
    const clarify = airportClarify ?? (city ? (() => {
      const r = resolveAirport(city);
      return r.kind === "ambiguous" ? { city: r.city, candidates: r.candidates } : null;
    })() : null);
    if (clarify) {
      reply =
        `您提到${missing === "from" ? "出发" : "到达"}城市「${clarify.city}」有多个机场：` +
        `${formatAirportChoices(clarify.candidates)}。请回复机场名或 IATA 代码。`;
    } else if (city) {
      reply = `请给出确切${missing === "from" ? "出发" : "到达"}机场（例如「深圳宝安」「SZX」），不要只写城市「${city}」。`;
    } else {
      reply = `请告诉我确切${missing === "from" ? "出发" : "到达"}机场（中文名或 IATA，例如「上海浦东」「PVG」）。`;
    }
  } else if (missing === "from" && fields.fromCity) {
    const sc = stationClarify;
    if (sc && sc.candidates.length) {
      reply =
        `「${sc.query}」对应多个车站：` +
        sc.candidates.slice(0, 8).map((c) => `「${c}」`).join(" / ") +
        `。请回复确切出发站。`;
    } else {
      reply = `您提到出发地是「${fields.fromCity}」，该城市有多个车站。请回复确切出发站（例如「${fields.fromCity}南」「${fields.fromCity}西」）。`;
    }
  } else if (missing === "to" && fields.toCity) {
    const sc = stationClarify;
    if (sc && sc.candidates.length) {
      reply =
        `「${sc.query}」对应多个车站：` +
        sc.candidates.slice(0, 8).map((c) => `「${c}」`).join(" / ") +
        `。请回复确切到达站。`;
    } else {
      reply = `您提到到达地是「${fields.toCity}」，该城市有多个车站。请回复确切到达站（例如「${fields.toCity}虹桥」「${fields.toCity}南」）。`;
    }
  } else if (missing === "date" && /下?周[日天一二三四五六]|周[日天一二三四五六]/.test(userMessage)) {
    reply = "您提到了星期几，请给出确切日期（格式 YYYY-MM-DD），以便准确盯票。";
  } else if (missing === "timeWindow" && /晚上|上午|下午|中午/.test(userMessage) && !/\d{1,2}:\d{2}/.test(userMessage)) {
    reply = "请给出更确切的时间段（例如「18:00-21:00」或「不限」）。";
  } else if (missing === "grabStartAt" && fields.channel === "show") {
    reply = "开售/开抢或盯票开始时间？（例如「现在」「今晚20:00」「2026-10-01 09:00」）。有票后请前往大麦/猫眼官方购买，本系统仅监控通知。";
  } else if (missing === "grabStartAt" && fields.channel === "flight") {
    reply = "何时开始监控航班？（例如「现在」「今晚20:00」）。有合适航班后请跳转航司/OTA 官方购票，本系统仅监控通知。";
  }
  history.push({ role: "assistant", text: reply });
  return {
    session: { fields, history },
    reply,
    missing,
    readyForConfirm: false,
  };
}

export function createEmptySession(): IntakeSession {
  return { fields: {}, history: [] };
}
