"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, getToken } from "@/lib/api";
import { formatFields } from "@/lib/format";
import { useRouter } from "next/navigation";

type RequestRow = {
  id: string;
  channel: string;
  fields: Record<string, unknown>;
  createdAt: string;
  shortlists?: { id: string }[];
  watchJobs?: { id: string; status: string; intervalMinutes?: number; nextRunAt?: string | null; autoOrder?: boolean }[];
};

const CHANNEL_LABEL: Record<string, string> = {
  train: "火车",
  show: "演出",
  flight: "机票",
};

export default function RequestsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<"all" | "grabs">("all");

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    api<RequestRow[]>("/requests")
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  }, [router]);

  const grabRows = useMemo(
    () =>
      rows.filter((r) =>
        (r.watchJobs ?? []).some((w) => w.status === "active" || w.status === "pending")
      ),
    [rows]
  );

  const visible = tab === "grabs" ? grabRows : rows;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">车票 / 演出</h1>
          <p className="lead">查票请求与定时抢票任务。点击「查询」开始新的预订。</p>
        </div>
        <div className="btn-row" style={{ gap: "0.5rem" }}>
          <Link href="/grabs">
            <button type="button" className="secondary">
              我的定时抢票
            </button>
          </Link>
          <Link href="/requests/new">
            <button type="button" className="btn-query">
              查询
            </button>
          </Link>
        </div>
      </div>

      <div className="chip-row" style={{ marginBottom: "1rem" }} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "all"}
          className={tab === "all" ? "date-chip active" : "date-chip"}
          onClick={() => setTab("all")}
        >
          全部需求
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "grabs"}
          className={tab === "grabs" ? "date-chip active" : "date-chip"}
          onClick={() => setTab("grabs")}
        >
          我的定时抢票 ({grabRows.length})
        </button>
      </div>

      {error && (
        <p className="error" style={{ marginBottom: "1rem" }}>
          {error}
        </p>
      )}

      {!loaded && !error && <p className="loading">加载中…</p>}

      {loaded && !visible.length && !error && (
        <div className="card empty">
          <p className="empty-title">{tab === "grabs" ? "还没有定时抢票" : "还没有查票"}</p>
          <p className="empty-desc">
            {tab === "grabs"
              ? "在需求详情开启「定时抢票」后会出现在这里。"
              : "新建一次查票，生成短名单并可选定时抢票。"}
          </p>
          <Link href="/requests/new">
            <button type="button" className="btn-query">
              查询
            </button>
          </Link>
        </div>
      )}

      {visible.map((r) => {
        const fields = formatFields(r.fields);
        const watches = (r.watchJobs ?? []).filter(
          (w) => w.status === "active" || w.status === "pending"
        );
        const watch = watches[0];
        return (
          <div className="card" key={r.id}>
            <div className="item-row">
              <div>
                <div style={{ marginBottom: "0.35rem" }}>
                  <Link href={`/requests/${r.id}`} className="item-title">
                    {CHANNEL_LABEL[r.channel] ?? r.channel}
                  </Link>{" "}
                  {watch && (
                    <span
                      className={`badge ${
                        watch.status === "active" || watch.status === "pending" ? "watching" : "info"
                      }`}
                    >
                      定时抢票 {watch.status}
                      {watch.autoOrder ? " · 自动建单" : ""}
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
                <p className="meta" style={{ margin: "0.5rem 0 0" }}>
                  {new Date(r.createdAt).toLocaleString()} · 短名单 {r.shortlists?.length ?? 0}
                  {watch?.nextRunAt
                    ? ` · 下次抢票 ${new Date(watch.nextRunAt).toLocaleString()}`
                    : ""}
                </p>
              </div>
              <Link href={`/requests/${r.id}`}>
                <button type="button" className="secondary">
                  查看
                </button>
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
