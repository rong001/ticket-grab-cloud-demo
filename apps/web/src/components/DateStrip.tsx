"use client";

import { useMemo } from "react";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function weekdayZh(d: Date): string {
  return ["日", "一", "二", "三", "四", "五", "六"][d.getDay()] ?? "";
}

type Props = {
  value: string;
  onChange: (iso: string) => void;
  /** Number of days to show from today (default 15, ~12306 pre-sale window feel) */
  days?: number;
  minDate?: string;
  className?: string;
};

/** 12306-inspired horizontal date strip */
export default function DateStrip({ value, onChange, days = 15, minDate, className }: Props) {
  const items = useMemo(() => {
    const start = minDate ? new Date(minDate + "T00:00:00") : new Date();
    start.setHours(0, 0, 0, 0);
    const out: { iso: string; md: string; week: string; isToday: boolean }[] = [];
    const todayIso = toISO(new Date());
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = toISO(d);
      out.push({
        iso,
        md: `${d.getMonth() + 1}-${pad(d.getDate())}`,
        week: `周${weekdayZh(d)}`,
        isToday: iso === todayIso,
      });
    }
    return out;
  }, [days, minDate]);

  return (
    <div className={`date-strip${className ? ` ${className}` : ""}`} role="group" aria-label="出发日期">
      <div className="date-strip-scroll">
        {items.map((it) => (
          <button
            key={it.iso}
            type="button"
            className={
              value === it.iso
                ? "date-strip-item active"
                : it.isToday
                  ? "date-strip-item today"
                  : "date-strip-item"
            }
            onClick={() => onChange(it.iso)}
          >
            <span className="date-strip-week">{it.isToday ? "今天" : it.week}</span>
            <span className="date-strip-md">{it.md}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
