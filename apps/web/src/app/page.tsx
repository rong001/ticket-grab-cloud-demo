export default function HomePage() {
  return (
    <div>
      <section className="hero">
        <p className="meta" style={{ marginBottom: "0.75rem" }}>
          TicketGrab
        </p>
        <h1 className="display">用更少的步骤，盯住想要的票。</h1>
        <p className="lead">
          查票、短名单、盯票、下单与支付手递，都在站内完成。出票与结算仍走官方平台——我们只做合法、透明的辅助。
        </p>
        <div className="hero-actions">
          <a href="/requests/new">
            <button type="button">开始查票</button>
          </a>
          <a href="/login">
            <button type="button" className="secondary">
              登录账号
            </button>
          </a>
        </div>
      </section>

      <div className="feature-grid">
        <div className="feature">
          <h3>查票与短名单</h3>
          <p>火车、演出、机票一次检索，沉淀成可下单的短名单。</p>
        </div>
        <div className="feature">
          <h3>安静盯票</h3>
          <p>按你设定的间隔刷新余票，有变化再通知，不打扰。</p>
        </div>
        <div className="feature">
          <h3>站内结账</h3>
          <p>登录与支付手递留在本站；凭证归你，会话加密保存。</p>
        </div>
      </div>

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h2 className="section-title">开始使用</h2>
        <ol className="steps-list">
          <li>
            <a href="/register">注册</a> 或 <a href="/login">登录</a>
          </li>
          <li>
            维护 <a href="/travelers">出行人/观演人</a>，并 <a href="/accounts">绑定平台账号</a>
          </li>
          <li>
            <a href="/requests/new">新建查票</a> → 搜索 → 选条目下单
          </li>
          <li>
            在结账页完成登录 / 支付手递，于 <a href="/orders">订单</a> 查看进度
          </li>
        </ol>
      </div>
    </div>
  );
}
