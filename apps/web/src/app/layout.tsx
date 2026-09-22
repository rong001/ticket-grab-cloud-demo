import type { Metadata } from "next";
import "./globals.css";
import { AuthNav } from "@/components/AuthNav";
import { DamaiBrandSync } from "@/components/DamaiTheme";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "票务助手 — 公开查票 · 盯票提醒",
  description:
    "独立票务助手：公开查余票/场次、登录后盯票。支付跳转官方平台。非铁路 12306 / 大麦授权代售网站。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <DamaiBrandSync />
        <div className="top-util">
          <div className="top-util-inner">
            <span>独立助手 · 非官方代售 · 支付走官方 · 已启用 HTTPS</span>
            <span>
              <a href="/capabilities">能力说明</a>
              <a href="/privacy">隐私政策</a>
              <a href="/terms">用户协议</a>
            </span>
          </div>
        </div>
        <header className="site-header" role="banner">
          <div className="header-inner nav" aria-label="主导航">
            <a className="brand" href="/">
              票务助手
              <span className="brand-sub">公开查票 · 非官方</span>
            </a>
            <nav className="nav-links">
              <a href="/">首页</a>
              <a href="/intake">对话建单</a>
              <a href="/requests/new">查票</a>
              <a href="/requests">我的需求</a>
              <a href="/grabs">定时盯票</a>
              <a href="/orders">订单</a>
              <a href="/travelers">出行人</a>
              <a href="/accounts">账号</a>
              <a href="/capabilities">能力</a>
            </nav>
            <AuthNav />
          </div>
        </header>
        <main className="container">{children}</main>
        <footer className="site-footer">
          <span>
            独立票务助手 · 布局配色仅供参考，与 12306 / 大麦无隶属或授权代售关系 · 本环境已通过 HTTPS 提供服务
          </span>
          <span className="footer-links">
            <a href="/capabilities">能力说明</a>
            <a href="/privacy">隐私政策</a>
            <a href="/terms">用户协议</a>
          </span>
        </footer>
      </body>
    </html>
  );
}
