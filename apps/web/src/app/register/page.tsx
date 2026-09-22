"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setToken } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get("password") ?? "");
    const confirm = String(fd.get("confirm") ?? "");
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      setLoading(false);
      return;
    }
    try {
      const res = await api<{ token: string }>("/auth/register", {
        method: "POST",
        auth: false,
        body: JSON.stringify({
          email: fd.get("email"),
          password,
          name: fd.get("name") || undefined,
        }),
      });
      setToken(res.token);
      const returnUrl = new URLSearchParams(window.location.search).get("returnUrl");
      router.push(returnUrl && returnUrl.startsWith("/") ? returnUrl : "/requests/new");
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card auth-card">
      <h1 className="page-title">注册账号</h1>
      <p className="lead">注册后可盯票、保存出行人并协助跳转官方下单。公开查票无需注册。</p>
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
          <label htmlFor="name">昵称（可选）</label>
          <input id="name" name="name" type="text" autoComplete="nickname" placeholder="怎么称呼你" />
        </div>
        <div>
          <label htmlFor="password">密码</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        <div>
          <label htmlFor="confirm">确认密码</label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn-query" disabled={loading} style={{ width: "100%" }}>
          {loading ? "注册中…" : "注册"}
        </button>
      </form>
      <p className="auth-footer">
        已有账号？ <a href="/login">去登录</a>
      </p>
    </div>
  );
}
