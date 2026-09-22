"use client";

import { useMemo, useState } from "react";

export type ShowResultItem = {
  id: string;
  title: string;
  subtitle?: string;
  datetime?: string;
  price?: number;
  currency?: string;
  availability: string;
  meta?: Record<string, unknown>;
};

const AVAIL_ZH: Record<string, string> = {
  available: "在售",
  limited: "即将开售",
  sold_out: "售罄",
  waitlist: "缺货登记",
  unknown: "未知",
};

function metaStr(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = meta?.[key];
  return typeof v === "string" && v ? v : undefined;
}

function metaNum(meta: Record<string, unknown> | undefined, key: string): number | undefined {
  const v = meta?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function saleBadge(item: ShowResultItem): string {
  const label = metaStr(item.meta, "saleStatusLabel");
  if (label) return label;
  return AVAIL_ZH[item.availability] ?? item.availability;
}

function badgeClass(item: ShowResultItem): string {
  const label = saleBadge(item);
  if (label === "在售" || item.availability === "available") return "available";
  if (label === "即将开售" || item.availability === "limited") return "limited";
  if (label === "缺货登记" || item.availability === "waitlist") return "waitlist";
  if (label === "售罄" || item.availability === "sold_out") return "sold_out";
  return "info";
}

function ctaLabel(item: ShowResultItem): string {
  const label = saleBadge(item);
  if (label === "在售" || item.availability === "available") return "立即购买";
  if (label === "即将开售" || item.availability === "limited") return "预约抢票";
  if (label === "缺货登记" || item.availability === "waitlist") return "缺货登记";
  if (label === "售罄" || item.availability === "sold_out") return "售罄";
  return "选座购买";
}

function groupKey(item: ShowResultItem): string {
  const pid = item.meta?.performanceId;
  if (pid != null && String(pid)) return `p-${pid}`;
  return `t-${item.title}`;
}

function showIdOf(item: ShowResultItem): string {
  return String(metaNum(item.meta, "showId") ?? item.id);
}

function dateRangeOf(g: ShowGroup): string | undefined {
  const range = g.sessions.map((s) => metaStr(s.meta, "showTimeRange") ?? metaStr(s.meta, "sessionDate")).filter(Boolean);
  if (range[0]) return range[0];
  const dates = g.sessions
    .map((s) => metaStr(s.meta, "sessionDate") ?? s.datetime?.slice(0, 10))
    .filter(Boolean) as string[];
  if (!dates.length) return undefined;
  const uniq = Array.from(new Set(dates)).sort();
  if (uniq.length === 1) return uniq[0];
  return `${uniq[0]} — ${uniq[uniq.length - 1]}`;
}

type ShowGroup = {
  key: string;
  title: string;
  city?: string;
  venue?: string;
  posterUrl?: string;
  priceRange?: string;
  price?: number;
  currency?: string;
  sourceLabel?: string;
  sessions: ShowResultItem[];
};

type Props = {
  items: ShowResultItem[];
  onOrder: (item: ShowResultItem) => void;
  orderLabel?: string;
};

export default function ShowResultsList({ items, onOrder, orderLabel }: Props) {
  const groups = useMemo(() => {
    const map = new Map<string, ShowGroup>();
    for (const item of items) {
      const key = groupKey(item);
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          title: item.title,
          city: metaStr(item.meta, "city"),
          venue: metaStr(item.meta, "venue"),
          posterUrl: metaStr(item.meta, "posterUrl"),
          priceRange: metaStr(item.meta, "priceRange"),
          price: item.price,
          currency: item.currency,
          sourceLabel: metaStr(item.meta, "sourceLabel"),
          sessions: [],
        };
        map.set(key, g);
      }
      g.sessions.push(item);
      if (item.price != null && (g.price == null || item.price < g.price)) g.price = item.price;
      if (!g.priceRange && metaStr(item.meta, "priceRange")) g.priceRange = metaStr(item.meta, "priceRange");
    }
    return Array.from(map.values());
  }, [items]);

  const [selectedByGroup, setSelectedByGroup] = useState<Record<string, string>>({});
  const [sheetGroup, setSheetGroup] = useState<string | null>(null);
  const [onlyOnSale, setOnlyOnSale] = useState(false);

  const visible = useMemo(() => {
    if (!onlyOnSale) return groups;
    return groups
      .map((g) => ({
        ...g,
        sessions: g.sessions.filter(
          (s) => s.availability === "available" || s.availability === "limited"
        ),
      }))
      .filter((g) => g.sessions.length > 0);
  }, [groups, onlyOnSale]);

  function selectedItem(g: ShowGroup): ShowResultItem {
    const id = selectedByGroup[g.key];
    return g.sessions.find((s) => s.id === id) ?? g.sessions[0]!;
  }

  function uniqueSessions(g: ShowGroup): ShowResultItem[] {
    const seen = new Set<string>();
    const out: ShowResultItem[] = [];
    for (const s of g.sessions) {
      const sid = showIdOf(s);
      if (seen.has(sid)) continue;
      seen.add(sid);
      out.push(s);
    }
    return out;
  }

  function tiersForSession(g: ShowGroup, session: ShowResultItem): ShowResultItem[] {
    const sid = showIdOf(session);
    const same = g.sessions.filter((s) => showIdOf(s) === sid);
    const withTier = same.filter((s) => metaStr(s.meta, "tier") || metaNum(s.meta, "ticketClassId") != null);
    return withTier.length ? withTier : [session];
  }

  const openGroup = visible.find((g) => g.key === sheetGroup) ?? null;

  return (
    <div className="show-results">
      <div className="show-filters">
        <span className="muted" style={{ fontWeight: 600 }}>
          场次筛选
        </span>
        <label className="check-row" style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={onlyOnSale}
            onChange={(e) => setOnlyOnSale(e.target.checked)}
          />
          <span>只看在售 / 即将开售</span>
        </label>
      </div>

      {visible.length === 0 && (
        <p className="muted" style={{ padding: "1rem 0" }}>
          无匹配场次（可取消「只看在售」或调整城市/关键词）
        </p>
      )}

      <div className="show-card-list">
        {visible.map((g) => {
          const sel = selectedItem(g);
          const badge = saleBadge(sel);
          const sessions = uniqueSessions(g);
          const range = dateRangeOf(g);
          const cta = orderLabel ?? ctaLabel(sel);
          const isDemo =
            g.sourceLabel?.includes("演示") ||
            metaStr(sel.meta, "source") === "fixture" ||
            String(sel.meta?.platform ?? "").includes("fixture");

          return (
            <article className="show-card" key={g.key}>
              <div className="show-card-poster" aria-hidden>
                {g.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={g.posterUrl} alt="" />
                ) : (
                  <div className="show-card-poster-ph">演</div>
                )}
                <span className={`show-ribbon ${badgeClass(sel)}`}>{badge}</span>
              </div>
              <div className="show-card-body">
                <div className="show-card-hd">
                  <h3 className="show-card-title">{g.title}</h3>
                  <span className={`badge ${isDemo ? "demo" : "live"}`}>
                    {isDemo ? "演示" : g.sourceLabel?.includes("实时") ? "实时" : "场次"}
                  </span>
                </div>
                <div className="show-card-meta muted">
                  {[g.city, g.venue].filter(Boolean).join(" · ") || sel.subtitle}
                </div>
                {range && <div className="show-card-dates muted">{range}</div>}

                <div className="show-session-chips" role="group" aria-label="场次">
                  {sessions.slice(0, 4).map((s) => {
                    const label =
                      metaStr(s.meta, "sessionName") ??
                      s.datetime?.replace("T", " ").slice(0, 16) ??
                      "场次";
                    const active =
                      showIdOf(sel) === showIdOf(s);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={active ? "show-session-chip active" : "show-session-chip"}
                        onClick={() =>
                          setSelectedByGroup((prev) => ({ ...prev, [g.key]: s.id }))
                        }
                      >
                        {label}
                      </button>
                    );
                  })}
                  {sessions.length > 4 && (
                    <button
                      type="button"
                      className="show-session-chip more"
                      onClick={() => setSheetGroup(g.key)}
                    >
                      全部 {sessions.length} 场 ›
                    </button>
                  )}
                </div>

                {(() => {
                  const tiers = tiersForSession(g, sel);
                  if (tiers.length <= 1 && !metaStr(tiers[0]?.meta, "tier")) return null;
                  return (
                    <div className="show-tier-chips" role="group" aria-label="票档">
                      {tiers.map((t) => {
                        const label =
                          metaStr(t.meta, "tier") ??
                          (t.price != null ? `¥${t.price}` : "票档");
                        const active = sel.id === t.id;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            className={active ? "show-tier-chip active" : "show-tier-chip"}
                            onClick={() =>
                              setSelectedByGroup((prev) => ({ ...prev, [g.key]: t.id }))
                            }
                          >
                            {label}
                            {t.availability === "sold_out" || t.availability === "waitlist"
                              ? " · 缺"
                              : ""}
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}

                <div className="show-card-ft">
                  <div className="show-price">
                    {g.priceRange ? (
                      <>
                        <span className="show-price-yen">¥</span>
                        <span className="show-price-num">{g.priceRange}</span>
                        <span className="muted"> 起</span>
                      </>
                    ) : sel.price != null ? (
                      <>
                        <span className="show-price-yen">¥</span>
                        <span className="show-price-num">{sel.price}</span>
                        <span className="muted"> 起</span>
                      </>
                    ) : (
                      <span className="muted">价格待公布</span>
                    )}
                  </div>
                  <div className="show-card-actions">
                    <button
                      type="button"
                      className="btn-show-session"
                      onClick={() => setSheetGroup(g.key)}
                    >
                      选场次
                    </button>
                    <button
                      type="button"
                      className="btn-show-buy"
                      onClick={() => onOrder(sel)}
                      disabled={cta === "售罄"}
                    >
                      {cta}
                    </button>
                  </div>
                </div>
                {g.sourceLabel && (
                  <div className="show-source muted">{g.sourceLabel}</div>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {openGroup && (
        <div
          className="show-sheet-backdrop"
          role="presentation"
          onClick={() => setSheetGroup(null)}
        >
          <div
            className="show-sheet"
            role="dialog"
            aria-label="选择场次"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="show-sheet-hd">
              <strong>选择场次</strong>
              <button type="button" className="ghost" onClick={() => setSheetGroup(null)}>
                关闭
              </button>
            </div>
            <p className="show-sheet-title">{openGroup.title}</p>
            <ul className="show-sheet-list">
              {uniqueSessions(openGroup).map((s) => {
                const active = showIdOf(selectedItem(openGroup)) === showIdOf(s);
                const label =
                  metaStr(s.meta, "sessionName") ??
                  s.datetime?.replace("T", " ").slice(0, 16) ??
                  "场次";
                const remain =
                  saleBadge(s) +
                  (metaStr(s.meta, "remainingHint")
                    ? ` · ${metaStr(s.meta, "remainingHint")}`
                    : s.meta?.hasInventory === true
                      ? " · 有票"
                      : "");
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={active ? "show-sheet-row active" : "show-sheet-row"}
                      onClick={() => {
                        setSelectedByGroup((prev) => ({ ...prev, [openGroup.key]: s.id }));
                      }}
                    >
                      <span className="show-sheet-row-time">{label}</span>
                      <span className={`badge ${badgeClass(s)}`}>{remain}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="show-sheet-ft">
              <button
                type="button"
                className="btn-show-buy"
                onClick={() => {
                  onOrder(selectedItem(openGroup));
                  setSheetGroup(null);
                }}
              >
                {orderLabel ?? ctaLabel(selectedItem(openGroup))}
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.75rem" }}>
        流程：选城 → 搜演 → 选场次/票档 → 预约或立即购买 → 系统内下单协助 → 跳转大麦/猫眼支付。
        场次来自猫眼/格瓦拉/点评公开接口；布局为大麦风格参考（无官方商标）。不做验证码/队列绕过。
      </p>
    </div>
  );
}
