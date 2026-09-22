export type Channel = "train" | "show" | "flight";

export type RequestTemplate = {
  id: string;
  channel: Channel;
  title: string;
  description?: string;
  fields: Record<string, string | number>;
};

/** Next Saturday (or today if already Saturday), YYYY-MM-DD local. */
export function nextSaturdayISO(from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const day = d.getDay(); // 0 Sun … 6 Sat
  const delta = day === 6 ? 0 : (6 - day + 7) % 7;
  d.setDate(d.getDate() + delta);
  return formatISODate(d);
}

/** Today + 7 days, YYYY-MM-DD local. */
export function plusDaysISO(days: number, from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + days);
  return formatISODate(d);
}

function formatISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Resolve template fields for the form.
 * Dates marked as `__next_saturday__` or `__plus_7__` are computed at apply time.
 */
export function resolveTemplateFields(
  template: RequestTemplate,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(template.fields)) {
    if (v === "__next_saturday__") out[k] = nextSaturdayISO();
    else if (v === "__plus_7__") out[k] = plusDaysISO(7);
    else out[k] = v;
  }
  return out;
}

export const REQUEST_TEMPLATES: RequestTemplate[] = [
  {
    id: "train-sz-sw",
    channel: "train",
    title: "深汕周末",
    description: "深圳北 → 汕尾 · 二等座",
    fields: {
      from: "深圳北",
      to: "汕尾",
      date: "__next_saturday__",
      seatClass: "二等座",
      passengers: 1,
    },
  },
  {
    id: "train-bj-sh",
    channel: "train",
    title: "京沪高铁",
    description: "北京南 → 上海虹桥 · 二等座",
    fields: {
      from: "北京南",
      to: "上海虹桥",
      date: "__plus_7__",
      seatClass: "二等座",
      passengers: 1,
    },
  },
  {
    id: "train-gz-sz",
    channel: "train",
    title: "广深通勤",
    description: "广州南 → 深圳北 · 二等座",
    fields: {
      from: "广州南",
      to: "深圳北",
      date: "__plus_7__",
      seatClass: "二等座",
      passengers: 1,
    },
  },
  {
    id: "show-concert",
    channel: "show",
    title: "一线演唱会周末",
    description: "深圳 · 周末场",
    fields: {
      eventName: "演唱会",
      city: "深圳",
      venue: "深圳湾体育中心",
      date: "__next_saturday__",
      quantity: 2,
    },
  },
  {
    id: "show-musical",
    channel: "show",
    title: "音乐剧",
    description: "上海 · 周末",
    fields: {
      eventName: "音乐剧",
      city: "上海",
      venue: "梅赛德斯-奔驰文化中心",
      date: "__next_saturday__",
      quantity: 2,
    },
  },
  {
    id: "flight-sz-sh",
    channel: "flight",
    title: "深沪出差",
    description: "SZX → PVG · 经济舱",
    fields: {
      from: "SZX",
      to: "PVG",
      date: "__plus_7__",
      cabin: "经济舱",
      passengers: 1,
    },
  },
  {
    id: "flight-bj-gz",
    channel: "flight",
    title: "京广",
    description: "PEK → CAN · 经济舱",
    fields: {
      from: "PEK",
      to: "CAN",
      date: "__plus_7__",
      cabin: "经济舱",
      passengers: 1,
    },
  },
];

export function templatesForChannel(channel: Channel): RequestTemplate[] {
  return REQUEST_TEMPLATES.filter((t) => t.channel === channel);
}
