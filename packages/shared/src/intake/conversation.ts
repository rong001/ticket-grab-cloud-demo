/**
 * Chinese conversational ticket-intake extractor (rule-based, no LLM required).
 * Collects: channel, from/to (station/venue), date, time window, seat/class/tier,
 * passenger count, grab-start time — one missing field at a time.
 */

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
  from: "请告诉我出发站/出发城市（尽量写全称，例如「北京南」或「深圳宝安」）。",
  to: "请告诉我到达站/到达城市（尽量写全称，例如「上海虹桥」）。",
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
  const weekMap: Record<string, number> = {
    日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6,
  };
  const wm = s.match(/下?周([日天一二三四五六])/);
  if (wm) {
    const target = weekMap[wm[1]!];
    if (target != null) {
      const d = new Date(now);
      const cur = d.getDay();
      let add = (target - cur + 7) % 7;
      if (add === 0 || /下周/.test(s)) add += 7;
      d.setDate(d.getDate() + add);
      return isoDate(d);
    }
  }
  return undefined;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseGrabStart(raw: string, now = new Date()): string | undefined {
  const s = raw.trim();
  if (/现在|立刻|马上|立即/.test(s)) return now.toISOString();
  const full = s.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})[ T]?(\d{1,2}):(\d{2})/);
  if (full) {
    const d = new Date(
      Number(full[1]),
      Number(full[2]) - 1,
      Number(full[3]),
      Number(full[4]),
      Number(full[5])
    );
    return d.toISOString();
  }
  const tonight = s.match(/(今晚|今天|今日)\s*(\d{1,2})[:：点](\d{2})?/);
  if (tonight) {
    const d = new Date(now);
    d.setHours(Number(tonight[2]), Number(tonight[3] ?? 0), 0, 0);
    return d.toISOString();
  }
  const hm = s.match(/(\d{1,2})[:：点](\d{2})?/);
  if (hm && !/\d{4}/.test(s)) {
    const d = new Date(now);
    d.setHours(Number(hm[1]), Number(hm[2] ?? 0), 0, 0);
    if (d.getTime() < now.getTime()) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  const dateOnly = normalizeDateToken(s, now);
  if (dateOnly) {
    return new Date(`${dateOnly}T00:00:00+08:00`).toISOString();
  }
  return undefined;
}

function detectChannel(text: string): IntakeChannel | undefined {
  if (/火车|高铁|动车|列车|12306|火车票/.test(text)) return "train";
  if (/演出|演唱会|音乐会|话剧|大麦|猫眼|门票|票档/.test(text)) return "show";
  if (/机票|航班|飞机|民航|机场/.test(text)) return "flight";
  if (/^火车$|^高铁$|^列车$/.test(text.trim())) return "train";
  if (/^演出$|^演唱会$|^门票$/.test(text.trim())) return "show";
  if (/^机票$|^航班$|^飞机$/.test(text.trim())) return "flight";
  return undefined;
}

function extractFromTo(text: string): { from?: string; to?: string } {
  const m =
    text.match(/从\s*([^\s到去→\-—]{2,20})\s*(?:到|去|至|→|-|—)\s*([^\s,，。的]{2,20})/) ||
    text.match(/([^\s]{2,12})\s*(?:到|去|至|→|->|-|—)\s*([^\s,，。的]{2,12})/);
  if (m) return { from: m[1]!.trim(), to: m[2]!.trim() };
  return {};
}

function extractPassengers(text: string): number | undefined {
  const m = text.match(/(\d+)\s*(?:人|位|张|名)/) || text.match(/^(\d+)$/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 9) return n;
  }
  if (/一人|一位|单人/.test(text)) return 1;
  if (/两人|两位|双人/.test(text)) return 2;
  return undefined;
}

function extractSeat(text: string): string | undefined {
  const m = text.match(/(商务座|特等座|一等座|二等座|软卧|硬卧|软座|硬座|无座)/);
  return m?.[1];
}

function extractCabin(text: string): string | undefined {
  const m = text.match(/(头等舱|公务舱|商务舱|超级经济舱|经济舱)/);
  return m?.[1];
}

function extractTimeWindow(text: string): string | undefined {
  if (/不限|任意|都行|无所谓/.test(text)) return "不限";
  const range = text.match(/(\d{1,2}:\d{2})\s*[-~～到至]\s*(\d{1,2}:\d{2})/);
  if (range) return `${range[1]}-${range[2]}`;
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
    const tierM = text.match(/(\d{2,5}\s*元?|[A-Z]区|内场|看台|VIP|票档\s*\S+)/i);
    if (tierM && !current.tier) patch.tier = tierM[1]!.trim();
    if (/不限|任意|都行/.test(text) && !current.tier) patch.tier = "不限";
  }

  const pax = extractPassengers(text);
  if (pax != null && !current.passengers) patch.passengers = pax;

  const grab = parseGrabStart(text, now);
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
    const g = parseGrabStart(t, now);
    return g ? { grabStartAt: g } : {};
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
  // Defaults after channel known
  if (fields.channel && fields.passengers == null && patch.passengers == null) {
    /* still ask */
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

  const reply = questionFor(missing);
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
