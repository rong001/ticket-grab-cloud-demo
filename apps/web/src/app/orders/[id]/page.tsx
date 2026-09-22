"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError, getToken } from "@/lib/api";
import { useDamaiTheme } from "@/components/DamaiTheme";

type EventRow = {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  createdAt: string;
};

type TravelerSummary = {
  id: string;
  name: string;
  idNumberHint?: string | null;
  relationship?: string;
  type?: string;
};

type OrderDetail = {
  id: string;
  channel: string;
  status: string;
  amount?: number | null;
  currency?: string;
  externalOrderId?: string | null;
  errorMessage?: string | null;
  payload?: {
    nextSteps?: string[];
    notes?: string;
    confirmation?: unknown;
    gate?: { code?: string; trainRealSubmit?: boolean };
  };
  travelers?: TravelerSummary[];
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

function relationshipLabel(r?: string): string {
  if (r === "authorized") return "授权代购";
  if (r === "self") return "本人";
  return r || "";
}

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";
  const router = useRouter();
  const [data, setData] = useState<OrderDetail | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [gateOff, setGateOff] = useState<{
    code: string;
    nextSteps: string[];
    message: string;
  } | null>(null);
  useDamaiTheme(data?.channel === "show");

  const load = useCallback(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    api<OrderDetail>(`/orders/${id}`)
      .then((d) => {
        setData(d);
        const gateCode = d.payload?.gate?.code ?? d.errorMessage;
        if (gateCode === "SHOW_AUTO_BUY_UNAVAILABLE" ||
          gateCode === "FLIGHT_INVENTORY_UNAVAILABLE" ||
          gateCode === "FLIGHT_AUTO_BUY_UNAVAILABLE") {
          setGateOff({
            code: "SHOW_AUTO_BUY_UNAVAILABLE",
            nextSteps: d.payload?.nextSteps ?? [],
            message:
              d.payload?.notes ??
              "真实大麦/猫眼下单 API 未接入；未自动购票、未谎报已支付。请用户登录官方完成支付。",
          });
        } else if (
          gateCode === "TRAIN_REAL_SUBMIT_DISABLED" ||
          d.payload?.gate?.trainRealSubmit === false
        ) {
          setGateOff({
            code: "TRAIN_REAL_SUBMIT_DISABLED",
            nextSteps: d.payload?.nextSteps ?? [],
            message:
              d.payload?.notes ??
              "12306 协助提交未开启（TRAIN_REAL_SUBMIT=0），未产生真实占座/扣款。",
          });
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      await api(`/orders/${id}/submit`, { method: "POST", body: "{}" });
      setGateOff(null);
      load();
    } catch (e) {
      if (
        e instanceof ApiError &&
        (e.code === "TRAIN_REAL_SUBMIT_DISABLED" ||
          e.code === "SHOW_AUTO_BUY_UNAVAILABLE" ||
          e.code === "FLIGHT_INVENTORY_UNAVAILABLE" ||
          e.code === "FLIGHT_AUTO_BUY_UNAVAILABLE" ||
          e.status === 403)
      ) {
        setGateOff({
          code: e.code ?? "SUBMIT_GATED",
          nextSteps: e.nextSteps,
          message: e.message,
        });
        setInfo(
          e.code === "SHOW_AUTO_BUY_UNAVAILABLE"
            ? "演出自动购票不可用 — 仅草稿/官方手递，未谎报已支付。详见下方下一步。"
            : e.code === "FLIGHT_INVENTORY_UNAVAILABLE" ||
                e.code === "FLIGHT_AUTO_BUY_UNAVAILABLE"
              ? "机票库存/运价未接入 — 仅草稿/官方手递，未谎报已支付。详见下方下一步。"
              : "协助提交已拒绝（门禁关闭）— 详见下方下一步。订单未标记已支付。"
        );
        load();
      } else {
        setError(e instanceof Error ? e.message : "提交失败");
      }
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

  const displayNextSteps =
    gateOff?.nextSteps?.length ? gateOff.nextSteps : data.payload?.nextSteps ?? [];

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
      {data.errorMessage &&
        data.errorMessage !== "TRAIN_REAL_SUBMIT_DISABLED" &&
        data.errorMessage !== "SHOW_AUTO_BUY_UNAVAILABLE" &&
        data.errorMessage !== "FLIGHT_INVENTORY_UNAVAILABLE" &&
        data.errorMessage !== "FLIGHT_AUTO_BUY_UNAVAILABLE" && (
        <p className="error" style={{ marginBottom: "1rem" }}>{data.errorMessage}</p>
      )}

      {gateOff && (data.channel === "train" || data.channel === "show" || data.channel === "flight") && (
        <div className="card" style={{ borderColor: "var(--danger, #c45)", marginBottom: "1rem" }}>
          <h2 className="section-title">
            {data.channel === "show"
              ? "演出自动购票不可用"
              : data.channel === "flight"
                ? "机票库存/运价未接入"
                : "协助提交未开启"}
          </h2>
          <p className="meta" style={{ marginTop: 0 }}>
            <code>{gateOff.code}</code>
            {data.channel === "show"
              ? " · showAutoBuy=false · 未调用大麦/猫眼自动购票、未谎报已支付"
              : data.channel === "flight"
                ? " · flightInventoryLive=false · 未把时刻表当可售库存、未谎报已支付"
                : " · trainRealSubmit=false · 未调用 12306 占座/扣款"}
          </p>
          <p style={{ marginBottom: "0.75rem" }}>{gateOff.message}</p>
          {!!displayNextSteps.length && (
            <ol className="plain">
              {displayNextSteps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          )}
          <div className="btn-row" style={{ marginTop: "1rem" }}>
            <Link href="/accounts">
              <button type="button">去账号绑定 /accounts</button>
            </Link>
            <Link href="/travelers">
              <button type="button" className="secondary">
                维护{personLabel} /travelers
              </button>
            </Link>
          </div>
        </div>
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
          <Link href="/travelers">
            <button type="button" className="ghost">
              {personLabel}
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
            {data.status === "awaiting_login" ? " · 下一步：完成官方登录/验证码" : ""}
          </p>
        )}
        {!gateOff && data.payload?.notes && (
          <p className="info-banner" style={{ marginTop: "1rem", marginBottom: 0 }}>
            {data.payload.notes}
          </p>
        )}
        {!gateOff && !!displayNextSteps.length && (
          <ol className="plain" style={{ marginTop: "1rem" }}>
            {displayNextSteps.map((s, i) => (
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
              · {t.idNumberHint ?? "****"}
              {t.relationship ? ` · ${relationshipLabel(t.relationship)}` : ""}
              {t.type ? ` · ${t.type === "child" ? "儿童" : "成人"}` : ""}
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
