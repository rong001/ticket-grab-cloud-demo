"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, getToken } from "@/lib/api";
import OfficialLoginAssist, { type OfficialLoginPlatform } from "@/components/OfficialLoginAssist";

type PlatformRow = {
  platform: string;
  sessionStatus: string;
  hasSessionBlob?: boolean;
  hasVaultRef?: boolean;
  lastVerifiedAt?: string | null;
  displayName?: string | null;
};

type BookingMode = {
  bookingStub?: boolean;
  trainBookingDryRun?: boolean;
  realTrainSubmit?: boolean;
};

type LoginApiResult = {
  status: string;
  message?: string;
  resumeToken?: string;
  challenge?: { kind: string; message: string; imageBase64?: string; mobileHint?: string };
  credential?: PlatformRow;
  bookingMode?: BookingMode;
};

const LABELS: Record<string, string> = {
  "12306": "12306 铁路",
  damai: "大麦",
  maoyan: "猫眼",
  airline: "航司 / OTA",
};

const HANDOFF: Record<string, { title: string; steps: string[]; tip: string }> = {
  "12306": {
    title: "在本站完成 12306 登录（协助，非破解）",
    steps: [
      "打开官方登录页（弹窗 / 新标签 / 内嵌）或使用下方官方接口协助表单",
      "账号密码 → 验证码 → 短信/人脸（均由您本人在官网完成）",
      "成功回跳后，会话 cookie 仅按已设计的加密 vault 保存",
      "之后火车票下单/支付在结账页继续；支付仍走官方收银台",
    ],
    tip: "站内协助登录 = 打开官方登录，不破解。不自动打码、不绕过人脸/队列/支付。密码仅用于当次官方登录请求，服务端不落库明文密码。",
  },
  damai: {
    title: "在本站完成 大麦 登录（打开官方，不破解）",
    steps: [
      "点击「开始绑定」标记为需浏览器登录",
      "在内嵌面板完成大麦官方登录",
      "回传 session token，加密保存",
      "演出下单/候补/支付在站内结账页完成，无需自行打开大麦 App",
    ],
    tip: "演出渠道也可绑定猫眼；下单时可选择平台偏好。",
  },
  maoyan: {
    title: "在本站完成 猫眼 登录（打开官方，不破解）",
    steps: [
      "点击「开始绑定」标记为需浏览器登录",
      "在内嵌面板完成猫眼官方登录",
      "回传 session token，加密保存",
      "演出候补与支付手递与大麦路径相同，均在站内完成",
    ],
    tip: "与大麦二选一或同时绑定；订单会优先使用已选偏好。",
  },
  airline: {
    title: "在本站完成 航司/OTA 登录（打开官方，不破解）",
    steps: [
      "点击「开始绑定」标记为需浏览器登录",
      "在内嵌面板完成航司或 OTA 官方登录",
      "回传 session token，加密保存",
      "机票下单与支付在站内结账页继续，无需自行打开航司 App",
    ],
    tip: "舱位信息在下单向导与结账页展示。",
  },
};

function ModeBanner({ mode }: { mode: BookingMode | null }) {
  if (!mode) return null;
  if (mode.realTrainSubmit) {
    return (
      <p className="info-banner">
        <span className="badge available">真实下单</span>{" "}
        BOOKING_STUB 已关闭
        {mode.trainBookingDryRun ? " · DRY RUN（最终确认前停止）" : ""}
      </p>
    );
  }
  return (
    <p className="info-banner">
      <span className="badge">演示模式</span>{" "}
      不会调用真实 12306 下单
    </p>
  );
}

function AccountsInner() {
  const router = useRouter();
  const search = useSearchParams();
  const [rows, setRows] = useState<PlatformRow[]>([]);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [tokenDraft, setTokenDraft] = useState("");
  const [activePlatform, setActivePlatform] = useState(search?.get("platform") || "12306");
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
    api<PlatformRow[]>("/platforms")
      .then(setRows)
      .catch((e) => setError(e.message));
    api<BookingMode>("/health")
      .then(setMode)
      .catch(() => setMode(null));
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const p = search?.get("platform");
    if (p && LABELS[p]) setActivePlatform(p);
  }, [search]);

  function applyLoginResult(res: LoginApiResult) {
    setInfo(res.message ?? res.status);
    if (res.bookingMode) setMode(res.bookingMode);
    if (res.status === "ok") {
      setChallengeKind(null);
      setResumeToken("");
      setCaptchaImage(undefined);
      setPassword("");
      setCaptchaAnswer("");
      setSmsCode("");
      load();
      return;
    }
    if (res.resumeToken) setResumeToken(res.resumeToken);
    if (res.challenge) {
      setChallengeKind(res.challenge.kind);
      if (res.challenge.imageBase64) setCaptchaImage(res.challenge.imageBase64);
    }
  }

  async function startLink(platform: string) {
    setBusy(platform);
    setError("");
    try {
      await api("/platforms/link/start", {
        method: "POST",
        body: JSON.stringify({ platform }),
      });
      setActivePlatform(platform);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "失败");
    } finally {
      setBusy(null);
    }
  }

  async function completeLink(platform: string, needsBrowserLogin = false) {
    setBusy(platform);
    setError("");
    try {
      await api("/platforms/link/complete", {
        method: "POST",
        body: JSON.stringify(
          needsBrowserLogin
            ? { platform, needsBrowserLogin: true }
            : { platform, sessionToken: tokenDraft || `demo-session-${platform}-${Date.now()}` }
        ),
      });
      setTokenDraft("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "失败");
    } finally {
      setBusy(null);
    }
  }

  async function login12306() {
    setBusy("12306-login");
    setError("");
    setInfo("");
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
    } catch (e) {
      // 202 may still parse — api helper throws on non-2xx; try read message
      setError(e instanceof Error ? e.message : "登录失败");
    } finally {
      setBusy(null);
    }
  }

  async function continueCaptcha() {
    setBusy("12306-captcha");
    setError("");
    try {
      const res = await api<LoginApiResult>("/platforms/12306/captcha", {
        method: "POST",
        body: JSON.stringify({ resumeToken, captchaAnswer }),
      });
      applyLoginResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "验证码提交失败");
    } finally {
      setBusy(null);
    }
  }

  async function continueSms() {
    setBusy("12306-sms");
    setError("");
    try {
      const res = await api<LoginApiResult>("/platforms/12306/sms", {
        method: "POST",
        body: JSON.stringify({ resumeToken, smsCode }),
      });
      applyLoginResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "短信提交失败");
    } finally {
      setBusy(null);
    }
  }

  async function validate12306() {
    setBusy("12306-validate");
    setError("");
    try {
      const res = await api<{ ok: boolean; reason?: string }>("/platforms/12306/validate", {
        method: "POST",
        body: "{}",
      });
      setInfo(res.ok ? "会话有效" : res.reason ?? "会话无效");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "校验失败");
    } finally {
      setBusy(null);
    }
  }

  async function unlink(platform: string) {
    if (!confirm(`解除绑定 ${LABELS[platform] ?? platform}？`)) return;
    await api(`/platforms/${platform}`, { method: "DELETE" });
    load();
  }

  const handoff = HANDOFF[activePlatform] ?? HANDOFF["12306"];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">账号绑定</h1>
          <p className="lead">站内协助登录 = 打开官方登录，不破解。会话加密保存，不存明文密码。</p>
        </div>
      </div>
      <ModeBanner mode={mode} />
      {error && <p className="error" style={{ marginBottom: "1rem" }}>{error}</p>}
      {info && <p className="info-banner">{info}</p>}

      <div className="card">
        <h2 className="section-title">已绑定平台</h2>
        {!rows.length && <p className="muted" style={{ margin: 0 }}>暂无平台记录。</p>}
        {rows.map((r) => (
          <div className="item" key={r.platform}>
            <div className="item-row">
              <div>
                <span className="item-title">{LABELS[r.platform] ?? r.platform}</span>{" "}
                <span className={`badge ${r.sessionStatus === "linked" ? "linked" : "info"}`}>{r.sessionStatus}</span>
                <div className="meta" style={{ marginTop: "0.25rem" }}>
                  {r.hasSessionBlob ? "已存加密会话" : "无会话"}
                  {r.hasVaultRef ? " · vaultRef" : ""}
                  {r.lastVerifiedAt ? ` · 校验于 ${new Date(r.lastVerifiedAt).toLocaleString()}` : ""}
                </div>
              </div>
              <div className="btn-row">
                <button type="button" onClick={() => startLink(r.platform)} disabled={busy === r.platform}>
                  开始绑定
                </button>
                <button type="button" className="secondary" onClick={() => setActivePlatform(r.platform)}>
                  打开面板
                </button>
                {r.platform === "12306" && (
                  <button type="button" className="ghost" onClick={validate12306} disabled={!!busy}>
                    校验
                  </button>
                )}
                <button type="button" className="ghost" onClick={() => unlink(r.platform)}>
                  解绑
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card stack">
        <h2 className="section-title">{handoff.title}</h2>
        <p className="muted" style={{ margin: 0 }}>{handoff.tip}</p>
        <OfficialLoginAssist
          platform={(LABELS[activePlatform] ? activePlatform : "12306") as OfficialLoginPlatform}
          variant="full"
          continueLabel={
            rows.some((r) => r.platform === activePlatform && r.sessionStatus === "linked")
              ? "已绑定，去新建查询"
              : "我已完成官方登录，继续绑定"
          }
          onContinue={() => {
            const linked = rows.some(
              (r) => r.platform === activePlatform && r.sessionStatus === "linked",
            );
            if (linked) {
              router.push("/requests/new");
              return;
            }
            setInfo("请在下方完成会话回传或官方接口协助登录。");
            const el = document.getElementById("accounts-bind-form");
            el?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
        <div id="accounts-bind-form" />
        <div>
          <label>平台</label>
          <select value={activePlatform} onChange={(e) => setActivePlatform(e.target.value)}>
            {Object.keys(LABELS).map((p) => (
              <option key={p} value={p}>{LABELS[p]}</option>
            ))}
          </select>
        </div>

        {activePlatform === "12306" ? (
          <>
            <div>
              <label>12306 用户名</label>
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="手机号 / 邮箱 / 用户名"
              />
            </div>
            <div>
              <label>12306 密码</label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="仅用于当次官方登录，不落库"
              />
            </div>
            {(challengeKind === "captcha" || captchaImage) && (
              <div>
                <label>图片验证码</label>
                {captchaImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt="12306 captcha"
                    src={captchaImage.startsWith("data:") ? captchaImage : `data:image/jpg;base64,${captchaImage}`}
                    style={{ maxWidth: 300, display: "block", marginBottom: 8 }}
                  />
                )}
                <input
                  value={captchaAnswer}
                  onChange={(e) => setCaptchaAnswer(e.target.value)}
                  placeholder="按官网规则输入验证码坐标或答案"
                />
              </div>
            )}
            {challengeKind === "sms" && (
              <div>
                <label>短信验证码</label>
                <input
                  value={smsCode}
                  onChange={(e) => setSmsCode(e.target.value)}
                  placeholder="官方下发的短信码"
                />
              </div>
            )}
            {challengeKind === "face" && (
              <p className="error">需要人脸核验：请使用 12306 官方 App 完成后再回站内重新登录。</p>
            )}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="button" onClick={login12306} disabled={!!busy || !username || !password}>
                {busy === "12306-login" ? "登录中…" : "官方接口协助登录"}
              </button>
              {resumeToken && challengeKind === "captcha" && (
                <button type="button" onClick={continueCaptcha} disabled={!!busy || !captchaAnswer}>
                  提交验证码
                </button>
              )}
              {resumeToken && challengeKind === "sms" && (
                <button type="button" onClick={continueSms} disabled={!!busy || !smsCode}>
                  提交短信码
                </button>
              )}
            </div>
            <p className="muted">上方为官方登录页协助；下方「官方接口协助」在遇到验证码/短信时由您本人填写，不会自动打码。演示 stub：仍可用「粘贴会话」快速绑定假会话（仅 stub 下单）。</p>
            <div>
              <label>Session token / cookie（可选演示）</label>
              <textarea
                rows={2}
                value={tokenDraft}
                onChange={(e) => setTokenDraft(e.target.value)}
                placeholder="演示用：粘贴 cookie JSON；真实模式请用上方用户名密码"
              />
            </div>
            <button type="button" className="secondary" onClick={() => completeLink("12306", false)} disabled={!!busy}>
              提交演示会话并标记已绑定
            </button>
          </>
        ) : (
          <>
            <div>
              <label>Session token / cookie（可选）</label>
              <textarea
                rows={3}
                value={tokenDraft}
                onChange={(e) => setTokenDraft(e.target.value)}
                placeholder="从站内 WebView 回传的会话串；留空则写入演示 stub"
              />
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="button" onClick={() => completeLink(activePlatform, false)} disabled={!!busy}>
                提交会话并标记已绑定
              </button>
              <button type="button" className="secondary" onClick={() => completeLink(activePlatform, true)} disabled={!!busy}>
                标记为需浏览器登录
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function AccountsPage() {
  return (
    <Suspense fallback={<p className="loading">加载中…</p>}>
      <AccountsInner />
    </Suspense>
  );
}
