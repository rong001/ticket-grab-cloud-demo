import type { Metadata } from "next";
import "./globals.css";
import { AuthNav } from "@/components/AuthNav";

export const metadata: Metadata = {
  title: "抢票 — 查票 · 盯票 · 下单",
  description: "为出行与演出准备的轻量助手：查票、盯票、站内下单与支付手递。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <nav className="nav" aria-label="主导航">
          <a className="brand" href="/">
            抢票
          </a>
          <div className="nav-links">
            <a href="/requests">查票</a>
            <a href="/requests/new">新建</a>
            <a href="/orders">订单</a>
            <a href="/travelers">出行人</a>
            <a href="/accounts">账号</a>
          </div>
          <AuthNav />
        </nav>
        <main className="container">{children}</main>
        <footer className="site-footer">
          <span>合法辅助 · 非黄牛</span>
          <span className="footer-links">
            <a href="/privacy">隐私政策</a>
            <a href="/terms">用户协议</a>
          </span>
        </footer>
      </body>
    </html>
  );
}
