export default function CapabilitiesPage() {
  return (
    <div className="card stack">
      <h1 className="page-title">能力说明（诚实披露）</h1>
      <p className="lead">
        本页按步骤说明本站真实能力。公开查票 ≠ 代售授权；PROVIDER_MODE=live ≠ 已获 12306 / 大麦授权自动购票。
      </p>

      <h2 className="section-title">总原则</h2>
      <ul>
        <li>本站是独立票务助手，不是铁路 12306、大麦或航司的官方网站 / 授权代售渠道。</li>
        <li>支付始终跳转官方收银台；本站不在站内收取票款。</li>
        <li>不做验证码识别、短信劫持、队列插队、人脸绕过等违规能力。</li>
        <li>生产环境已启用 HTTPS（见 DEPLOY_HTTPS.md / ACCEPTANCE.md）。HTTP 仅用于本地开发。</li>
      </ul>

      <h2 className="section-title">火车（12306 公开余票）</h2>
      <table className="cap-table">
        <thead>
          <tr>
            <th>步骤</th>
            <th>能力</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>查询</td>
            <td>支持（公开接口）</td>
            <td>调用 12306 公开余票查询。游客可走 POST /api/public/search，无需登录。</td>
          </tr>
          <tr>
            <td>盯票 / 监控</td>
            <td>仅监控</td>
            <td>登录后按间隔刷新公开余票并通知；不是锁票。</td>
          </tr>
          <tr>
            <td>占座 / 提交</td>
            <td>协助登录手递</td>
            <td>在用户本人会话下协助打开官方流程；无第三方代售资质。</td>
          </tr>
          <tr>
            <td>支付</td>
            <td>跳转官方</td>
            <td>支付在 12306 / 铁路官方完成。</td>
          </tr>
        </tbody>
      </table>
      <p className="meta">
        公开余票查询接口可用，不等于获得铁路客票代售许可证，也不等于可对用户账号做无人值守自动购票。
      </p>

      <h2 className="section-title">演出（大麦等）</h2>
      <table className="cap-table">
        <thead>
          <tr>
            <th>步骤</th>
            <th>能力</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>查询</td>
            <td>公开场次检索</td>
            <td>基于公开页面 / 接口的场次与票档信息；非大麦开放平台授权。</td>
          </tr>
          <tr>
            <td>盯票 / 开售提醒</td>
            <td>仅监控</td>
            <td>定时检查公开信息变化并通知。</td>
          </tr>
          <tr>
            <td>下单</td>
            <td>跳官方 / 站内协助登录</td>
            <td>不绕过排队、验证码或风控。</td>
          </tr>
          <tr>
            <td>支付</td>
            <td>跳转官方</td>
            <td>在大麦 / 猫眼等官方完成支付。</td>
          </tr>
        </tbody>
      </table>

      <h2 className="section-title">机票（诚实：实时可售票/票价监控不可用）</h2>
      <div className="info-banner live-fail-banner" role="status" style={{ marginBottom: "0.75rem" }}>
        当前生产未配置 Amadeus / Aviationstack 等授权库存/票价源。OpenSky ADS-B 仅有离港轨迹，
        <strong>不算可售库存</strong>。健康检查字段：
        <code>flightInventoryLive=false</code> · <code>flightFareMonitor=false</code>。
        仅提供查询失败诚实提示 + 官方跳转演示；不会发送虚假「发现可购票」通知。
      </div>
      <table className="cap-table">
        <thead>
          <tr>
            <th>步骤</th>
            <th>能力</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>查询</td>
            <td>演示 / 官方跳转</td>
            <td>
              无库存 Key 时 <code>liveOk=false</code>、<code>mode=fixture</code>、items 可为空；
              UI 标注「实时可售票/票价监控不可用」，不绿标「实时可售」。
            </td>
          </tr>
          <tr>
            <td>票价 / 可售监控</td>
            <td>
              <strong>不可用</strong>
            </td>
            <td>
              需正式接入 Amadeus / Aviationstack / 航司官方 API 后才开启。见仓库
              <code>FLIGHT_SOURCE_ROADMAP.md</code>。
            </td>
          </tr>
          <tr>
            <td>下单 / 支付</td>
            <td>跳转航司 / OTA 官方</td>
            <td>本站不代收机票款。</td>
          </tr>
        </tbody>
      </table>

      <h2 className="section-title">PROVIDER_MODE=live 含义</h2>
      <p>
        仅表示搜索适配器尝试访问上游公开数据源。它不表示本站已获得自动购票、批量占座或第三方售票授权。
        协助下单另需显式开启 <code>TRAIN_REAL_SUBMIT=1</code>（默认关闭）；未开启时 <code>/health.trainRealSubmit=false</code>，提交接口返回禁用。
        任何「一键抢到」的宣传都不适用于本站。机票通道即使 PROVIDER_MODE=live，在无库存 Key 时仍为
        <code>flightInventoryLive=false</code>。
      </p>

      <p>
        <a href="/requests/new">去公开查票</a>
        {" · "}
        <a href="/register">注册</a>
        {" · "}
        <a href="/">返回首页</a>
      </p>
    
      <h2 className="section-title">产品边界（必读）</h2>
      <ul>
        <li><strong>查询</strong>：公开余票 / 场次检索。</li>
        <li><strong>监控（盯票）</strong>：定时刷新并通知；不锁票。</li>
        <li><strong>官方跳转</strong>：登录与支付在 12306 / 大麦 / 航司等官方完成。</li>
        <li><strong>授权自动占座/购票</strong>：仅在取得平台正式授权后才会提供；当前版本<strong>未获授权</strong>，不得宣传无人值守自动购票。</li>
        <li><strong>机票库存监控</strong>：当前<strong>诚实不可用</strong>（见上）。</li>
      </ul>
</div>
  );
}
