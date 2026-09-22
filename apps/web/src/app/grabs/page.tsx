"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, getToken } from "@/lib/api";
import { formatFields } from "@/lib/format";

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
  request: {
    id: string;
    channel: string;
    fields: Record<string, unknown>;
    notifyOnly: boolean;
    createdAt: string;
  };
};

const LIVE_STATUSES = new Set(["queued", "querying", "has_tickets", "notified", "pending", "active"]);

const CHANNEL_LABEL: Record<string, string> = {
  train: "火车 · 定时抢票",
  show: "演出 · 定时抢票/开售自动抢",
  flight: "机票 · 定时盯票",
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

export default function GrabsPage() {
  const router = useRouter();
  const [items, setItems] = useState<GrabItem[]>([]);
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
    api<{ items: GrabItem[] }>(`/grabs${q}`)
      .then((res) => setItems(res.items ?? []))
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">我的定时抢票</h1>
          <p className="lead">
            跨渠道的定时监控任务。有票/开售时通知；可选协助创建待登录订单。验证码、短信、人脸与支付须本人在官方完成。
          </p>
        </div>
        <div className="btn-row" style={{ gap: "0.5rem" }}>
          <Link href="/requests/new">
            <button type="button" className="btn-query">
              新建查票
            </button>
          </Link>
        </div>
      </div>

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
          <p className="empty-desc">在查票需求详情页开启「定时抢票」后，任务会显示在这里。</p>
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
        return (
          <div className={`card grab-list-card channel-${j.request.channel}`} key={j.id}>
            <div className="item-row">
              <div>
                <div style={{ marginBottom: "0.35rem" }}>
                  <Link href={`/requests/${j.request.id}`} className="item-title">
                    {CHANNEL_LABEL[j.request.channel] ?? j.request.channel}
                  </Link>{" "}
                  <span className={`badge ${live ? "watching" : "info"}`}>{j.status}</span>
                  {j.autoOrder && <span className="badge limited">自动建单</span>}
                </div>
                <div className="fields-summary">
                  {fields.map((f) => (
                    <span key={f.key}>
                      <span className="k">{f.label}</span> {f.value}
                    </span>
                  ))}
                </div>
                <p className="meta" style={{ margin: "0.5rem 0 0" }}>
                  间隔 {j.intervalMinutes} 分钟
                  {j.startsAt ? ` · 开始 ${new Date(j.startsAt).toLocaleString()}` : ""}
                  {j.nextRunAt ? ` · 下次 ${countdown(j.nextRunAt)}（${new Date(j.nextRunAt).toLocaleString()}）` : ""}
                  {j.endsAt ? ` · 至 ${new Date(j.endsAt).toLocaleString()}` : ""}
                  {j.statusReason ? ` · ${j.statusReason}` : ""}
                </p>
              </div>
              <div className="btn-row" style={{ flexDirection: "column", gap: "0.35rem" }}>
                <Link href={`/requests/${j.request.id}`}>
                  <button type="button" className="secondary">
                    查看
                  </button>
                </Link>
                {live && (
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
