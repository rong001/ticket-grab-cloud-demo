"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getToken, setToken } from "@/lib/api";

type Me = { user: { id: string; email: string; name?: string | null; role?: string } };

export function AuthNav() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setEmail(null);
      setRole(null);
      setReady(true);
      return;
    }
    api<Me>("/auth/me")
      .then((d) => {
        setEmail(d.user.email);
        setRole(d.user.role ?? "user");
      })
      .catch(() => {
        setToken(null);
        setEmail(null);
        setRole(null);
      })
      .finally(() => setReady(true));

    api<{ unread: number }>("/meta/notifications/summary")
      .then((d) => setUnread(d.unread ?? 0))
      .catch(() => setUnread(0));
  }, []);

  async function logout() {
    try {
      await api("/auth/logout", { method: "POST", body: "{}" });
    } catch {
      /* ignore */
    }
    setToken(null);
    setEmail(null);
    setRole(null);
    router.push("/login");
  }

  if (!ready) {
    return (
      <div className="nav-user">
        <span className="muted">…</span>
      </div>
    );
  }

  if (email) {
    return (
      <div className="nav-user">
        {role === "admin" && (
          <a href="/admin" title="管理">
            管理
          </a>
        )}
        <a href="/requests" title="通知">
          通知
          {unread > 0 && <span className="nav-badge">{unread > 99 ? "99+" : unread}</span>}
        </a>
        <span className="meta" title={email}>
          {email}
        </span>
        <button type="button" className="ghost" onClick={logout}>
          退出
        </button>
      </div>
    );
  }

  return (
    <div className="nav-user">
      <a href="/login">登录</a>
    </div>
  );
}
