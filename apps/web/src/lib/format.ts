/** Small display helpers — no API changes. */

const FIELD_LABEL: Record<string, string> = {
  from: "出发",
  to: "到达",
  date: "日期",
  seatClass: "席别",
  passengers: "人数",
  eventName: "演出",
  city: "城市",
  venue: "场馆",
  category: "分类",
  quantity: "数量",
  performanceId: "演出ID",
  detailUrl: "详情链接",
  cabin: "舱位",
};

export function formatFields(fields: Record<string, unknown> | null | undefined): { key: string; label: string; value: string }[] {
  if (!fields) return [];
  return Object.entries(fields)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => ({
      key: k,
      label: FIELD_LABEL[k] ?? k,
      value: String(v),
    }));
}

export function formatFieldsInline(fields: Record<string, unknown> | null | undefined): string {
  return formatFields(fields)
    .map((f) => `${f.label} ${f.value}`)
    .join(" · ");
}


/** Asia/Shanghai wall-clock for grab starts / next runs (never raw UTC as local). */
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
    fmt.formatToParts(d).filter((x) => x.type !== "literal").map((x) => [x.type, x.value])
  );
  const hh = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day} ${hh}:${parts.minute} +08:00`;
}
