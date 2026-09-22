"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, getToken } from "@/lib/api";
import { formatShanghaiDateTime, formatFields } from "@/lib/format";

type GrabItem = {
  id: string;
  status: string;
  statusReason?: string | null;
  statusChangedAt?: string | null;
  intervalMinutes: number;
  startsAt?: string | null;
  endsAt?: string | null;
  autoOrder?: boolean;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  preferences?: Record<string, unknown> | null;
  travelerIds?: string[];
  travelers?: { id: string; name: string; idNumberHint?: string; relationship?: string }[];
  repeatableArmed?: boolean;
  dataSourceHint?: { badge: string; labelZh: string; provider: string } | null;
  request: {
    id: string;
    channel: string;
    fields: Record<string, unknown>;
    notifyOnly: boolean;
    createdAt: string;
  };
};

type Quota = {
  maxActive: number;
  activeCount: number;
  remaining: number;
};

const LIVE_STATUSES = new Set([
  "queued",
  "querying",
  "has_tickets",
  "notified",
  "pending",
  "active",
]);

const CHANNEL_LABEL: Record<string, string> = {
  train: "火车",
  show: "演出",
  flight: "机票",
};

const CHANNEL_HINT: Record<string, string> = {
  train: "定时抢票",
  show: "定时抢票 / 开售自动抢",
  flight: "查询/官方跳转演示（实时可售票/票价监控不可用）",
};

function countdown(iso?: string | null): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "即将执行";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}分${sec}秒`;
  return `${sec}秒`;
}

function statusBadgeClass(status: string): string {
  if (status === "paused") return "info";
  if (status === "cancelled" || status === "failed") return "sold_out";
  if (LIVE_STATUSES.has(status)) return "watching";
  return "info";
}

export default function GrabsPage() {
  const router = useRouter();
  const [items, setItems] = useState<GrabItem[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [, setTick] = useState(0);

  const load = useCallback(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    const q = filter === "all" ? "?status=all" : "";
    api<{ items: GrabItem[]; quota?: Quota }>(`/grabs${q}`)
      .then((res) => {
        setItems(res.items ?? []);
        setQuota(res.quota ?? null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  }, [router, filter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  async function cancel(job: GrabItem) {
    setBusy(job.id);
    setError("");
    try {
      await api(`/requests/${job.request.id}/watch/${job.id}/cancel`, {
        method: "POST",
        body: "{}",
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "取消失败");
    } finally {
      setBusy(null);
    }
  }

  async function pause(job: GrabItem) {
    setBusy(job.id);
    setError("");
    try {
      await api(`/requests/${job.request.id}/watch/${job.id}/pause`, {
        method: "POST",
        body: "{}",
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "暂停失败");
    } finally {
      setBusy(null);
    }
  }

  async function resume(job: GrabItem) {
    setBusy(job.id);
    setError("");
    try {
      await api(`/requests/${job.request.id}/watch/${job.id}/resume`, {
        method: "POST",
        body: "{}",
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "恢复失败");
    } finally {
      setBusy(null);
    }
  }

  async function createDraftOrder(job: GrabItem) {
    setBusy(job.id);
    setError("");
    try {
      const res = await api<{
        orderId: string;
        orderPath: string;
        reused?: boolean;
        nextSteps?: string[];
      }>(`/grabs/${job.id}/create-order`, {
        method: "POST",
        body: "{}",
      });
      router.push(res.orderPath || `/orders/${res.orderId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建草稿订单失败");
    } finally {
      setBusy(null);
    }
  }

  const atLimit = quota != null && quota.remaining <= 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">我的定时抢票</h1>
          <p className="lead">
            支持同时管理多条高铁/火车、演出、机票监控任务。暂停/取消只影响当前行，互不串扰。验证码、短信、人脸与支付须本人在官方完成。
          </p>
        </div>
        <div className="btn-row" style={{ gap: "0.5rem" }}>
          <Link href="/requests/new">
            <button type="button" className="btn-query" disabled={atLimit} title={atLimit ? "已达并发上限" : undefined}>
              新建查票
            </button>
          </Link>
        </div>
      </div>

      {quota && (
        <p className="meta" style={{ marginBottom: "0.75rem" }}>
          并发配额 {quota.activeCount}/{quota.maxActive}
          {quota.remaining > 0 ? ` · 还可新建 ${quota.remaining} 条` : " · 已满"}
        </p>
      )}

      {atLimit && (
        <div className="info-banner live-fail-banner" style={{ marginBottom: "1rem" }} role="status">
          已达到同时进行中的定时抢票上限（{quota?.maxActive ?? 10}）。请先暂停并取消部分任务后再新建。
        </div>
      )}

      <div className="chip-row" style={{ marginBottom: "1rem" }} role="group" aria-label="筛选">
        <button
          type="button"
          className={filter === "active" ? "date-chip active" : "date-chip"}
          onClick={() => setFilter("active")}
        >
          进行中
        </button>
        <button
          type="button"
          className={filter === "all" ? "date-chip active" : "date-chip"}
          onClick={() => setFilter("all")}
        >
          全部
        </button>
      </div>

      {error && (
        <p className="error" style={{ marginBottom: "1rem" }}>
          {error}
        </p>
      )}

      {!loaded && !error && <p className="loading">加载中…</p>}

      {loaded && !items.length && !error && (
        <div className="card empty">
          <p className="empty-title">暂无定时抢票</p>
          <p className="empty-desc">在查票需求详情页开启「定时抢票」后，任务会显示在这里。可同时创建多条（火车+演出+机票）。</p>
          <Link href="/requests/new">
            <button type="button" className="btn-query">
              去查票
            </button>
          </Link>
        </div>
      )}

      {items.map((j) => {
        const fields = formatFields(j.request.fields);
        const live = LIVE_STATUSES.has(j.status);
        const paused = j.status === "paused";
        const ch = j.request.channel;
        return (
          <div className={`card grab-list-card channel-${ch}`} key={j.id}>
            <div className="item-row">
              <div>
                <div style={{ marginBottom: "0.35rem", display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
                  <span className={`badge channel-badge channel-badge-${ch}`} title={CHANNEL_HINT[ch] ?? ch}>
                    {CHANNEL_LABEL[ch] ?? ch}
                  </span>
                  <Link href={`/requests/${j.request.id}`} className="item-title">
                    {CHANNEL_HINT[ch] ?? ch}
                  </Link>
                  <span className={`badge ${statusBadgeClass(j.status)}`}>{j.status}</span>
                  {j.dataSourceHint && (
                    <span
                      className={`badge data-source-badge ${j.dataSourceHint.badge === "live" ? "watching" : "info"}`}
                      title={j.dataSourceHint.provider}
                    >
                      {j.dataSourceHint.labelZh}
                    </span>
                  )}
                  {j.autoOrder && <span className="badge limited">自动建单</span>}
                  {typeof j.repeatableArmed === "boolean" && (
                    <span className={`badge ${j.repeatableArmed ? "watching" : "info"}`} title="BullMQ repeatable">
                      {j.repeatableArmed ? "队列已武装" : "队列未武装"}
                    </span>
                  )}
                </div>
                <div className="fields-summary">
                  {fields.map((f) => (
                    <span key={f.key}>
                      <span className="k">{f.label}</span> {f.value}
                    </span>
                  ))}
                </div>
                {(j.travelers?.length || j.travelerIds?.length) ? (
                  <p className="meta" style={{ margin: "0.35rem 0 0" }}>
                    {ch === "show" ? "观演人" : ch === "flight" ? "乘机人" : "乘车人"}{" "}
                    {j.travelers?.length
                      ? j.travelers.map((t) => `${t.name}${t.idNumberHint ? `(${t.idNumberHint})` : ""}`).join("、")
                      : `${j.travelerIds!.length} 人已绑定`}
                  </p>
                ) : null}
                <p className="meta" style={{ margin: "0.5rem 0 0" }}>
                  间隔 {j.intervalMinutes} 分钟
                  {j.startsAt ? ` · 开始 ${formatShanghaiDateTime(j.startsAt)}` : ""}
                  {j.nextRunAt ? ` · 下次 ${countdown(j.nextRunAt)}（${formatShanghaiDateTime(j.nextRunAt)}）` : ""}
                  {j.endsAt ? ` · 至 ${formatShanghaiDateTime(j.endsAt)}` : ""}
                  {j.statusReason ? ` · ${j.statusReason}` : ""}
                </p>
              </div>
              <div className="btn-row" style={{ flexDirection: "column", gap: "0.35rem" }}>
                <Link href={`/requests/${j.request.id}`}>
                  <button type="button" className="secondary">
                    查看
                  </button>
                </Link>
                {(ch === "train" || ch === "show") && (j.travelerIds?.length ?? 0) > 0 && (
                  <button
                    type="button"
                    className="btn-query"
                    disabled={busy === j.id}
                    onClick={() => createDraftOrder(j)}
                    title={
                      ch === "show"
                        ? "使用本任务已绑定的观演人 + 最新短名单创建草稿订单（不提交、不扣款、不谎报已支付）"
                        : "使用本任务已绑定的乘车人 + 最新短名单创建草稿订单（不提交、不扣款）"
                    }
                  >
                    {ch === "show" ? "用已选观演人创建草稿订单" : "用已选乘客创建草稿订单"}
                  </button>
                )}
                {live && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy === j.id}
                    onClick={() => pause(j)}
                  >
                    暂停
                  </button>
                )}
                {paused && (
                  <button
                    type="button"
                    className="btn-query"
                    disabled={busy === j.id}
                    onClick={() => resume(j)}
                  >
                    恢复
                  </button>
                )}
                {(live || paused) && (
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy === j.id}
                    onClick={() => cancel(j)}
                  >
                    取消
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
