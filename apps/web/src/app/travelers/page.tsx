"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getToken } from "@/lib/api";

type Traveler = {
  id: string;
  name: string;
  idType: string;
  idNumberHint?: string;
  phone?: string;
  type: string;
  relationship?: string;
  authorizedConsent?: boolean;
};

const ID_TYPE_LABEL: Record<string, string> = {
  id_card: "身份证",
  passport: "护照",
  other: "其他",
};

export default function TravelersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Traveler[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [relationship, setRelationship] = useState<"self" | "authorized">("self");
  const [consent, setConsent] = useState(false);

  const load = useCallback(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    api<Traveler[]>("/travelers")
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    try {
      await api("/travelers", {
        method: "POST",
        body: JSON.stringify({
          name: fd.get("name"),
          idType: fd.get("idType") || "id_card",
          idNumber: fd.get("idNumber"),
          phone: fd.get("phone") || undefined,
          type: fd.get("type") || "adult",
          relationship,
          authorizedConsent: relationship === "authorized" ? consent : false,
        }),
      });
      (e.target as HTMLFormElement).reset();
      setRelationship("self");
      setConsent(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("删除该乘车人？")) return;
    await api(`/travelers/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">乘车人</h1>
          <p className="lead">
            证件号加密存储，列表仅显示尾号。代购须勾选授权同意。绑定到盯票任务后可多乘客抢票（正式下单仍受门禁限制）。
          </p>
        </div>
      </div>

      {error && <p className="error" style={{ marginBottom: "1rem" }}>{error}</p>}

      <div className="card">
        <h2 className="section-title">新增</h2>
        <form className="stack" onSubmit={onCreate}>
          <div className="row">
            <div>
              <label>姓名</label>
              <input name="name" required placeholder="张三" />
            </div>
            <div>
              <label>类型</label>
              <select name="type" defaultValue="adult">
                <option value="adult">成人</option>
                <option value="child">儿童</option>
              </select>
            </div>
          </div>
          <div className="row">
            <div>
              <label>证件类型</label>
              <select name="idType" defaultValue="id_card">
                <option value="id_card">身份证</option>
                <option value="passport">护照</option>
                <option value="other">其他</option>
              </select>
            </div>
            <div>
              <label>证件号</label>
              <input name="idNumber" required placeholder="18 位身份证（校验位校验）" />
            </div>
          </div>
          <div>
            <label>手机（可选）</label>
            <input name="phone" placeholder="13800138000" />
          </div>
          <div className="row">
            <div>
              <label>与本人关系</label>
              <select
                value={relationship}
                onChange={(e) => {
                  const v = e.target.value as "self" | "authorized";
                  setRelationship(v);
                  if (v === "self") setConsent(false);
                }}
              >
                <option value="self">本人</option>
                <option value="authorized">代购（已获授权）</option>
              </select>
            </div>
          </div>
          {relationship === "authorized" && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                required
              />
              <span>我确认已获得该乘车人授权，仅用于本人协助购票，证件信息加密存储。</span>
            </label>
          )}
          <button type="submit" disabled={busy || (relationship === "authorized" && !consent)}>
            {busy ? "保存中…" : "保存"}
          </button>
        </form>
      </div>

      <div className="card">
        <h2 className="section-title">已保存</h2>
        {!loaded && <p className="loading">加载中…</p>}
        {loaded && !rows.length && (
          <div className="empty" style={{ padding: "2rem 1rem" }}>
            <p className="empty-title">暂无乘车人</p>
            <p className="empty-desc">添加后可在对话建单确认或定时抢票时多选绑定。</p>
          </div>
        )}
        {rows.map((t) => (
          <div className="item" key={t.id}>
            <div className="item-row">
              <div>
                <span className="item-title">{t.name}</span>{" "}
                <span className="badge">{t.type === "child" ? "儿童" : "成人"}</span>
                <span className="badge" style={{ marginLeft: 4 }}>
                  {t.relationship === "authorized" ? "代购" : "本人"}
                </span>
                <div className="meta" style={{ marginTop: "0.25rem" }}>
                  {ID_TYPE_LABEL[t.idType] ?? t.idType} · {t.idNumberHint ?? "****"}
                  {t.phone ? ` · ${t.phone}` : ""}
                </div>
              </div>
              <button type="button" className="ghost" onClick={() => onDelete(t.id)}>
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
