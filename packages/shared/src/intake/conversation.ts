/**
 * Chinese conversational ticket-intake extractor (rule-based, no LLM required).
 * Collects: channel, from/to (station/venue), date, time window, seat/class/tier,
 * passenger count, grab-start time — one missing field at a time.
 */

import { isKnownTrainStationName } from "./knownStations.js";

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
  from: "请告诉我确切出发站（不要只写城市）。例如「北京南」「北京西」「北京站」。",
  to: "请告诉我确切到达站（不要只写城市）。例如「上海虹桥」「上海南」「上海站」。",
  eventName: "请告诉我演出/活动名称（可附带城市）。",
  venue: "演出场馆是哪里？（没有可回复「未知」）。",
  date: "出行/观演日期是哪天？（格式 YYYY-MM-DD，或「明天」「下周五」）。",
  timeWindow: "希望的时间段？（例如「08:00-12:00」「下午」「晚上」，没有可回复「不限」）。",
  seatClass: "偏好席别？（二等座/一等座/商务座等，没有可回复「不限」）。",
  tier: "偏好票档？（例如「680」「内场」，没有可回复「不限」）。",
  cabin: "舱位偏好？（经济舱/商务舱等，没有可回复「不限」）。",
  passengers: "几位乘客/观演人？（数字 1-9）。",
  grabStartAt: "何时开始盯票/抢票？（例如「现在」「今晚20:00」「2026-10-01 09:00」）。",
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
    // Even with 开抢 nearby, a clear travel range in the same utterance is not the grab clock
    // unless grab phrasing wraps a specific start time — handled below via grab-local matchers.
  } else {
    // Short-answer mode: still refuse pure travel ranges (user pasted window by mistake)
    if (hasTravelTimeRange(s) && !hasExplicitGrabStartIntent(s)) return undefined;
    if (/出发/.test(s) && !hasExplicitGrabStartIntent(s)) return undefined;
  }

  const sp = shanghaiParts(now);

  // Immediacy: 现在 / 立刻开抢 / 马上盯票 — ignore unrelated travel clocks elsewhere.
  // Reject only when a clock is attached to the immediacy word itself (现在8点开抢).
  if (/(现在|立刻|马上|立即)(?!\s*\d)/.test(s)) {
    return now.toISOString();
  }

  // Prefer relative day + clock near grab intent: 明天8点开抢 / 今晚20:00 / 后天9点
  // (Must run BEFORE full-datetime — otherwise "2026-09-29 08:00-10:00 … 明天8点开抢"
  //  wrongly binds travel date+window start as grabStartAt.)
  const rel = s.match(/(今晚|今天|今日|明天|明日|后天)\s*(\d{1,2})[:：点](\d{2})?/);
  if (rel) {
    let day = { y: sp.y, m: sp.m, d: sp.d };
    const label = rel[1]!;
    if (label === "明天" || label === "明日") day = addShanghaiDays(day.y, day.m, day.d, 1);
    else if (label === "后天") day = addShanghaiDays(day.y, day.m, day.d, 2);
    const iso = shanghaiLocalToIso(day.y, day.m, day.d, Number(rel[2]), Number(rel[3] ?? 0));
    if (new Date(iso).getTime() < now.getTime() - 60_000) return undefined;
    return iso;
  }

  // Clock glued to grab keywords: 「8点开抢」「开抢8点」
  const nearGrabEarly =
    s.match(/(?:开抢|盯票|开始抢|开始盯|抢票|盯票开始|开抢时间)[^\d]{0,6}(\d{1,2})[:：点](\d{2})?/) ||
    s.match(/(\d{1,2})[:：点](\d{2})?[^\d开抢盯]{0,6}(?:开抢|盯票|开始抢|开始盯)/);
  if (nearGrabEarly) {
    let day = { y: sp.y, m: sp.m, d: sp.d };
    let iso = shanghaiLocalToIso(day.y, day.m, day.d, Number(nearGrabEarly[1]), Number(nearGrabEarly[2] ?? 0));
    if (new Date(iso).getTime() < now.getTime() - 60_000) {
      day = addShanghaiDays(day.y, day.m, day.d, 1);
      iso = shanghaiLocalToIso(day.y, day.m, day.d, Number(nearGrabEarly[1]), Number(nearGrabEarly[2] ?? 0));
    }
    if (new Date(iso).getTime() < now.getTime() - 60_000) return undefined;
    return iso;
  }

  // Full datetime: 2026-10-01 09:00 — but NOT travel windows like 2026-09-29 08:00-10:00
  const full = s.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})[ T](\d{1,2})[:：](\d{2})/);
  if (full) {
    const afterIdx = (full.index ?? 0) + full[0].length;
    const after = s.slice(afterIdx, afterIdx + 3);
    // Reject if this clock starts a range (08:00-10:00 / 08:00~10:00 / 08:00到10:00)
    if (/^\s*[-~～到至]/.test(after)) {
      /* travel window — ignore */
    } else {
      const iso = shanghaiLocalToIso(
        Number(full[1]),
        Number(full[2]),
        Number(full[3]),
        Number(full[4]),
        Number(full[5])
      );
      if (new Date(iso).getTime() >= now.getTime() - 60_000) return iso;
    }
  }

  // Bare clock with grab intent (or short-answer): 8点 / 08:00 / 20点30
  // Skip if this clock is clearly part of a travel range when requireIntent (already gated),
  // or when 「出发」 marks departure time.
  if (/出发/.test(s) && !hasExplicitGrabStartIntent(s)) return undefined;

  // Prefer clock near grab keywords when present
  const nearGrab =
    s.match(/(?:开抢|盯票|开始抢|开始盯|抢票|盯票开始|开抢时间)[^\d]{0,6}(\d{1,2})[:：点](\d{2})?/) ||
    s.match(/(\d{1,2})[:：点](\d{2})?[^\d开抢盯]{0,6}(?:开抢|盯票|开始抢|开始盯)/);
  const hm = nearGrab || (!requireIntent || hasExplicitGrabStartIntent(s) ? s.match(/(\d{1,2})[:：点](\d{2})?/) : null);
  // Avoid matching the first number of a range like 8点到10点 when no grab intent on that clock
  if (hm && hasTravelTimeRange(s) && !nearGrab) {
    // e.g. 「明天上午8点到10点开抢」 is odd; require nearGrab
    if (!/开抢|盯票/.test(s)) return undefined;
  }
  if (hm && !/\d{4}[./-]\d{1,2}[./-]\d{1,2}/.test(s)) {
    let day = { y: sp.y, m: sp.m, d: sp.d };
    let iso = shanghaiLocalToIso(day.y, day.m, day.d, Number(hm[1]), Number(hm[2] ?? 0));
    if (new Date(iso).getTime() < now.getTime() - 60_000) {
      // roll to next Shanghai calendar day
      day = addShanghaiDays(day.y, day.m, day.d, 1);
      iso = shanghaiLocalToIso(day.y, day.m, day.d, Number(hm[1]), Number(hm[2] ?? 0));
    }
    if (new Date(iso).getTime() < now.getTime() - 60_000) return undefined;
    return iso;
  }

  // Date-only is not enough in free-form; short-answer may set midnight+08:00 if future
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

function acceptPlaceCandidate(raw: string): string | undefined {
  const place = cleanPlaceToken(raw);
  if (!place || /\d/.test(place) || /到|去|至|→/.test(place) || /[:：点./]/.test(place)) {
    return undefined;
  }
  // Only known stations/cities may populate from/to (cities later disambiguated).
  if (!isKnownTrainStationName(place)) return undefined;
  return place;
}

function extractFromTo(text: string): { from?: string; to?: string } {
  // Prefer "从A到B"; never treat date hyphens as route separators.
  const cleaned = stripTemporalTokens(text);
  const m =
    cleaned.match(/从\s*([^\s到去至→,，。的]{2,20})\s*(?:到|去|至|→|->)\s*([^\s,，。的]{2,20})/) ||
    cleaned.match(
      /([\u4e00-\u9fff]{2,12})\s*(?:到|去|至|→|->)\s*([\u4e00-\u9fff]{2,12})/
    ) ||
    // Hyphen only when BOTH sides are pure Chinese (北京-上海), never 2026-09
    cleaned.match(/([\u4e00-\u9fff]{2,12})\s*[-—]\s*([\u4e00-\u9fff]{2,12})/);
  if (!m) return {};
  const result: { from?: string; to?: string } = {};
  const from = acceptPlaceCandidate(m[1]!);
  const to = acceptPlaceCandidate(m[2]!);
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
  if (/不限|任意|都行|无所谓/.test(text)) return "不限";
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

function extractEvent(text: string): { eventName?: string; venue?: string; city?: string } {
  const venue = text.match(/(?:在|于)\s*([^\s,，。]{2,30}(?:体育场|体育馆|中心|大剧院|剧场|场馆|Arena|arena))/);
  const city = text.match(/(北京|上海|广州|深圳|杭州|成都|重庆|武汉|西安|南京|苏州|天津|长沙|郑州|青岛|厦门|福州)/);
  let eventName = text
    .replace(/我想|我要|帮我|盯票|抢票|买票|看|听/g, "")
    .replace(/演出|演唱会|音乐会/g, "")
    .trim();
  if (eventName.length < 2) eventName = undefined as unknown as string;
  return {
    eventName: eventName && eventName.length >= 2 ? eventName.slice(0, 80) : undefined,
    venue: venue?.[1],
    city: city?.[1],
  };
}

/** Merge extractions from a user utterance into session fields. */
export function extractIntakePatch(text: string, current: IntakeFields, now = new Date()): Partial<IntakeFields> {
  const patch: Partial<IntakeFields> = {};
  const channel = detectChannel(text) ?? current.channel;
  if (!current.channel && channel) patch.channel = channel;
  const ch = patch.channel ?? current.channel;

  if (ch === "show") {
    const ev = extractEvent(text);
    if (ev.eventName && !current.eventName) patch.eventName = ev.eventName;
    if (ev.venue && !current.venue) patch.venue = ev.venue;
    if (ev.city && !current.fromCity) patch.fromCity = ev.city;
    if (/未知|没有|无|不详|skip/i.test(text.trim()) && !current.venue) patch.venue = "未知";
  } else {
    const ft = extractFromTo(text);
    if (ft.from && !current.from) patch.from = ft.from;
    if (ft.to && !current.to) patch.to = ft.to;
    // single-token answers when asking from/to
    if (!ft.from && !ft.to && text.trim().length >= 2 && text.trim().length <= 20) {
      if (!current.from && (ch === "train" || ch === "flight")) {
        // only fill from if to also missing and message looks like a place
        if (!/^\d/.test(text) && !detectChannel(text)) {
          /* defer — handled by nextMissing prompting */
        }
      }
    }
  }

  const date = normalizeDateToken(text, now);
  if (date && !current.date) patch.date = date;

  const tw = extractTimeWindow(text);
  if (tw && !current.timeWindow) patch.timeWindow = tw;
  if (/不限|任意|都行/.test(text) && ch !== "show" && !current.timeWindow) patch.timeWindow = "不限";

  const seat = extractSeat(text);
  if (seat && !current.seatClass) patch.seatClass = seat;
  if (/不限|任意|都行/.test(text) && ch === "train" && !current.seatClass) patch.seatClass = "不限";

  const cabin = extractCabin(text);
  if (cabin && !current.cabin) patch.cabin = cabin;
  if (/不限|任意|都行/.test(text) && ch === "flight" && !current.cabin) patch.cabin = "不限";

  if (ch === "show") {
    // Do not treat YYYY-MM-DD (or bare year 20xx) as a ticket tier.
    const looksLikeDate = /\d{4}[-/.年]\d{1,2}([-/.月]\d{1,2})?/.test(text) || /^20\d{2}$/.test(text.trim());
    if (!looksLikeDate) {
      const tierM = text.match(/(?:票档\s*)?(\d{2,5}\s*元|[A-Z]区|内场|看台|VIP)|票档\s*(\S+)/i);
      if (tierM && !current.tier) patch.tier = (tierM[1] || tierM[2])!.trim();
    }
    if (/不限|任意|都行/.test(text) && !current.tier && !looksLikeDate) patch.tier = "不限";
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
  now = new Date()
): Partial<IntakeFields> {
  const t = text.trim();
  if (field === "channel") {
    const c = detectChannel(t);
    return c ? { channel: c } : {};
  }
  if (field === "from" || field === "to" || field === "venue" || field === "eventName") {
    if (/未知|没有|无|不详/.test(t) && field === "venue") return { venue: "未知" };
    if ((field === "from" || field === "to") && t.length >= 1 && t.length <= 40) {
      // Train: allowlist only. Flight/other: reject digit/date garbage but allow free text.
      if (/\d{4}|[./]/.test(t) || /到|去|至/.test(t)) return {};
      const place = acceptPlaceCandidate(t);
      if (place) return { [field]: place };
      // Non-allowlist short answers still accepted for disambiguation retries only if no digits
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
      if (isAmbiguousCityPlace(String(v))) return f;
      // Reject digit/date garbage on any channel
      if (/\d/.test(String(v)) || /[./]/.test(String(v)) || /到|去|至/.test(String(v))) return f;
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
    value: fields.grabStartAt ? new Date(fields.grabStartAt).toLocaleString("zh-CN", { hour12: false }) : "现在",
  });

  const capabilityNote =
    fields.channel === "train"
      ? "将创建「监控盯票」任务：定时查询 12306 公开余票并通知。不含官方授权的无人值守占座/购票。"
      : fields.channel === "show"
        ? "将创建「开售/有票监控」：定时检查公开场次信息并通知；下单需跳转大麦等官方完成。不含未授权自动抢购。"
        : "将创建「航班监控」：按配置数据源查询并通知；购票跳转航司/OTA 官方。不含代收票款。";

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
    const short = applyShortAnswer(asking, userMessage, now);
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
  // Defaults after channel known
  if (fields.channel && fields.passengers == null && patch.passengers == null) {
    /* still ask */
  }

  // Drop invalid / garbage station tokens; never confirm with date fragments or fakes
  if (fields.channel === "train" || fields.channel === "flight") {
    const dropBad = (v?: string) =>
      !v || /\d/.test(v) || /[./]/.test(v) || /到|去|至/.test(v) ||
      (fields.channel === "train" && !isKnownTrainStationName(v));
    if (dropBad(fields.from)) delete fields.from;
    if (dropBad(fields.to)) delete fields.to;
    // If city-only places were captured, clear them so confirm cannot proceed on ambiguous stations
    if (isAmbiguousCityPlace(fields.from)) {
      fields.fromCity = fields.fromCity ?? String(fields.from);
      delete fields.from;
    }
    if (isAmbiguousCityPlace(fields.to)) {
      fields.toCity = fields.toCity ?? String(fields.to);
      delete fields.to;
    }
  }

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
  if (missing === "from" && fields.fromCity) {
    reply = `您提到出发地是「${fields.fromCity}」，该城市有多个车站。请回复确切出发站（例如「${fields.fromCity}南」「${fields.fromCity}西」）。`;
  } else if (missing === "to" && fields.toCity) {
    reply = `您提到到达地是「${fields.toCity}」，该城市有多个车站。请回复确切到达站（例如「${fields.toCity}虹桥」「${fields.toCity}南」）。`;
  } else if (missing === "date" && /下?周[日天一二三四五六]|周[日天一二三四五六]/.test(userMessage)) {
    reply = "您提到了星期几，请给出确切日期（格式 YYYY-MM-DD），以便准确盯票。";
  } else if (missing === "timeWindow" && /晚上|上午|下午|中午/.test(userMessage) && !/\d{1,2}:\d{2}/.test(userMessage)) {
    reply = "请给出更确切的时间段（例如「18:00-21:00」或「不限」）。";
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
