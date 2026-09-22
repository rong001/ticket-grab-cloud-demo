"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { api, getToken } from "@/lib/api";
import { useDamaiTheme } from "@/components/DamaiTheme";
import OfficialLoginAssist, { type OfficialLoginPlatform } from "@/components/OfficialLoginAssist";
import FlowStepper, { stepsForChannel } from "@/components/FlowStepper";

type OrderDetail = {
  id: string;
  channel: string;
  status: string;
  amount?: number | null;
  currency?: string;
  externalOrderId?: string | null;
  errorMessage?: string | null;
  paymentUrl?: string | null;
  payload?: {
    nextSteps?: string[];
    notes?: string;
    shortlistItem?: { title?: string; meta?: Record<string, unknown>; availability?: string };
    preferredPlatform?: string;
    payDeadline?: string;
    paymentUrlOfficial?: string;
    interaction?: { type: string; message: string; imageBase64?: string; resumeToken?: string };
    bookingMode?: { stub?: boolean; dryRun?: boolean };
    confirmation?: { confirmed?: boolean; source?: string };
  };
  session?: { sessionStatus: string; platform: string; hasEncryptedSession?: boolean };
};

type BookingMode = {
  bookingStub?: boolean;
  trainBookingDryRun?: boolean;
  trainLiveQuery?: boolean;
  trainRealSubmit?: boolean;
  realTrainSubmit?: boolean;
};

type LoginApiResult = {
  status: string;
  message?: string;
  resumeToken?: string;
  challenge?: { kind: string; message: string; imageBase64?: string };
};

const CHANNEL_COPY: Record<
  string,
  { platformDefault: string; loginTitle: string; payTitle: string; intro: string; loginSteps: string[] }
> = {
  train: {
    platformDefault: "12306",
    loginTitle: "在本站完成 12306 登录",
    payTitle: "12306 支付手递",
    intro: "站内协助登录 = 打开官方登录，不破解。本页引导您在官方页完成账号密码→验证码→短信→成功回跳；出票与资金清算仍走官方。",
    loginSteps: [
      "打开官方登录页（弹窗 / 新标签 / 内嵌）或使用官方接口协助表单",
      "账号密码 → 验证码 → 短信/人脸（本人完成，不自动打码）",
      "成功回跳后会话按加密 vault 保存，再提交订单",
      "支付在官方收银台完成，回写需确认字段",
    ],
  },
  show: {
    platformDefault: "damai",
    loginTitle: "在本站完成 大麦/猫眼 登录",
    payTitle: "大麦/猫眼 支付手递",
    intro: "站内协助登录 = 打开官方登录，不破解。出票与资金清算仍走官方；不做队列/验证码绕过。",
    loginSteps: [
      "打开大麦或猫眼官方登录面板（本产品 iframe / WebView）",
      "使用您本人账号完成验证码 / 短信",
      "回传 session → 本系统加密保存",
      "售罄场次将进入「候补中」；有票则进入支付手递",
    ],
  },
  flight: {
    platformDefault: "airline",
    loginTitle: "在本站完成 航司/OTA 登录",
    payTitle: "航司/OTA 支付手递",
    intro: "本页在抢票云域名内引导航司/OTA 登录与支付手递。出票与资金清算仍走官方。",
    loginSteps: [
      "打开航司/OTA 官方登录面板（本产品 iframe / WebView）",
      "使用您本人账号完成验证码 / 短信",
      "回传 session → 本系统加密保存",
      "自动尝试辅助提交（无会话则保持 awaiting_login）",
    ],
  },
};

function resolvePlatform(data: OrderDetail): string {
  if (data.payload?.preferredPlatform) return data.payload.preferredPlatform;
  if (data.session?.platform) return data.session.platform;
  return CHANNEL_COPY[data.channel]?.platformDefault ?? "12306";
}

function ModeBanner({ mode, orderMode }: { mode: BookingMode | null; orderMode?: { stub?: boolean; dryRun?: boolean; trainRealSubmit?: boolean } }) {
  const stub = orderMode?.stub ?? mode?.bookingStub ?? true;
  const dry = orderMode?.dryRun ?? mode?.trainBookingDryRun;
  const submitOn =
    orderMode?.trainRealSubmit === true ||
    mode?.trainRealSubmit === true ||
    mode?.realTrainSubmit === true;
  if (stub) {
    return (
      <p className="info-banner">
        <span className="badge">演示模式</span>{" "}
        外部单号为 STUB-*，非真实购票
      </p>
    );
  }
  if (!submitOn) {
    return (
      <p className="info-banner">
        <span className="badge">下单关闭</span>{" "}
        12306 协助提交已关闭（TRAIN_REAL_SUBMIT≠1）。请走官方 12306 支付。
        {mode?.trainLiveQuery ? " · 实时查票 ON" : ""}
      </p>
    );
  }
  return (
    <p className="info-banner">
      <span className="badge available">协助下单已开启</span>{" "}
      需本人会话 + 显式提交；非无人值守自动购票
      {dry ? " · DRY RUN（最终确认前停止）" : ""}
    </p>
  );
}

function CheckoutInner() {
  const params = useParams<{ orderId: string }>();
  const orderId = params?.orderId ?? "";
  const search = useSearchParams();
  const step = search?.get("step") || "login";
  const router = useRouter();
  const [data, setData] = useState<OrderDetail | null>(null);
  useDamaiTheme(data?.channel === "show");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [tokenDraft, setTokenDraft] = useState("");
  const [showPlatform, setShowPlatform] = useState<"damai" | "maoyan">("damai");
  const [mode, setMode] = useState<BookingMode | null>(null);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [resumeToken, setResumeToken] = useState("");
  const [captchaImage, setCaptchaImage] = useState<string | undefined>();
  const [challengeKind, setChallengeKind] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    api<OrderDetail>(`/orders/${orderId}`)
      .then((d) => {
        setData(d);
        if (d.payload?.preferredPlatform === "maoyan" || d.session?.platform === "maoyan") {
          setShowPlatform("maoyan");
        }
        const inter = d.payload?.interaction;
        if (inter) {
          setChallengeKind(inter.type);
          setResumeToken(inter.resumeToken ?? "");
          setCaptchaImage(inter.imageBase64);
          setInfo(inter.message);
        }
      })
      .catch((e) => setError(e.message));
    api<BookingMode>("/health").then(setMode).catch(() => null);
  }, [orderId, router]);

  useEffect(() => {
    load();
  }, [load]);

  function applyLoginResult(res: LoginApiResult) {
    setInfo(res.message ?? res.status);
    if (res.status === "ok") {
      setChallengeKind(null);
      setResumeToken("");
      setCaptchaImage(undefined);
      setPassword("");
      return;
    }
    if (res.resumeToken) setResumeToken(res.resumeToken);
    if (res.challenge) {
      setChallengeKind(res.challenge.kind);
      if (res.challenge.imageBase64) setCaptchaImage(res.challenge.imageBase64);
    }
  }

  async function login12306() {
    setBusy(true);
    setError("");
    try {
      const res = await api<LoginApiResult>("/platforms/12306/login", {
        method: "POST",
        body: JSON.stringify({
          username,
          password,
          captchaAnswer: captchaAnswer || undefined,
        }),
      });
      applyLoginResult(res);
      if (res.status === "ok") {
        await api(`/orders/${orderId}/submit`, { method: "POST", body: "{}" });
        load();
        router.replace(`/checkout/${orderId}?step=pay`);
      } else {
        load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  async function continueCaptcha() {
    setBusy(true);
    setError("");
    try {
      const res = await api<LoginApiResult>("/platforms/12306/captcha", {
        method: "POST",
        body: JSON.stringify({ resumeToken, captchaAnswer }),
      });
      applyLoginResult(res);
      if (res.status === "ok") {
        await api(`/orders/${orderId}/submit`, { method: "POST", body: "{}" });
        router.replace(`/checkout/${orderId}?step=pay`);
      }
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "验证码失败");
    } finally {
      setBusy(false);
    }
  }

  async function continueSms() {
    setBusy(true);
    setError("");
    try {
      const res = await api<LoginApiResult>("/platforms/12306/sms", {
        method: "POST",
        body: JSON.stringify({ resumeToken, smsCode }),
      });
      applyLoginResult(res);
      if (res.status === "ok") {
        await api(`/orders/${orderId}/submit`, { method: "POST", body: "{}" });
        router.replace(`/checkout/${orderId}?step=pay`);
      }
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "短信失败");
    } finally {
      setBusy(false);
    }
  }

  async function saveSession() {
    if (!data) return;
    setBusy(true);
    setError("");
    const platform =
      data.channel === "show" ? showPlatform : resolvePlatform(data);
    try {
      await api("/platforms/link/complete", {
        method: "POST",
        body: JSON.stringify({
          platform,
          sessionToken: tokenDraft || `checkout-session-${platform}-${Date.now()}`,
        }),
      });
      await api(`/orders/${orderId}/submit`, { method: "POST", body: "{}" });
      load();
      router.replace(`/checkout/${orderId}?step=pay`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "失败");
    } finally {
      setBusy(false);
    }
  }

  async function submitOnly() {
    setBusy(true);
    setError("");
    try {
      await api(`/orders/${orderId}/submit`, { method: "POST", body: "{}" });
      load();
      router.replace(`/checkout/${orderId}?step=pay`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  async function refresh12306() {
    setBusy(true);
    setError("");
    try {
      await api(`/orders/${orderId}/12306-status`);
      setInfo("已从 12306 刷新状态");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "刷新失败");
    } finally {
      setBusy(false);
    }
  }

  async function doPay() {
    setBusy(true);
    setError("");
    try {
      await api(`/orders/${orderId}/payment-handoff`, { method: "POST", body: "{}" });
      try {
        await api(`/orders/${orderId}/mark-paid`, { method: "POST", body: "{}" });
      } catch {
        /* may fail without stub/live confirmation — still stay on page */
      }
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "失败");
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) return <p className="loading">加载结账页…</p>;
  if (!data) return <p className="error">{error}</p>;

  const copy = CHANNEL_COPY[data.channel] ?? CHANNEL_COPY.train;
  const platform = data.channel === "show" ? showPlatform : resolvePlatform(data);
  const title = data.payload?.shortlistItem?.title ?? data.channel;
  const meta = data.payload?.shortlistItem?.meta ?? {};
  const tierCabin =
    data.channel === "show" && meta.tier
      ? `票档 ${String(meta.tier)}`
      : data.channel === "flight" && meta.cabin
        ? `舱位 ${String(meta.cabin)}`
        : null;
  const isTrain = data.channel === "train";
  const linked = data.session?.sessionStatus === "linked" && data.session?.hasEncryptedSession;

  return (
    <div className={data.channel === "show" ? "show-chrome" : data.channel === "train" ? "train-chrome" : ""}>
      <FlowStepper
        steps={stepsForChannel(data.channel)}
        current={step === "pay" || data.status === "awaiting_payment" || data.status === "paid" ? "pay" : "confirm"}
        variant={data.channel === "show" ? "show" : data.channel === "flight" ? "flight" : "train"}
      />
      <div className="page-header">
        <div>
          <h1 className="page-title">
            结账 · {data.channel === "train" ? "火车票" : data.channel === "show" ? "演出" : "机票"}
          </h1>
          <p className="meta" style={{ margin: 0 }}>
            {data.id.slice(-8)} · {title}
            {tierCabin ? ` · ${tierCabin}` : ""} ·{" "}
            <span className="badge info">{data.status}</span>
            {data.amount != null ? ` · ${data.currency} ${data.amount}` : ""}
          </p>
        </div>
      </div>
      <ModeBanner mode={mode} orderMode={data.payload?.bookingMode} />
      <p className="lead">{copy.intro}</p>
      {error && <p className="error" style={{ marginBottom: "1rem" }}>{error}</p>}
      {info && <p className="info-banner">{info}</p>}
      {data.errorMessage && <p className="error" style={{ marginBottom: "1rem" }}>{data.errorMessage}</p>}

      <div className="card">
        <div className="filters" style={{ marginBottom: "1.25rem" }}>
          <span className={`badge ${step === "login" ? "step-active" : "step"}`}>1 · 登录</span>
          <span className={`badge ${step === "pay" ? "step-active" : "step"}`}>
            2 · {data.status === "候补中" ? "候补 / 支付" : "支付"}
          </span>
          <span className={`badge ${data.status === "paid" ? "step-active" : "step"}`}>3 · 完成</span>
        </div>

        {(step === "login" || data.status === "awaiting_login" || data.status === "draft") && data.status !== "paid" && (
          <div className="stack">
            <h2 className="section-title">{copy.loginTitle}（{platform}）</h2>
            <p className="muted">
              当前会话：{data.session?.sessionStatus ?? "unknown"}
              {linked ? " · 已绑定加密会话" : ""}。
            </p>
            {data.channel === "show" && (
              <div>
                <label>登录平台</label>
                <select
                  value={showPlatform}
                  onChange={(e) => setShowPlatform(e.target.value as "damai" | "maoyan")}
                >
                  <option value="damai">大麦</option>
                  <option value="maoyan">猫眼</option>
                </select>
              </div>
            )}
            <OfficialLoginAssist
              platform={
                (data.channel === "show"
                  ? showPlatform
                  : data.channel === "flight"
                    ? "airline"
                    : "12306") as OfficialLoginPlatform
              }
              variant="full"
              continueLabel={linked ? "已绑定会话，继续提交" : "我已在官网完成登录，继续"}
              onContinue={() => {
                if (linked) {
                  void submitOnly();
                } else if (isTrain) {
                  setInfo("请使用下方官方接口协助表单完成登录，或勾选步骤后写入会话。");
                } else {
                  void saveSession();
                }
              }}
              continueDisabled={busy}
            />

            {isTrain ? (
              <>
                <div>
                  <label>12306 用户名</label>
                  <input type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
                </div>
                <div>
                  <label>12306 密码</label>
                  <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                {(challengeKind === "captcha" || captchaImage) && (
                  <div>
                    <label>验证码</label>
                    {captchaImage && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt="captcha"
                        src={captchaImage.startsWith("data:") ? captchaImage : `data:image/jpg;base64,${captchaImage}`}
                        style={{ maxWidth: 300, display: "block", marginBottom: 8 }}
                      />
                    )}
                    <input value={captchaAnswer} onChange={(e) => setCaptchaAnswer(e.target.value)} placeholder="验证码答案" />
                  </div>
                )}
                {challengeKind === "sms" && (
                  <div>
                    <label>短信验证码</label>
                    <input value={smsCode} onChange={(e) => setSmsCode(e.target.value)} />
                  </div>
                )}
                {challengeKind === "face" && (
                  <p className="error">需要人脸核验：请先在 12306 官方 App 完成后再回本页登录。</p>
                )}
                <div className="btn-row">
                  <button type="button" onClick={login12306} disabled={busy || !username || !password}>
                    {busy ? "…" : "登录并提交"}
                  </button>
                  {resumeToken && challengeKind === "captcha" && (
                    <button type="button" onClick={continueCaptcha} disabled={busy || !captchaAnswer}>提交验证码</button>
                  )}
                  {resumeToken && challengeKind === "sms" && (
                    <button type="button" onClick={continueSms} disabled={busy || !smsCode}>提交短信</button>
                  )}
                  {linked && (
                    <button type="button" className="secondary" onClick={submitOnly} disabled={busy}>
                      使用已绑定会话提交
                    </button>
                  )}
                </div>
                <p className="muted">演示：也可粘贴 stub 会话（仅 stub 模式有意义）</p>
                <textarea rows={2} value={tokenDraft} onChange={(e) => setTokenDraft(e.target.value)} placeholder="演示 stub 会话" />
                <button type="button" className="secondary" onClick={saveSession} disabled={busy}>
                  写入演示会话并提交
                </button>
              </>
            ) : (
              <>
                <div>
                  <label>Session token（演示）</label>
                  <textarea
                    rows={2}
                    value={tokenDraft}
                    onChange={(e) => setTokenDraft(e.target.value)}
                    placeholder="留空则使用演示 stub 会话"
                  />
                </div>
                <button type="button" onClick={saveSession} disabled={busy}>
                  {busy ? "…" : "完成登录并继续提交"}
                </button>
              </>
            )}
          </div>
        )}

        {(step === "pay" || data.status === "awaiting_payment" || data.status === "候补中") && data.status !== "paid" && (
          <div className="stack" style={{ marginTop: "1.25rem" }}>
            <h2 className="section-title">{copy.payTitle}</h2>
            <p className="info-banner" role="note">
              支付在官方完成，款项付给铁路/主办方/航司。本站不提供仿冒银行卡收款表单。
            </p>
            <p className="muted">
              外部单号：{data.externalOrderId ?? "（提交后生成）"}。
              {data.payload?.payDeadline && ` 支付时限：${data.payload.payDeadline}。`}
              {data.status === "候补中" && " 当前候补中，出票后可支付。"}
            </p>
            <div className="handoff-frame">
              <p><strong>官方收银台</strong></p>
              <p className="muted">金额：{data.currency} {data.amount ?? "—"}</p>
              <ol>
                <li>点击下方主按钮打开官方收银台（跳转 / SDK 回调）</li>
                <li>在官方页面完成支付；资金清算走官方</li>
                {isTrain && <li>支付成功后点「刷新 12306 状态」回写确认字段</li>}
                <li>无确认字段时<strong>不会</strong>标记为已支付</li>
                {data.channel === "show" && <li>候补成功出票后才会开放支付</li>}
              </ol>
            </div>
            <div className="btn-row">
              {(() => {
                const official =
                  data.payload?.paymentUrlOfficial ||
                  (data.paymentUrl && !String(data.paymentUrl).includes("/checkout/")
                    ? data.paymentUrl
                    : null);
                const openOfficial = () => {
                  if (official) {
                    window.open(official, "_blank", "noopener,noreferrer");
                  }
                  void doPay();
                };
                return (
                  <button
                    type="button"
                    className="btn-query"
                    onClick={openOfficial}
                    disabled={busy || data.status === "候补中"}
                  >
                    {data.status === "候补中"
                      ? "候补中 — 暂不可支付"
                      : busy
                        ? "…"
                        : official
                          ? "打开官方收银台支付"
                          : data.payload?.confirmation?.source === "stub"
                            ? "模拟完成支付（stub）"
                            : "生成站内支付手递并打开收银台"}
                  </button>
                );
              })()}
              {isTrain && (
                <button type="button" className="secondary" onClick={refresh12306} disabled={busy}>
                  刷新 12306 状态
                </button>
              )}
              {data.payload?.paymentUrlOfficial && (
                <a
                  className="ghost"
                  href={data.payload.paymentUrlOfficial}
                  target="_blank"
                  rel="noreferrer"
                >
                  官方支付链接
                </a>
              )}
            </div>
          </div>
        )}

        {data.status === "paid" && (
          <div className="stack">
            <h2 className="section-title">已完成</h2>
            <p>订单已支付（含确认字段）。可在订单详情查看时间线。</p>
            <Link href={`/orders/${orderId}`}><button type="button">查看订单</button></Link>
          </div>
        )}
      </div>

      {!!data.payload?.nextSteps?.length && (
        <div className="card">
          <h2 className="section-title">下一步</h2>
          <ol>{data.payload.nextSteps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          {data.payload.notes && <p className="muted">{data.payload.notes}</p>}
        </div>
      )}
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<p className="loading">加载中…</p>}>
      <CheckoutInner />
    </Suspense>
  );
}
