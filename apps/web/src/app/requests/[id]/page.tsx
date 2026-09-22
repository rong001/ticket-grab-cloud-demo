"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, getToken } from "@/lib/api";
import { formatFields } from "@/lib/format";
import TrainResultsTable from "@/components/TrainResultsTable";
import ShowResultsList from "@/components/ShowResultsList";
import { useDamaiTheme } from "@/components/DamaiTheme";
import FlowStepper, { stepsForChannel } from "@/components/FlowStepper";
import TimedGrabPanel, { type WatchJobRow } from "@/components/TimedGrabPanel";
import DateStrip from "@/components/DateStrip";

type Item = {
  id: string;
  title: string;
  subtitle?: string;
  price?: number;
  currency?: string;
  availability: string;
  channel?: string;
  meta?: Record<string, unknown>;
};

type Traveler = { id: string; name: string; idNumberHint?: string; type: string; relationship?: string };

type EventRow = {
  id: string;
  type: string;
  title: string;
  body?: string;
  emailed: boolean;
  createdAt: string;
};

type RequestDetail = {
  id: string;
  channel: string;
  fields: Record<string, unknown>;
  shortlists: {
    id: string;
    items: Item[];
    notes?: string;
    createdAt: string;
    mode?: string;
    provider?: string;
    liveOk?: boolean;
  }[];
  notifyOnly?: boolean;
  watchJobs: WatchJobRow[];
  events: EventRow[];
};

const CHANNEL_LABEL: Record<string, string> = {
  train: "火车票",
  show: "演出",
  flight: "机票",
};

const PERSON_LABEL: Record<string, string> = {
  train: "乘车人",
  show: "观演人",
  flight: "乘机人",
};

const AVAIL_LABEL: Record<string, string> = {
  available: "有票",
  limited: "紧张",
  sold_out: "售罄",
  waitlist: "候补",
};

const SHOW_AVAIL_LABEL: Record<string, string> = {
  available: "在售",
  limited: "即将开售",
  sold_out: "售罄",
  waitlist: "缺货登记",
  unknown: "未知",
};

const TRAIN_SEAT_OPTIONS = ["商务座", "特等座", "一等座", "二等座", "软卧", "硬卧", "硬座", "无座"];

function tierOrCabin(item: Item, channel: string): string | null {
  const meta = item.meta ?? {};
  if (channel === "show") {
    const tier = typeof meta.tier === "string" ? meta.tier : null;
    return tier ? `票档 ${tier}` : null;
  }
  if (channel === "flight") {
    const cabin = typeof meta.cabin === "string" ? meta.cabin : null;
    const map: Record<string, string> = {
      economy: "经济舱",
      business: "公务舱",
      first: "头等舱",
      premium_economy: "超级经济舱",
    };
    if (cabin) return `舱位 ${map[cabin] ?? cabin}`;
  }
  if (channel === "train") {
    const seat = typeof meta.seatClass === "string" ? meta.seatClass : null;
    return seat ? `席别 ${seat}` : null;
  }
  return null;
}

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function suggestShowWatchFromItems(items: Item[]): {
  startsAt?: Date;
  intervalMinutes: number;
  reason: string;
} {
  const now = Date.now();
  const onSaleTimes = items
    .map((i) => i.meta?.onSaleTime)
    .filter((t): t is number => typeof t === "number" && Number.isFinite(t));
  const future = onSaleTimes.filter((t) => t > now - 60_000);
  if (future.length) {
    const soonest = Math.min(...future);
    const msUntil = soonest - now;
    return {
      startsAt: new Date(Math.max(now, soonest - 30_000)),
      intervalMinutes: msUntil <= 2 * 60 * 60 * 1000 ? 1 : msUntil <= 24 * 60 * 60 * 1000 ? 5 : 15,
      reason: "已对齐公开开售时间（开售提醒 / 定时抢票）",
    };
  }
  if (items.some((i) => i.availability === "limited")) {
    return { intervalMinutes: 1, reason: "即将开售 — 建议 1 分钟高频「开售自动抢」" };
  }
  if (items.some((i) => i.availability === "available")) {
    return { intervalMinutes: 5, reason: "在售有票 — 建议定时抢票 5 分钟" };
  }
  return { intervalMinutes: 5, reason: "预约抢票默认间隔" };
}

function seatsFromItem(item: Item): string[] {
  const meta = item.meta ?? {};
  const seats = meta.seats;
  if (seats && typeof seats === "object") {
    const map: Record<string, string> = {
      business: "商务座",
      first: "一等座",
      second: "二等座",
      softSleeper: "软卧",
      hardSleeper: "硬卧",
      hardSeat: "硬座",
      noSeat: "无座",
    };
    const out: string[] = [];
    for (const [k, v] of Object.entries(seats as Record<string, { availability?: string; token?: string; label?: string }>)) {
      const ok =
        v?.availability === "available" ||
        v?.availability === "limited" ||
        v?.token === "有" ||
        (typeof v?.token === "string" && /^\d+$/.test(v.token));
      if (ok) out.push(v.label || map[k] || k);
    }
    if (out.length) return out;
  }
  if (typeof meta.seatClass === "string" && meta.seatClass) return [meta.seatClass];
  return TRAIN_SEAT_OPTIONS.slice(0, 4);
}

type WizardPhase = null | "seat" | "passengers" | "confirm";

export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<RequestDetail | null>(null);
  const [travelers, setTravelers] = useState<Traveler[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [endsAtLocal, setEndsAtLocal] = useState("");
  const [startsAtLocal, setStartsAtLocal] = useState("");
  const [autoOrder, setAutoOrder] = useState(false);
  const [preferredTrains, setPreferredTrains] = useState("");
  const [preferredSeats, setPreferredSeats] = useState("");
  const [preferredTiers, setPreferredTiers] = useState("");
  const [wizardItem, setWizardItem] = useState<Item | null>(null);
  const [wizardPhase, setWizardPhase] = useState<WizardPhase>(null);
  const [selectedSeat, setSelectedSeat] = useState("");
  const [selectedTravelers, setSelectedTravelers] = useState<string[]>([]);
  const [watchTravelerIds, setWatchTravelerIds] = useState<string[]>([]);
  const [preferredPlatform, setPreferredPlatform] = useState<"damai" | "maoyan">("damai");
  const [channelBadge, setChannelBadge] = useState<{ labelZh: string; badge: string } | null>(null);
  const [watchHint, setWatchHint] = useState("");
  useDamaiTheme(data?.channel === "show");

  const load = useCallback(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    api<RequestDetail>(`/requests/${id}`)
      .then(setData)
      .catch((e) => setError(e.message));
    api<Traveler[]>("/travelers")
      .then(setTravelers)
      .catch(() => undefined);
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!data || data.channel !== "show") return;
    const items = data.shortlists[0]?.items ?? [];
    if (!items.length) {
      setWatchHint("预约抢票 / 开售提醒：查票后可对齐开售时间开启「定时抢票」");
      return;
    }
    const sug = suggestShowWatchFromItems(items);
    setWatchHint(sug.reason);
    setIntervalMinutes(sug.intervalMinutes);
    if (sug.startsAt && !startsAtLocal) {
      setStartsAtLocal(toDatetimeLocalValue(sug.startsAt));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id, data?.channel, data?.shortlists?.[0]?.id]);

  useEffect(() => {
    if (!data?.channel) return;
    api<{ channels: { channel: string; labelZh: string; badge: string }[] }>("/meta/data-sources")
      .then((res) => {
        const row = res.channels.find((c) => c.channel === data.channel);
        if (row) setChannelBadge({ labelZh: row.labelZh, badge: row.badge });
      })
      .catch(() => undefined);
  }, [data?.channel]);

  const flowStep = useMemo(() => {
    if (!data) return "query";
    if (data.channel === "train") {
      if (!wizardItem) return data.shortlists[0]?.items?.length ? "trains" : "query";
      if (wizardPhase === "seat") return "seat";
      if (wizardPhase === "passengers") return "passengers";
      if (wizardPhase === "confirm") return "confirm";
      return "trains";
    }
    if (data.channel === "show") {
      if (!wizardItem) {
        if (!data.shortlists[0]?.items?.length) return "search";
        return "session";
      }
      if (wizardPhase === "seat" || wizardPhase === "passengers") return "tier";
      if (wizardPhase === "confirm") return "confirm";
      return "grab";
    }
    if (!wizardItem) return data.shortlists[0]?.items?.length ? "flights" : "query";
    if (wizardPhase === "passengers") return "passengers";
    if (wizardPhase === "confirm") return "confirm";
    return "cabin";
  }, [data, wizardItem, wizardPhase]);

  async function runSearch() {
    setBusy(true);
    setError("");
    try {
      await api(`/requests/${id}/search`, { method: "POST", body: "{}" });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "查票失败");
    } finally {
      setBusy(false);
    }
  }

  async function startWatch() {
    setBusy(true);
    setError("");
    try {
      const prefs: Record<string, unknown> = { notify: true };
      if (data?.channel === "train") {
        const trains = preferredTrains
          .split(/[,，\s]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        const seats = preferredSeats
          .split(/[,，\s]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (trains.length) prefs.preferredTrains = trains;
        if (seats.length) prefs.preferredSeats = seats;
      }
      if (data?.channel === "show") {
        const tiers = preferredTiers
          .split(/[,，\s]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (tiers.length) prefs.preferredTiers = tiers;
      }
      const payload: Record<string, unknown> = {
        intervalMinutes,
        autoOrder,
        preferences: prefs,
      };
      if (endsAtLocal) payload.endsAt = new Date(endsAtLocal).toISOString();
      if (startsAtLocal) payload.startsAt = new Date(startsAtLocal).toISOString();
      if (watchTravelerIds.length) payload.travelerIds = watchTravelerIds;
      await api(`/requests/${id}/watch`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "定时抢票开启失败");
      // ACTIVE_WATCH_LIMIT 400 surfaces via e.message
    } finally {
      setBusy(false);
    }
  }

  async function cancelWatch(jobId: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/requests/${id}/watch/${jobId}/cancel`, { method: "POST", body: "{}" });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "取消失败");
    } finally {
      setBusy(false);
    }
  }

  async function pauseWatch(jobId: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/requests/${id}/watch/${jobId}/pause`, { method: "POST", body: "{}" });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "暂停失败");
    } finally {
      setBusy(false);
    }
  }

  async function resumeWatch(jobId: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/requests/${id}/watch/${jobId}/resume`, { method: "POST", body: "{}" });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "恢复失败");
    } finally {
      setBusy(false);
    }
  }

  async function createDraftFromWatch(jobId: string) {
    setBusy(true);
    setError("");
    try {
      const res = await api<{ orderId: string; orderPath: string }>(`/grabs/${jobId}/create-order`, {
        method: "POST",
        body: "{}",
      });
      router.push(res.orderPath || `/orders/${res.orderId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建草稿订单失败");
    } finally {
      setBusy(false);
    }
  }

  function openWizard(item: Item) {
    setWizardItem(item);
    setSelectedTravelers([]);
    if (data?.channel === "train") {
      const seats = seatsFromItem(item);
      setSelectedSeat(seats[0] ?? "");
      setWizardPhase("seat");
    } else if (data?.channel === "show") {
      setSelectedSeat(typeof item.meta?.tier === "string" ? item.meta.tier : "");
      setWizardPhase("passengers");
    } else {
      setWizardPhase("passengers");
    }
  }

  function toggleTraveler(tid: string) {
    setSelectedTravelers((prev) =>
      prev.includes(tid) ? prev.filter((x) => x !== tid) : [...prev, tid]
    );
  }

  async function confirmOrder() {
    if (!wizardItem || !selectedTravelers.length) {
      setError(`请选择至少一位${PERSON_LABEL[data?.channel ?? "train"] ?? "乘车人"}`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const shortlistItem = {
        ...wizardItem,
        meta: {
          ...(wizardItem.meta ?? {}),
          ...(data?.channel === "train" && selectedSeat ? { seatClass: selectedSeat } : {}),
          ...(data?.channel === "show" && selectedSeat ? { tier: selectedSeat } : {}),
        },
      };
      const body: Record<string, unknown> = {
        selectedShortlistItemId: wizardItem.id,
        travelerIds: selectedTravelers,
        shortlistItem,
      };
      if (data?.channel === "show") {
        body.preferredPlatform = preferredPlatform;
      }
      const order = await api<{ id: string; status: string; checkoutPath?: string }>(
        `/requests/${id}/orders`,
        {
          method: "POST",
          body: JSON.stringify(body),
        }
      );
      setWizardItem(null);
      setWizardPhase(null);
      router.push(order.checkoutPath ?? `/checkout/${order.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "下单失败");
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) return <p className="loading">加载中…</p>;
  if (!data) return <p className="error">{error}</p>;

  const shortlist = data.shortlists[0];
  const channelLabel = CHANNEL_LABEL[data.channel] ?? data.channel;
  const personLabel = PERSON_LABEL[data.channel] ?? "乘车人";
  const waitlistHint =
    wizardItem &&
    (wizardItem.availability === "sold_out" || wizardItem.availability === "waitlist");
  const fields = formatFields(data.fields);
  const seatChoices = wizardItem ? seatsFromItem(wizardItem) : [];

  return (
    <div className={data.channel === "train" ? "train-chrome" : data.channel === "show" ? "show-chrome" : ""}>
      <FlowStepper
        steps={stepsForChannel(data.channel)}
        current={flowStep}
        variant={data.channel === "show" ? "show" : data.channel === "flight" ? "flight" : "train"}
      />

      <div className="page-header">
        <div>
          <h1 className="page-title">
            {channelLabel}
            {channelBadge && (
              <span
                className={`badge ${channelBadge.badge} data-source-badge`}
                style={{ marginLeft: 8, fontSize: "0.75rem", fontWeight: 500 }}
                title="当前渠道数据源"
              >
                {channelBadge.labelZh}数据
              </span>
            )}
          </h1>
          <div className="fields-summary" style={{ marginTop: "0.35rem" }}>
            {fields.map((f) => (
              <span key={f.key}>
                <span className="k">{f.label}</span> {f.value}
              </span>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <p className="error" style={{ marginBottom: "1rem" }}>
          {error}
        </p>
      )}

      <TimedGrabPanel
        channel={data.channel}
        notifyOnly={data.notifyOnly}
        busy={busy}
        jobs={data.watchJobs}
        intervalMinutes={intervalMinutes}
        onIntervalChange={setIntervalMinutes}
        startsAtLocal={startsAtLocal}
        onStartsAtChange={setStartsAtLocal}
        endsAtLocal={endsAtLocal}
        onEndsAtChange={setEndsAtLocal}
        autoOrder={autoOrder}
        onAutoOrderChange={setAutoOrder}
        preferredTrains={preferredTrains}
        onPreferredTrainsChange={setPreferredTrains}
        preferredSeats={preferredSeats}
        onPreferredSeatsChange={setPreferredSeats}
        preferredTiers={preferredTiers}
        onPreferredTiersChange={setPreferredTiers}
        watchHint={watchHint}
        travelerOptions={travelers}
        selectedTravelerIds={watchTravelerIds}
        onToggleTraveler={(tid) =>
          setWatchTravelerIds((prev) =>
            prev.includes(tid) ? prev.filter((x) => x !== tid) : [...prev, tid]
          )
        }
        onStart={startWatch}
        onSearch={runSearch}
        onCancel={cancelWatch}
        onPause={pauseWatch}
        onResume={resumeWatch}
        onCreateDraftOrder={createDraftFromWatch}
      />

      <div className="card">
        <h2 className="section-title">
          {data.channel === "train" ? "车次余票" : data.channel === "show" ? "场次 / 票档" : "短名单"}{" "}
          {(() => {
            const mode = shortlist?.mode;
            const liveOk = shortlist?.liveOk;
            const notes = shortlist?.notes ?? "";
            const failReason = (() => {
              const m = notes.match(/实时源暂不可用[：:]\s*(.+?)(?:（|$)/);
              if (m) return m[1]!.trim();
              if (liveOk === false && notes) return notes.slice(0, 80);
              return "";
            })();
            let labelZh = "";
            let badge = "info";
            let title = "数据来源";
            if (liveOk === false) {
              labelZh = "失败";
              badge = "fixture";
              title = failReason || "live failed";
            } else if (mode === "live") {
              labelZh = "实时";
              badge = "live";
              title = shortlist?.provider ?? "live";
            } else if (mode === "fixture" || channelBadge?.badge === "fixture") {
              labelZh = "演示";
              badge = "fixture";
              title = "fixture";
            } else if (channelBadge) {
              labelZh = channelBadge.labelZh;
              badge = channelBadge.badge;
            } else {
              return null;
            }
            return (
              <span className={`badge ${badge} data-source-badge`} title={title}>
                {labelZh === "失败" && failReason
                  ? `失败：${failReason.slice(0, 28)}`
                  : `${labelZh}数据`}
              </span>
            );
          })()}
        </h2>

        {data.channel === "train" && typeof data.fields.date === "string" && (
          <DateStrip
            value={String(data.fields.date)}
            onChange={() => {
              /* date change requires new request — display strip for 12306 feel */
            }}
            className="date-strip-readonly"
          />
        )}
        {data.channel === "train" && (
          <p className="muted" style={{ fontSize: "0.8rem", marginTop: 0 }}>
            日期条对齐 12306 风格（改期请新建查询）。选车次后进入席别 → 乘客 → 提交订单 → 网上支付。
          </p>
        )}

        {!shortlist && (
          <div className="empty" style={{ padding: "2rem 1rem" }}>
            <p className="empty-title">尚未查票</p>
            <p className="empty-desc">点击「立即查票 / 刷新场次」生成可选车次 / 场次 / 航班。</p>
          </div>
        )}
        {shortlist && shortlist.liveOk === false && (
          <p className="info-banner live-fail-banner" role="alert">
            实时源暂不可用：
            {(() => {
              const notes = shortlist.notes ?? "";
              const m = notes.match(/实时源暂不可用[：:]\s*(.+?)(?:（|$)/);
              if (m) return m[1]!.trim();
              return notes || "上游公开接口不可达或未配置。以下为演示数据，非实时库存。";
            })()}{" "}
            STRICT_LIVE=1 时可禁止回退。
          </p>
        )}
        {shortlist?.notes && shortlist.liveOk !== false && (
          <p className="info-banner">{shortlist.notes}</p>
        )}
        {shortlist?.mode === "fixture" && shortlist.liveOk !== false && (
          <p className="info-banner" style={{ background: "#fff7ed" }}>
            当前为演示数据。正式抢票请确认渠道显示「实时数据」。
          </p>
        )}
        {!data.notifyOnly && (
          <p className="order-cta-hint">已启用系统内下单：选中班次后将创建站内订单，支付在官方结账页完成。</p>
        )}
        {data.channel === "train" && (shortlist?.items?.length ?? 0) > 0 ? (
          <TrainResultsTable
            items={shortlist!.items}
            onOrder={openWizard}
            orderLabel="预订"
          />
        ) : data.channel === "show" && (shortlist?.items?.length ?? 0) > 0 ? (
          <ShowResultsList items={shortlist!.items} onOrder={openWizard} />
        ) : (
          shortlist?.items?.map((item) => {
            const extra = tierOrCabin(item, data.channel);
            return (
              <div className="item" key={item.id}>
                <div className="item-row">
                  <div>
                    <div style={{ marginBottom: "0.25rem" }}>
                      <span className="item-title">{item.title}</span>{" "}
                      <span className={`badge ${item.availability}`}>
                        {AVAIL_LABEL[item.availability] ?? item.availability}
                      </span>
                      {extra && (
                        <span className="badge" style={{ marginLeft: 4 }}>
                          {extra}
                        </span>
                      )}
                    </div>
                    {item.subtitle && <div className="muted">{item.subtitle}</div>}
                    {item.price != null && (
                      <div className="price" style={{ marginTop: "0.35rem" }}>
                        {item.currency ?? "CNY"} {item.price}
                      </div>
                    )}
                  </div>
                  <button type="button" onClick={() => openWizard(item)}>
                    在系统内选座下单
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {wizardItem && wizardPhase === "seat" && data.channel === "train" && (
        <div className="card stack train-seat-panel">
          <h2 className="section-title">选座 / 席别</h2>
          <p style={{ margin: 0 }}>
            车次 <strong>{wizardItem.title}</strong>
            {wizardItem.subtitle ? <span className="muted"> · {wizardItem.subtitle}</span> : null}
          </p>
          <div className="seat-chip-row" role="group" aria-label="席别">
            {seatChoices.map((s) => (
              <button
                key={s}
                type="button"
                className={selectedSeat === s ? "seat-chip active" : "seat-chip"}
                onClick={() => setSelectedSeat(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="btn-row">
            <button
              type="button"
              disabled={!selectedSeat}
              onClick={() => setWizardPhase("passengers")}
            >
              下一步：选择乘客
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setWizardItem(null);
                setWizardPhase(null);
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {wizardItem && wizardPhase === "passengers" && (
        <div className="card stack">
          <h2 className="section-title">选择{personLabel}</h2>
          <p style={{ margin: 0 }}>
            已选 <strong>{wizardItem.title}</strong>
            {selectedSeat ? (
              <>
                {" "}
                · {data.channel === "show" ? "票档" : "席别"} <strong>{selectedSeat}</strong>
              </>
            ) : (
              tierOrCabin(wizardItem, data.channel) && <> · {tierOrCabin(wizardItem, data.channel)}</>
            )}
          </p>
          {data.channel === "show" && (
            <div>
              <label>购票平台</label>
              <select
                value={preferredPlatform}
                onChange={(e) => setPreferredPlatform(e.target.value as "damai" | "maoyan")}
              >
                <option value="damai">大麦</option>
                <option value="maoyan">猫眼</option>
              </select>
            </div>
          )}
          {!travelers.length && (
            <p className="error">
              尚无{personLabel}，请先到 <Link href="/travelers">{personLabel}</Link> 添加。
            </p>
          )}
          {travelers.map((t) => (
            <label key={t.id} className="check-row">
              <input
                type="checkbox"
                checked={selectedTravelers.includes(t.id)}
                onChange={() => toggleTraveler(t.id)}
              />
              <span>
                {t.name}
                <span className="meta">
                  {" "}
                  · {t.idNumberHint} · {t.type === "child" ? "儿童" : "成人"}
                </span>
              </span>
            </label>
          ))}
          <div className="btn-row">
            <button
              type="button"
              disabled={!selectedTravelers.length}
              onClick={() => setWizardPhase("confirm")}
            >
              下一步：确认订单
            </button>
            {data.channel === "train" && (
              <button type="button" className="secondary" onClick={() => setWizardPhase("seat")}>
                返回席别
              </button>
            )}
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setWizardItem(null);
                setWizardPhase(null);
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {wizardItem && wizardPhase === "confirm" && (
        <div className="card stack">
          <h2 className="section-title">确认提交订单 · {channelLabel}</h2>
          <div className="order-confirm-summary">
            <div>
              <span className="k">班次/场次</span> {wizardItem.title}
            </div>
            {wizardItem.subtitle && (
              <div>
                <span className="k">详情</span> {wizardItem.subtitle}
              </div>
            )}
            {selectedSeat && (
              <div>
                <span className="k">{data.channel === "show" ? "票档" : "席别"}</span> {selectedSeat}
              </div>
            )}
            <div>
              <span className="k">{personLabel}</span>{" "}
              {travelers
                .filter((t) => selectedTravelers.includes(t.id))
                .map((t) => t.name)
                .join("、")}
            </div>
            {wizardItem.price != null && (
              <div>
                <span className="k">参考价</span> {wizardItem.currency ?? "CNY"} {wizardItem.price}
              </div>
            )}
            <div>
              <span className="k">余票</span>{" "}
              <span className={`badge ${wizardItem.availability}`}>
                {(data.channel === "show" ? SHOW_AVAIL_LABEL : AVAIL_LABEL)[wizardItem.availability] ??
                  wizardItem.availability}
              </span>
            </div>
          </div>
          {waitlistHint && data.channel === "show" && (
            <p className="info-banner" style={{ margin: 0 }}>
              当前票档为售罄 / 候补，确认后将创建候补订单，出票后再支付。
            </p>
          )}
          <p className="muted" style={{ margin: 0 }}>
            确认后创建站内订单并进入结账页（
            {data.channel === "show"
              ? "大麦/猫眼登录与支付手递"
              : data.channel === "flight"
                ? "航司/OTA 登录与支付手递"
                : "12306 登录与网上支付手递"}
            ）。验证码/短信/人脸须本人完成。
          </p>
          <div className="btn-row">
            <button type="button" onClick={confirmOrder} disabled={busy || !selectedTravelers.length}>
              {waitlistHint && data.channel === "show"
                ? "确认候补"
                : data.channel === "show"
                  ? "确认购买 · 系统内协助"
                  : "提交订单"}
            </button>
            <button type="button" className="secondary" onClick={() => setWizardPhase("passengers")}>
              返回{personLabel}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setWizardItem(null);
                setWizardPhase(null);
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="section-title">通知</h2>
        {!data.events.length && (
          <p className="muted" style={{ margin: 0 }}>
            暂无通知。
          </p>
        )}
        <div className="timeline">
          {data.events.map((ev) => (
            <div className="item" key={ev.id}>
              <div>
                <span className="item-title">{ev.title}</span>{" "}
                <span className="badge info">{ev.type}</span>
              </div>
              {ev.body && <div className="muted">{ev.body}</div>}
              <div className="meta" style={{ marginTop: "0.25rem" }}>
                {new Date(ev.createdAt).toLocaleString()}
                {ev.emailed ? " · 已邮件" : ""}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
