"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, getToken } from "@/lib/api";

type OrderRow = {
  id: string;
  channel: string;
  status: string;
  amount?: number | null;
  currency?: string;
  externalOrderId?: string | null;
  createdAt: string;
  checkoutPath?: string;
};

const CHANNEL_LABEL: Record<string, string> = {
  train: "火车",
  show: "演出",
  flight: "机票",
};

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "paid" || s.includes("已支付") || s === "ok") return "paid";
  if (s.includes("候补") || s === "waitlist") return "waitlist";
  if (s.includes("fail") || s.includes("失败") || s.includes("取消")) return "danger";
  if (s.includes("awaiting") || s === "draft" || s.includes("待")) return "info";
  return "";
}

export default function OrdersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "train" | "show" | "flight">("all");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    setLoaded(false);
    const q = filter === "all" ? "" : `?channel=${filter}`;
    api<OrderRow[]>(`/orders${q}`)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  }, [router, filter]);

  const counts = useMemo(() => {
    return {
      all: filter === "all" ? rows.length : undefined,
      train: rows.filter((r) => r.channel === "train").length,
      show: rows.filter((r) => r.channel === "show").length,
      flight: rows.filter((r) => r.channel === "flight").length,
    };
  }, [rows, filter]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">订单</h1>
          <p className="lead">查看状态；登录与支付在结账页完成。</p>
        </div>
      </div>

      {error && <p className="error" style={{ marginBottom: "1rem" }}>{error}</p>}

      <div className="filters">
        {(["all", "train", "show", "flight"] as const).map((c) => (
          <button
            key={c}
            type="button"
            className={filter === c ? "" : "secondary"}
            onClick={() => setFilter(c)}
          >
            {c === "all" ? "全部" : CHANNEL_LABEL[c]}
            {c !== "all" && filter === c ? ` ${counts[c]}` : ""}
          </button>
        ))}
      </div>

      {!loaded && !error && <p className="loading">加载中…</p>}

      {loaded && !rows.length && !error && (
        <div className="card empty">
          <p className="empty-title">暂无订单</p>
          <p className="empty-desc">在查票结果中选择条目并下单后，会出现在这里。</p>
          <Link href="/requests">
            <button type="button" className="secondary">
              去查票
            </button>
          </Link>
        </div>
      )}

      {rows.map((o) => (
        <div className="card" key={o.id}>
          <div className="item-row">
            <div>
              <div style={{ marginBottom: "0.35rem" }}>
                <Link href={`/orders/${o.id}`} className="item-title">
                  {CHANNEL_LABEL[o.channel] ?? o.channel}
                </Link>{" "}
                <span className={`badge ${statusClass(o.status)}`}>{o.status}</span>
              </div>
              <p className="meta" style={{ margin: 0 }}>
                {new Date(o.createdAt).toLocaleString()}
                {o.externalOrderId ? ` · ${o.externalOrderId}` : ""}
                {o.amount != null ? ` · ${o.currency ?? "CNY"} ${o.amount}` : ""}
              </p>
            </div>
            <div className="btn-row">
              <Link href={`/checkout/${o.id}`}>
                <button type="button" className="secondary">
                  结账
                </button>
              </Link>
              <Link href={`/orders/${o.id}`}>
                <button type="button">详情</button>
              </Link>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
