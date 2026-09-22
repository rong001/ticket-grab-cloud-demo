export default function HomePage() {
  return (
    <div>
      <div className="booking-panel">
        <div className="booking-panel-hd">余票查询</div>
        <div className="booking-panel-bd">
          <div className="booking-tabs" role="tablist">
            <button type="button" className="active" role="tab" aria-selected="true">
              单程
            </button>
            <button type="button" role="tab" aria-selected="false" disabled title="敬请期待">
              往返
            </button>
          </div>
          <p className="lead" style={{ marginBottom: "1rem" }}>
            公开查票无需登录。盯票与下单需账号；支付跳转官方平台。本站非铁路 / 大麦授权代售。
            当前站点已通过 HTTPS 访问；支付仍跳转官方平台。
          </p>
          <div className="hero-actions">
            <a href="/intake">
              <button type="button" className="btn-query">
                免费查票
              </button>
            </a>
            <a href="/login">
              <button type="button" className="secondary">
                登录账号
              </button>
            </a>
            <a href="/capabilities">
              <button type="button" className="secondary">
                能力说明
              </button>
            </a>
          </div>
        </div>
      </div>

      <div className="feature-grid">
        <div className="feature">
          <h3>公开查票</h3>
          <p>火车 / 演出 / 机票余票与场次公开检索，游客可直接查看短名单，无需先登录。</p>
        </div>
        <div className="feature">
          <h3>账号盯票</h3>
          <p>登录后可创建需求、按间隔刷新；有变化再通知。不绕过验证码或官方队列。</p>
        </div>
        <div className="feature">
          <h3>支付走官方</h3>
          <p>下单协助仅打开官方登录与支付页；本站不是售票方，也不在站内收取票款。</p>
        </div>
      </div>

      <div className="card" style={{ marginTop: "1.25rem" }}>
        <h2 className="section-title">开始使用</h2>
        <ol className="steps-list">
          <li>
            <a href="/requests/new">公开查票</a>（游客可用；<a href="/register">注册</a> / <a href="/login">登录</a> 后可盯票）
          </li>
          <li>
            维护 <a href="/travelers">出行人</a>，按需 <a href="/accounts">绑定平台会话</a>
          </li>
          <li>
            登录后「创建需求并盯票」→ 选班次协助下单
          </li>
          <li>
            支付跳转官方；进度见 <a href="/orders">订单</a>。详见 <a href="/capabilities">能力说明</a>
          </li>
        </ol>
        <p className="meta" style={{ marginTop: "1rem" }}>
          说明：PROVIDER_MODE=live 仅表示走公开查询接口，不等于已获 12306 / 大麦授权代售或自动购票。
        </p>
      </div>
    </div>
  );
}
