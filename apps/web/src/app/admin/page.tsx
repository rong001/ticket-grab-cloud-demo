"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getToken } from "@/lib/api";
import SearchableSelect from "@/components/SearchableSelect";
import type { SelectOption } from "@/lib/options/catalog";

type AdminUser = {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  active: boolean;
  createdAt: string;
  lastLoginAt?: string | null;
  requestCount?: number;
  orderCount?: number;
};

type Activity = {
  id: string;
  userId: string;
  userEmail: string;
  action: string;
  summary: string;
  createdAt: string;
};

type Me = { user: { id: string; email: string; role?: string } };
type ScopeMode = "local" | "global";

function fmtTime(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}

export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState("");
  const [scopeMode, setScopeMode] = useState<ScopeMode>("global");
  const [scopeUserId, setScopeUserId] = useState<string | null>(null);
  const [scopeEmail, setScopeEmail] = useState("");
  const sinceRef = useRef<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const scopeModeRef = useRef<ScopeMode>(scopeMode);
  const scopeUserIdRef = useRef<string | null>(scopeUserId);

  useEffect(() => {
    scopeModeRef.current = scopeMode;
  }, [scopeMode]);
  useEffect(() => {
    scopeUserIdRef.current = scopeUserId;
  }, [scopeUserId]);

  const userOptions: SelectOption[] = useMemo(
    () =>
      users.map((u) => ({
        value: u.email,
        label: u.name ? `${u.email} · ${u.name}` : u.email,
        category: u.role === "admin" ? "管理员" : "用户",
      })),
    [users]
  );

  const scopeUser = useMemo(
    () => users.find((u) => u.id === scopeUserId) ?? null,
    [users, scopeUserId]
  );

  const ensureAdmin = useCallback(async () => {
    if (!getToken()) {
      router.push("/login");
      return false;
    }
    try {
      const me = await api<Me>("/auth/me");
      if (me.user.role !== "admin") {
        router.push("/requests");
        return false;
      }
      return true;
    } catch {
      router.push("/login");
      return false;
    }
  }, [router]);

  const loadUsers = useCallback(async () => {
    const data = await api<{ users: AdminUser[] }>("/admin/users");
    setUsers(data.users);
  }, []);

  const resetFeed = useCallback(() => {
    sinceRef.current = null;
    setActivities([]);
  }, []);

  const enterLocalForUser = useCallback(
    (u: AdminUser) => {
      setScopeMode("local");
      setScopeUserId(u.id);
      setScopeEmail(u.email);
      resetFeed();
    },
    [resetFeed]
  );

  const switchScope = useCallback(
    (mode: ScopeMode) => {
      if (mode === scopeMode) return;
      setScopeMode(mode);
      resetFeed();
      if (mode === "global") {
        // keep last selected user for convenience when switching back
      }
    },
    [scopeMode, resetFeed]
  );

  const onPickScopeEmail = useCallback(
    (email: string) => {
      setScopeEmail(email);
      const u = users.find((x) => x.email === email);
      if (u) {
        if (u.id !== scopeUserId) {
          setScopeUserId(u.id);
          setScopeMode("local");
          resetFeed();
        }
      } else if (!email.trim()) {
        if (scopeUserId) {
          setScopeUserId(null);
          resetFeed();
        }
      }
      // partial typing: keep last scopeUserId until an exact email is chosen
    },
    [users, resetFeed, scopeUserId]
  );

  const pollActivity = useCallback(async () => {
    const mode = scopeModeRef.current;
    const uid = scopeUserIdRef.current;
    if (mode === "local" && !uid) return;

    const q = new URLSearchParams();
    q.set("limit", "40");
    if (sinceRef.current) q.set("since", sinceRef.current);
    if (mode === "local" && uid) q.set("userId", uid);

    const data = await api<{ activities: Activity[] }>(`/admin/activity?${q}`);
    if (!data.activities.length) return;
    setActivities((prev) => {
      const seen = new Set(prev.map((a) => a.id));
      const fresh = data.activities.filter((a) => !seen.has(a.id));
      if (!fresh.length && prev.length) return prev;
      const merged = sinceRef.current ? [...fresh, ...prev] : data.activities;
      const byId = new Map<string, Activity>();
      for (const a of merged) byId.set(a.id, a);
      return Array.from(byId.values())
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
        .slice(0, 80);
    });
    const newest = data.activities[0]?.createdAt;
    if (newest) {
      const cur = sinceRef.current ? +new Date(sinceRef.current) : 0;
      if (+new Date(newest) > cur) sinceRef.current = newest;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await ensureAdmin();
      if (!ok || cancelled) return;
      try {
        await loadUsers();
        await pollActivity();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ensureAdmin, loadUsers, pollActivity]);

  // Re-fetch when scope changes (after reset)
  useEffect(() => {
    if (!ready) return;
    pollActivity().catch(() => {});
  }, [ready, scopeMode, scopeUserId, pollActivity]);

  useEffect(() => {
    const t = setInterval(() => {
      pollActivity().catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [pollActivity]);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    try {
      await api("/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: fd.get("email"),
          password: fd.get("password"),
          name: fd.get("name") || undefined,
          role: fd.get("role") || "user",
        }),
      });
      (e.target as HTMLFormElement).reset();
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(u: AdminUser) {
    setError("");
    try {
      await api(`/admin/users/${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !u.active }),
      });
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新失败");
    }
  }

  async function submitReset(id: string) {
    if (resetPw.length < 8) {
      setError("密码至少 8 位");
      return;
    }
    setError("");
    try {
      await api(`/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ password: resetPw }),
      });
      setResetId(null);
      setResetPw("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "重置失败");
    }
  }

  if (!ready) {
    return <p className="loading">加载中…</p>;
  }

  const localNeedsUser = scopeMode === "local" && !scopeUserId;

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">管理</h1>
          <p className="lead">账号开通、启停与实时操作流水。</p>
        </div>
      </div>

      {error && (
        <p className="error" style={{ marginBottom: "1rem" }}>
          {error}
        </p>
      )}

      <div className="admin-grid">
        <div className="stack" style={{ gap: "1.25rem" }}>
          <div className="card">
            <h2 className="section-title">开通账号</h2>
            <form className="stack" onSubmit={onCreate}>
              <div className="row">
                <div>
                  <label htmlFor="admin-email">邮箱</label>
                  <input id="admin-email" name="email" type="text" inputMode="email" autoCapitalize="none" autoCorrect="off" required placeholder="user@example.com" />
                </div>
                <div>
                  <label htmlFor="admin-name">姓名（可选）</label>
                  <input id="admin-name" name="name" placeholder="称呼" />
                </div>
              </div>
              <div className="row">
                <div>
                  <label htmlFor="admin-password">初始密码</label>
                  <input
                    id="admin-password"
                    name="password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    placeholder="至少 8 位"
                  />
                </div>
                <div>
                  <label htmlFor="admin-role">角色</label>
                  <select id="admin-role" name="role" defaultValue="user">
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </div>
              </div>
              <button type="submit" disabled={busy}>
                {busy ? "创建中…" : "创建用户"}
              </button>
            </form>
          </div>

          <div className="card">
            <h2 className="section-title">账号列表</h2>
            <p className="meta" style={{ marginBottom: "0.75rem" }}>
              点击行可切入「局部」查看该账号实时操作
            </p>
            {!users.length && (
              <div className="empty" style={{ padding: "1.5rem 0.5rem" }}>
                <p className="empty-title">暂无用户</p>
              </div>
            )}
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>邮箱</th>
                    <th>姓名</th>
                    <th>角色</th>
                    <th>状态</th>
                    <th>最近登录</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const selected = scopeMode === "local" && scopeUserId === u.id;
                    return (
                      <tr
                        key={u.id}
                        className={selected ? "admin-row-selected" : "admin-row-clickable"}
                        onClick={(e) => {
                          const t = e.target as HTMLElement;
                          if (t.closest("button, input, a")) return;
                          enterLocalForUser(u);
                        }}
                        title="点击查看该账号局部操作"
                      >
                        <td>
                          <div className="item-title" style={{ fontSize: "0.875rem" }}>
                            {u.email}
                          </div>
                          <div className="meta">
                            查票 {u.requestCount ?? 0} · 订单 {u.orderCount ?? 0}
                          </div>
                        </td>
                        <td>{u.name || "—"}</td>
                        <td>
                          <span className={`badge ${u.role === "admin" ? "info" : ""}`}>{u.role}</span>
                        </td>
                        <td>
                          <span className={`badge ${u.active ? "ok" : "danger"}`}>
                            {u.active ? "启用" : "停用"}
                          </span>
                        </td>
                        <td className="meta">{fmtTime(u.lastLoginAt)}</td>
                        <td>
                          <div className="admin-actions">
                            <button
                              type="button"
                              className="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                enterLocalForUser(u);
                              }}
                            >
                              局部
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleActive(u);
                              }}
                            >
                              {u.active ? "停用" : "启用"}
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                setResetId(u.id);
                                setResetPw("");
                              }}
                            >
                              重置密码
                            </button>
                          </div>
                          {resetId === u.id && (
                            <div className="stack" style={{ marginTop: "0.5rem", gap: "0.35rem" }}>
                              <input
                                type="password"
                                placeholder="新密码 ≥8"
                                value={resetPw}
                                minLength={8}
                                onChange={(e) => setResetPw(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <div className="admin-actions">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    submitReset(u.id);
                                  }}
                                >
                                  确认
                                </button>
                                <button
                                  type="button"
                                  className="ghost"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setResetId(null);
                                  }}
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card activity-panel">
          <div className="activity-panel-header">
            <h2 className="section-title" style={{ marginBottom: 0 }}>
              实时操作
            </h2>
            <div
              className="seg-control"
              role="tablist"
              aria-label="操作范围"
            >
              <button
                type="button"
                role="tab"
                aria-selected={scopeMode === "local"}
                className={scopeMode === "local" ? "seg-item is-active" : "seg-item"}
                onClick={() => switchScope("local")}
              >
                局部
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={scopeMode === "global"}
                className={scopeMode === "global" ? "seg-item is-active" : "seg-item"}
                onClick={() => switchScope("global")}
              >
                全局
              </button>
            </div>
          </div>

          {scopeMode === "local" && (
            <div className="activity-scope-pick" style={{ marginTop: "0.75rem" }}>
              <SearchableSelect
                label="选择账号"
                value={scopeEmail}
                onChange={onPickScopeEmail}
                options={userOptions}
                placeholder="搜索邮箱 / 姓名"
                showCategoryChips={false}
              />
            </div>
          )}

          <p className="meta" style={{ margin: "0.75rem 0" }}>
            {scopeMode === "global"
              ? "全局 · 全部账号 · 每 3 秒轮询"
              : scopeUser
                ? `局部 · ${scopeUser.email} · 每 3 秒轮询`
                : "局部 · 请先选择账号"}
          </p>

          <div className="activity-feed" ref={feedRef}>
            {localNeedsUser && (
              <div className="empty" style={{ padding: "1.5rem 0.5rem" }}>
                <p className="empty-title">请选择账号</p>
                <p className="empty-desc">
                  在上方搜索选择，或点击左侧账号列表中的一行进入局部。
                </p>
              </div>
            )}
            {!localNeedsUser && !activities.length && (
              <p className="loading">暂无操作记录</p>
            )}
            {!localNeedsUser &&
              activities.map((a) => (
                <div className="activity-item" key={a.id}>
                  <div className="meta">{fmtTime(a.createdAt)}</div>
                  <div>
                    <span className="item-title" style={{ fontSize: "0.875rem" }}>
                      {a.userEmail}
                    </span>{" "}
                    <span className="badge">{a.action}</span>
                  </div>
                  <div className="meta">{a.summary}</div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
