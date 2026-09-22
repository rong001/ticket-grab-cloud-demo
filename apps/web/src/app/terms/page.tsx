import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "用户协议 — 抢票",
  description: "TicketGrab 用户服务协议（简要）",
};

export default function TermsPage() {
  return (
    <div style={{ maxWidth: 640 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">用户协议</h1>
          <p className="lead">使用本服务即表示你同意以下简要条款。最后更新：2026-09。</p>
        </div>
      </div>

      <div className="card stack legal-prose">
        <h2 className="section-title">服务性质</h2>
        <p>
          「抢票」是<strong>合法辅助</strong>工具：帮助你查询余票、盯票提醒，并在站内完成登录 / 支付手递。
          出票与结算始终发生在官方平台；我们不是黄牛、不以加价倒票为业。
        </p>

        <h2 className="section-title">禁止行为</h2>
        <ul>
          <li>囤票、倒卖、虚假身份、绕过官方风控或验证码农场。</li>
          <li>使用他人账号或未授权凭证。</li>
          <li>对接口进行滥用、刷量或攻击。</li>
          <li>任何违反中国法律法规及平台用户协议的行为。</li>
        </ul>

        <h2 className="section-title">账号与凭证</h2>
        <p>
          你应使用本人实名信息与本人平台账号。平台密码仅在绑定流程中短暂使用，不会以明文写入数据库。
          会话泄露风险由双方共同注意；发现异常请立即解绑并修改官方密码。
        </p>

        <h2 className="section-title">数据准确性</h2>
        <p>
          实时数据依赖上游公开接口 / 授权 API；演示模式数据为样例。余票、票价、场次可能瞬时变化，最终以官方平台为准。
        </p>

        <h2 className="section-title">免责</h2>
        <p>
          因官方接口变更、验证码 / 短信 / 人脸核验、网络故障或不可抗力导致的下单失败、支付超时，我们尽力提示但不保证百分百成功。
          人工验证码与最终支付必须由你本人完成。
        </p>

        <h2 className="section-title">终止</h2>
        <p>我们有权在发现违规（尤其是倒票 / 滥用）时暂停或终止服务。</p>

        <p className="muted">本页为产品级简要说明，正式上线前请由法务审阅并替换为完整文本。</p>
      </div>
    </div>
  );
}
