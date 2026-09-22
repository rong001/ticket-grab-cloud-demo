"use client";

import { useMemo, useState } from "react";

export type TrainResultItem = {
  id: string;
  title: string;
  subtitle?: string;
  price?: number;
  currency?: string;
  availability: string;
  meta?: Record<string, unknown>;
};

const SEAT_KEYS = [
  { key: "business", label: "商务/特等" },
  { key: "first", label: "一等座" },
  { key: "second", label: "二等座" },
  { key: "softSleeper", label: "软卧" },
  { key: "hardSleeper", label: "硬卧" },
  { key: "hardSeat", label: "硬座" },
  { key: "noSeat", label: "无座" },
] as const;

const TYPE_FILTERS = [
  { id: "all", label: "全部" },
  { id: "G", label: "高铁 G" },
  { id: "D", label: "动车 D" },
  { id: "C", label: "城际 C" },
  { id: "other", label: "其他" },
] as const;

const AVAIL_ZH: Record<string, string> = {
  available: "有",
  limited: "紧张",
  sold_out: "无",
  waitlist: "候补",
  unknown: "--",
};

type SeatCell = { label?: string; token?: string; availability?: string };

function trainTypeOf(item: TrainResultItem): string {
  const meta = item.meta ?? {};
  if (typeof meta.trainType === "string" && meta.trainType) return meta.trainType;
  const no = typeof meta.trainNo === "string" ? meta.trainNo : item.title.split(" ")[0] ?? "";
  const c = no.charAt(0).toUpperCase();
  return "GDCZTK".includes(c) ? c : "other";
}

function seatCells(item: TrainResultItem): Record<string, SeatCell> {
  const raw = item.meta?.seats;
  if (raw && typeof raw === "object") return raw as Record<string, SeatCell>;
  // Fallback: single seatClass column highlight
  const seatClass = typeof item.meta?.seatClass === "string" ? item.meta.seatClass : "";
  const token =
    typeof item.meta?.seatToken === "string"
      ? item.meta.seatToken
      : item.availability === "available"
        ? "有"
        : item.availability === "limited"
          ? "紧张"
          : item.availability === "waitlist"
            ? "候补"
            : "无";
  const map: Record<string, string> = {
    商务座: "business",
    特等座: "business",
    一等座: "first",
    二等座: "second",
    软卧: "softSleeper",
    硬卧: "hardSleeper",
    硬座: "hardSeat",
    无座: "noSeat",
  };
  const key = map[seatClass] ?? "second";
  return {
    [key]: { label: seatClass || "二等座", token, availability: item.availability },
  };
}

type Props = {
  items: TrainResultItem[];
  onOrder: (item: TrainResultItem) => void;
  orderLabel?: string;
};

export default function TrainResultsTable({ items, onOrder, orderLabel = "预订" }: Props) {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [onlyAvailable, setOnlyAvailable] = useState(false);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      const t = trainTypeOf(item);
      if (typeFilter === "G" || typeFilter === "D" || typeFilter === "C") {
        if (t !== typeFilter) return false;
      } else if (typeFilter === "other") {
        if (t === "G" || t === "D" || t === "C") return false;
      }
      if (onlyAvailable) {
        const seats = seatCells(item);
        const any = Object.values(seats).some(
          (s) => s.availability === "available" || s.availability === "limited" || s.token === "有"
        );
        if (!any && item.availability !== "available" && item.availability !== "limited") return false;
      }
      return true;
    });
  }, [items, typeFilter, onlyAvailable]);

  return (
    <div className="train-results">
      <div className="train-filters">
        <span className="muted" style={{ fontWeight: 600 }}>车次类型</span>
        <div className="chip-row" role="group" aria-label="车次类型">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={typeFilter === f.id ? "date-chip active" : "date-chip"}
              onClick={() => setTypeFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="check-row" style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={onlyAvailable}
            onChange={(e) => setOnlyAvailable(e.target.checked)}
          />
          <span>只看有票</span>
        </label>
      </div>

      <div className="train-table-wrap">
        <table className="train-table">
          <thead>
            <tr>
              <th>车次</th>
              <th>出发 / 到达</th>
              <th>历时</th>
              {SEAT_KEYS.map((s) => (
                <th key={s.key}>{s.label}</th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={3 + SEAT_KEYS.length + 1} className="muted">
                  无匹配车次（可调整高铁/动车筛选）
                </td>
              </tr>
            )}
            {filtered.map((item) => {
              const meta = item.meta ?? {};
              const trainNo =
                typeof meta.trainNo === "string" ? meta.trainNo : item.title.split(" ")[0];
              const dep =
                typeof meta.depTime === "string"
                  ? meta.depTime
                  : item.subtitle?.match(/(\d{2}:\d{2})/)?.[1] ?? "--:--";
              const arr =
                typeof meta.arrTime === "string"
                  ? meta.arrTime
                  : item.subtitle?.match(/\d{2}:\d{2}[–-](\d{2}:\d{2})/)?.[1] ?? "--:--";
              const fromName = typeof meta.fromName === "string" ? meta.fromName : "";
              const toName = typeof meta.toName === "string" ? meta.toName : "";
              const duration = typeof meta.duration === "string" ? meta.duration : "";
              const seats = seatCells(item);
              return (
                <tr key={item.id}>
                  <td>
                    <div className="train-no">{trainNo}</div>
                    <div className="muted train-type-tag">{trainTypeOf(item)}</div>
                  </td>
                  <td>
                    <div className="train-time-row">
                      <strong>{dep}</strong>
                      <span className="muted">{fromName}</span>
                    </div>
                    <div className="train-time-row">
                      <strong>{arr}</strong>
                      <span className="muted">{toName}</span>
                    </div>
                  </td>
                  <td className="muted">{duration || "—"}</td>
                  {SEAT_KEYS.map((s) => {
                    const cell = seats[s.key];
                    const token = cell?.token;
                    const avail = cell?.availability;
                    const display =
                      token && token !== ""
                        ? token
                        : avail
                          ? AVAIL_ZH[avail] ?? "--"
                          : "--";
                    const cls =
                      avail === "available" || token === "有"
                        ? "seat-yes"
                        : avail === "limited" || (token && /^\d+$/.test(token))
                          ? "seat-limited"
                          : avail === "waitlist" || token === "候补"
                            ? "seat-wait"
                            : "seat-no";
                    return (
                      <td key={s.key} className={`seat-cell ${cls}`}>
                        {display}
                      </td>
                    );
                  })}
                  <td>
                    <button type="button" onClick={() => onOrder(item)}>
                      {orderLabel}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.5rem" }}>
        席别余票样式对齐 12306 时刻表；下单为站内协助建单，登录验证码/短信/人脸须本人在官方流程完成。
      </p>
    </div>
  );
}
