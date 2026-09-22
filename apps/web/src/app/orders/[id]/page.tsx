"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api, getToken } from "@/lib/api";
import { useDamaiTheme } from "@/components/DamaiTheme";

type EventRow = {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  createdAt: string;
};

type OrderDetail = {
  id: string;
  channel: string;
  status: string;
  amount?: number | null;
  currency?: string;
  externalOrderId?: string | null;
  errorMessage?: string | null;
  payload?: { nextSteps?: string[]; notes?: string; confirmation?: unknown };
  travelers?: { id: string; name: string; idNumberHint?: string; type: string }[];
  timeline?: { at: string; status: string; label: string; body?: string }[];
  session?: { sessionStatus: string; platform: string };
  events?: EventRow[];
  request?: { id: string };
};

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "paid" || s.includes("已支付")) return "paid";
  if (s.includes("候补") || s === "waitlist") return "waitlist";
  if (s.includes("fail") || s.includes("失败")) return "danger";
  if (s.includes("awaiting") || s === "draft") return "info";
  return "";
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<OrderDetail | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  useDamaiTheme(data?.channel === "show");

  const load = useCallback(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    api<OrderDetail>(`/orders/${id}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await api(`/orders/${id}/submit`, { method: "POST", body: "{}" });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  async function paymentHandoff() {
    setBusy(true);
    try {
      await api(`/orders/${id}/payment-handoff`, { method: "POST", body: "{}" });
      router.push(`/checkout/${id}?step=pay`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "失败");
    } finally {
      setBusy(false);
    }
  }

  async function refresh12306() {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const res = await api<{ status: string; refresh?: { notes?: string } }>(
        `/orders/${id}/12306-status`
      );
      setInfo(res.refresh?.notes ?? `状态已刷新：${res.status}`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "刷新失败");
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) return <p className="loading">加载中…</p>;
  if (!data) return <p className="error">{error}</p>;

  const channelLabel =
    data.channel === "train"
      ? "火车票"
      : data.channel === "show"
        ? "演出"
        : data.channel === "flight"
          ? "机票"
          : data.channel;
  const personLabel =
    data.channel === "show" ? "观演人" : data.channel === "flight" ? "乘机人" : "乘车人";

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">订单 · {channelLabel}</h1>
          <p className="meta" style={{ margin: 0 }}>
            <span className={`badge ${statusClass(data.status)}`}>{data.status}</span>
            {data.externalOrderId ? ` · ${data.externalOrderId}` : ""}
            {data.amount != null ? ` · ${data.currency} ${data.amount}` : ""}
          </p>
        </div>
      </div>

      {error && <p className="error" style={{ marginBottom: "1rem" }}>{error}</p>}
      {info && <p className="info-banner">{info}</p>}
      {data.errorMessage && (
        <p className="error" style={{ marginBottom: "1rem" }}>{data.errorMessage}</p>
      )}

      <div className="card">
        <div className="btn-row">
          <button type="button" onClick={submit} disabled={busy}>
            提交订单
          </button>
          <button type="button" className="secondary" onClick={paymentHandoff} disabled={busy}>
            支付手递
          </button>
          <Link href={`/checkout/${id}`}>
            <button type="button" className="secondary">
              打开结账页
            </button>
          </Link>
          {data.channel === "train" && (
            <button type="button" className="secondary" onClick={refresh12306} disabled={busy}>
              刷新 12306 状态
            </button>
          )}
          <Link href="/accounts">
            <button type="button" className="ghost">
              账号绑定
            </button>
          </Link>
          {data.request?.id && (
            <Link href={`/requests/${data.request.id}`}>
              <button type="button" className="ghost">
                查票详情
              </button>
            </Link>
          )}
        </div>
        {data.session && (
          <p className="meta" style={{ margin: "1rem 0 0" }}>
            平台会话 · {data.session.platform} · {data.session.sessionStatus}
          </p>
        )}
        {data.payload?.notes && (
          <p className="info-banner" style={{ marginTop: "1rem", marginBottom: 0 }}>
            {data.payload.notes}
          </p>
        )}
        {!!data.payload?.nextSteps?.length && (
          <ol className="plain" style={{ marginTop: "1rem" }}>
            {data.payload.nextSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        )}
      </div>

      <div className="card">
        <h2 className="section-title">{personLabel}</h2>
        {!data.travelers?.length && <p className="muted" style={{ margin: 0 }}>无</p>}
        {data.travelers?.map((t) => (
          <div className="item" key={t.id}>
            <span className="item-title">{t.name}</span>
            <span className="meta">
              {" "}
              · {t.idNumberHint} · {t.type === "child" ? "儿童" : "成人"}
            </span>
          </div>
        ))}
      </div>

      <div className="card">
        <h2 className="section-title">状态时间线</h2>
        {!data.timeline?.length && <p className="muted" style={{ margin: 0 }}>暂无事件。</p>}
        <div className="timeline">
          {data.timeline?.map((ev, i) => (
            <div className="item" key={i}>
              <div>
                <span className="item-title">{ev.label}</span>{" "}
                <span className={`badge ${statusClass(ev.status)}`}>{ev.status}</span>
              </div>
              {ev.body && <div className="muted">{ev.body}</div>}
              <div className="meta" style={{ marginTop: "0.25rem" }}>
                {new Date(ev.at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 className="section-title">通知</h2>
        {!data.events?.length && <p className="muted" style={{ margin: 0 }}>暂无通知。</p>}
        <div className="timeline">
          {data.events?.map((ev) => (
            <div className="item" key={ev.id}>
              <div>
                <span className="item-title">{ev.title}</span>{" "}
                <span className="badge info">{ev.type}</span>
              </div>
              {ev.body && <div className="muted">{ev.body}</div>}
              <div className="meta" style={{ marginTop: "0.25rem" }}>
                {new Date(ev.createdAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
