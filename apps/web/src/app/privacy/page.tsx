import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "隐私政策 — 抢票",
  description: "TicketGrab 隐私政策（简要）",
};

export default function PrivacyPage() {
  return (
    <div style={{ maxWidth: 640 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">隐私政策</h1>
          <p className="lead">简要说明我们如何处理你的账号与出行信息。最后更新：2026-09。</p>
        </div>
      </div>

      <div className="card stack legal-prose">
        <h2 className="section-title">我们收集什么</h2>
        <ul>
          <li>账号：邮箱、密码哈希、可选昵称。</li>
          <li>乘车人 / 观演人 / 乘机人档案：姓名、证件号（加密存储）、手机号（可选）。</li>
          <li>平台会话：你主动绑定后的会话 Cookie / Token（加密；优先 Vault 引用）。</li>
          <li>查票与订单元数据：行程条件、短名单快照、订单状态与通知。</li>
          <li>技术日志：请求路径、状态码、IP（不记录明文密码、证件号全文、Cookie）。</li>
        </ul>

        <h2 className="section-title">我们如何使用</h2>
        <ul>
          <li>为你提供查票、盯票、站内下单与支付手递。</li>
          <li>在你授权下，使用你的平台会话向官方接口发起辅助请求。</li>
          <li>发送与订单 / 盯票相关的邮件通知（若配置了 SMTP）。</li>
        </ul>

        <h2 className="section-title">存储与安全</h2>
        <ul>
          <li>证件号与会话使用 AES-256-GCM（需配置 ENCRYPTION_KEY）。</li>
          <li>密码仅存 bcrypt 哈希。</li>
          <li>生产环境拒绝使用默认 JWT / 加密密钥启动。</li>
        </ul>

        <h2 className="section-title">第三方</h2>
        <p>
          出票与支付发生在官方平台（12306、大麦/猫眼、航司/OTA 等）。我们不出售你的个人数据；不将明文密码写入数据库。
        </p>

        <h2 className="section-title">你的权利</h2>
        <p>
          可随时删除乘车人、解除平台绑定、注销账号（联系运营或通过支持渠道）。删除后相关加密字段与订单记录按保留策略清理。
        </p>

        <p className="muted">本页为产品级简要说明，正式上线前请由法务审阅并替换为完整文本。</p>
      </div>
    </div>
  );
}
