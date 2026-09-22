"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setToken } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    try {
      const res = await api<{ token: string }>("/auth/login", {
        method: "POST",
        auth: false,
        body: JSON.stringify({
          email: fd.get("email"),
          password: fd.get("password"),
        }),
      });
      setToken(res.token);
      const returnUrl = new URLSearchParams(window.location.search).get("returnUrl");
      router.push(returnUrl && returnUrl.startsWith("/") ? returnUrl : "/requests");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card auth-card">
      <h1 className="page-title">账号登录</h1>
      <p className="lead">登录后可盯票、管理出行人与订单。公开查票无需登录。</p>
      <form className="stack" onSubmit={onSubmit}>
        <div>
          <label htmlFor="email">邮箱</label>
          <input
            id="email"
            name="email"
            type="text"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            required
            autoComplete="email"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label htmlFor="password">密码</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="current-password"
          />
        </div>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn-query" disabled={loading} style={{ width: "100%" }}>
          {loading ? "登录中…" : "登录"}
        </button>
      </form>
      <p className="auth-footer">
        还没有账号？ <a href="/register">自助注册</a>
        {" · "}
        <a href="/requests/new">先公开查票</a>
      </p>
    </div>
  );
}
