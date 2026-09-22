"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, getToken } from "@/lib/api";

type TravelerOpt = {
  id: string;
  name: string;
  idNumberHint?: string;
  relationship?: string;
};

type HistoryItem = { role: "user" | "assistant"; text: string };
type ConfirmLine = { label: string; value: string };
type Confirmation = {
  channel: string;
  channelLabel: string;
  lines: ConfirmLine[];
  capabilityNote: string;
};

type TurnResponse = {
  sessionId: string;
  reply: string;
  missing: string | null;
  readyForConfirm: boolean;
  confirmation: Confirmation | null;
  fields: Record<string, unknown>;
  history: HistoryItem[];
  note?: string;
};

export default function IntakePage() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([
    {
      role: "assistant",
      text: "您好，我是票务助手。请用一句话描述需求，或告诉我要「火车 / 演出 / 机票」。确认前不会创建任何盯票任务。",
    },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [created, setCreated] = useState<{ requestId: string; watchJobId: string } | null>(null);
  const [travelers, setTravelers] = useState<TravelerOpt[]>([]);
  const [selectedTravelerIds, setSelectedTravelerIds] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadTravelers = useCallback(() => {
    if (!getToken()) return;
    api<TravelerOpt[]>("/travelers")
      .then(setTravelers)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (ready && confirmation) loadTravelers();
  }, [ready, confirmation, loadTravelers]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, confirmation, created]);

  async function sendTurn(message: string) {
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    setHistory((h) => [...h, { role: "user", text }]);
    setInput("");
    try {
      const res = await api<TurnResponse>("/intake/turn", {
        method: "POST",
        body: JSON.stringify({ sessionId, message: text }),
        auth: false,
      });
      setSessionId(res.sessionId);
      setHistory(res.history?.length ? res.history : (h) => [...h, { role: "assistant", text: res.reply }]);
      setReady(!!res.readyForConfirm);
      setConfirmation(res.confirmation);
    } catch (e) {
      setError(e instanceof Error ? e.message : "发送失败");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!sessionId || !confirmation) return;
    if (!getToken()) {
      router.push(`/login?next=/intake`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await api<{
        request: { id: string };
        watchJob: { id: string };
        message?: string;
      }>("/intake/confirm", {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          confirmed: true,
          ...(selectedTravelerIds.length ? { travelerIds: selectedTravelerIds } : {}),
        }),
      });
      setCreated({ requestId: res.request.id, watchJobId: res.watchJob.id });
      setReady(false);
      setHistory((h) => [
        ...h,
        {
          role: "assistant",
          text: res.message ?? "盯票任务已创建（仅监控+通知，不含未授权自动购票）。",
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "确认失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack intake-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">对话建单</h1>
          <p className="lead">
            中文对话收集火车 / 演出 / 机票需求。系统会逐项追问缺失字段，展示确认卡后，只有您点击确认才会创建盯票任务。
          </p>
        </div>
      </div>

      <div className="info-banner">
        能力边界：查询 · 监控通知 · 官方跳转。未获官方授权时，不提供也不宣传无人值守自动购票。
      </div>

      <div className="intake-chat" role="log" aria-live="polite">
        {history.map((m, i) => (
          <div key={i} className={`intake-bubble ${m.role}`}>
            <div className="intake-bubble-role">{m.role === "user" ? "我" : "助手"}</div>
            <div className="intake-bubble-text">{m.text}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {confirmation && ready && !created && (
        <div className="intake-confirm-card">
          <h2 className="section-title">请确认需求</h2>
          <p className="meta">类型：{confirmation.channelLabel}</p>
          <div className="order-confirm-summary">
            {confirmation.lines.map((l) => (
              <div key={l.label}>
                <span className="k">{l.label}</span>
                {l.value}
              </div>
            ))}
          </div>
          <p className="meta" style={{ marginTop: "0.75rem" }}>
            {confirmation.capabilityNote}
          </p>
          <div style={{ marginTop: "0.75rem" }}>
            <label>绑定乘车人 / 观演人（可选）</label>
            {!getToken() ? (
              <p className="muted">登录后可选择已保存人员</p>
            ) : !travelers.length ? (
              <p className="muted">
                暂无已保存 — <Link href="/travelers">去添加</Link>
              </p>
            ) : (
              <div className="chip-row" style={{ flexWrap: "wrap", marginTop: "0.35rem" }}>
                {travelers.map((t) => {
                  const on = selectedTravelerIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={on ? "date-chip active" : "date-chip"}
                      onClick={() =>
                        setSelectedTravelerIds((prev) =>
                          prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id]
                        )
                      }
                    >
                      {t.name}
                      {t.idNumberHint ? ` · ${t.idNumberHint}` : ""}
                      {t.relationship === "authorized" ? " · 代购" : ""}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="hero-actions" style={{ marginTop: "1rem" }}>
            <button type="button" className="btn-query" disabled={busy} onClick={confirm}>
              确认创建盯票
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setReady(false);
                setConfirmation(null);
                void sendTurn("我要修改");
              }}
            >
              继续修改
            </button>
          </div>
        </div>
      )}

      {created && (
        <div className="info-banner" style={{ background: "#eef8f0", borderColor: "#bbf7d0" }}>
          已创建请求 <code>{created.requestId}</code> · 盯票任务 <code>{created.watchJobId}</code>
          {" · "}
          <Link href={`/requests/${created.requestId}`}>查看详情</Link>
          {" · "}
          <Link href="/grabs">我的定时盯票</Link>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {!created && (
        <form
          className="intake-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void sendTurn(input);
          }}
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="例如：明天北京南到上海虹桥高铁，二等座 2 人，现在开始盯票"
            disabled={busy}
            aria-label="对话输入"
          />
          <button type="submit" className="btn-query" disabled={busy || !input.trim()}>
            发送
          </button>
        </form>
      )}

      <p className="meta">
        也可使用表单查票：<Link href="/requests/new">公开查票</Link>
        {" · "}
        <Link href="/capabilities">能力说明</Link>
      </p>
    </div>
  );
}
