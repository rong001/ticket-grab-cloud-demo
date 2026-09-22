"use client";

import { useMemo, useState, type ReactNode } from "react";

export type OfficialLoginPlatform = "12306" | "damai" | "maoyan" | "airline";

const OFFICIAL: Record<
  OfficialLoginPlatform,
  {
    title: string;
    loginUrl: string;
    steps: string[];
    note: string;
  }
> = {
  "12306": {
    title: "在本站完成 12306 登录",
    loginUrl: "https://kyfw.12306.cn/otn/resources/login.html",
    steps: [
      "打开下方官方登录页（弹窗 / 本页跳转 / 新标签 / 内嵌）",
      "输入您本人账号密码",
      "按官网提示完成验证码",
      "如需短信 / 人脸，在官网或官方 App 完成",
      "成功后回到本站；会话 cookie 仅在已设计的加密 vault 中保存",
    ],
    note: "站内协助登录 = 打开官方登录，不破解。不自动打码、不绕过人脸/队列/支付加密。",
  },
  damai: {
    title: "在本站完成 大麦 登录",
    loginUrl: "https://passport.damai.cn/login",
    steps: [
      "打开大麦官方登录页（弹窗或本页跳转）",
      "使用本人账号完成验证码 / 短信",
      "登录成功后将会话回传本站（如已设计）",
      "下单与支付仍跳转大麦官方收银台",
    ],
    note: "站内协助登录 = 打开官方登录，不破解大麦风控 / 队列 / 支付。",
  },
  maoyan: {
    title: "在本站完成 猫眼 登录",
    loginUrl: "https://passport.maoyan.com/login",
    steps: [
      "打开猫眼官方登录页（弹窗或本页跳转）",
      "使用本人账号完成验证码 / 短信",
      "登录成功后将会话回传本站（如已设计）",
      "候补与支付走猫眼官方流程",
    ],
    note: "站内协助登录 = 打开官方登录，不破解。",
  },
  airline: {
    title: "在本站完成 航司/OTA 登录",
    loginUrl: "https://www.ctrip.com/",
    steps: [
      "打开航司或 OTA 官方登录页",
      "使用本人账号完成验证",
      "会话回传后在结账页继续",
      "出票与资金清算仍走官方",
    ],
    note: "站内协助登录 = 打开官方登录，不破解。",
  },
};

type Props = {
  platform: OfficialLoginPlatform;
  /** Compact vs full-page panel */
  variant?: "panel" | "full";
  /** Shown after user marks steps / login done */
  onContinue?: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
  children?: ReactNode;
};

export default function OfficialLoginAssist({
  platform,
  variant = "panel",
  onContinue,
  continueLabel = "我已完成官方登录，继续",
  continueDisabled,
  children,
}: Props) {
  const cfg = OFFICIAL[platform] ?? OFFICIAL["12306"];
  const [iframeAttempt, setIframeAttempt] = useState(false);
  const [checked, setChecked] = useState<Record<number, boolean>>({});

  const checklist = useMemo(() => cfg.steps, [cfg.steps]);
  const allChecked = checklist.every((_, i) => checked[i]);
  const someChecked = checklist.some((_, i) => checked[i]);

  function openPopup() {
    const w = 480;
    const h = 720;
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));
    window.open(
      cfg.loginUrl,
      `official-login-${platform}`,
      `popup=yes,width=${w},height=${h},left=${left},top=${top}`,
    );
  }

  function openTab() {
    window.open(cfg.loginUrl, "_blank", "noopener,noreferrer");
  }

  function openSameTab() {
    window.location.assign(cfg.loginUrl);
  }

  return (
    <div className={variant === "full" ? "official-login-assist full" : "official-login-assist"}>
      <div className="official-login-banner" role="note">
        <strong>{cfg.title}</strong>
        <p>{cfg.note}</p>
        <p className="muted" style={{ margin: 0 }}>
          「站内协助登录」= 打开官方登录页，由您本人完成挑战；本产品不逆向、不绕过验证码 / 短信 / 人脸 / 队列 / 支付加密。
        </p>
      </div>

      <div className="handoff-frame">
        <p>
          <strong>步骤清单</strong>
          <button
            type="button"
            className="ghost"
            style={{ marginLeft: 8, fontSize: "0.8rem" }}
            onClick={() => {
              const next: Record<number, boolean> = {};
              checklist.forEach((_, i) => {
                next[i] = true;
              });
              setChecked(next);
            }}
          >
            全部勾选
          </button>
        </p>
        <ol className="official-login-checklist">
          {checklist.map((s, i) => (
            <li key={i}>
              <label>
                <input
                  type="checkbox"
                  checked={!!checked[i]}
                  onChange={(e) => setChecked((prev) => ({ ...prev, [i]: e.target.checked }))}
                />{" "}
                {s}
              </label>
            </li>
          ))}
        </ol>
      </div>

      <div className="btn-row" style={{ flexWrap: "wrap" }}>
        <button type="button" onClick={openPopup}>
          弹窗打开官方登录
        </button>
        <button type="button" className="secondary" onClick={openSameTab}>
          本页跳转官方登录
        </button>
        <button type="button" className="secondary" onClick={openTab}>
          新标签打开官方登录
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => setIframeAttempt((v) => !v)}
        >
          {iframeAttempt ? "收起内嵌面板" : "尝试内嵌官方页"}
        </button>
        <a className="ghost" href={cfg.loginUrl} target="_blank" rel="noopener noreferrer">
          官方链接
        </a>
      </div>

      {iframeAttempt && (
        <div className="official-login-iframe-wrap">
          <p className="muted">
            部分官网禁止 iframe 嵌入（X-Frame-Options）。若下方空白，请改用弹窗 / 本页跳转 / 新标签。
          </p>
          <iframe
            title={`${platform} official login`}
            src={cfg.loginUrl}
            className="official-login-iframe"
            sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      )}

      {onContinue && (
        <div className="official-login-continue">
          <button
            type="button"
            className="btn-query"
            onClick={onContinue}
            disabled={continueDisabled || (!allChecked && !someChecked)}
            title={!allChecked ? "建议勾选步骤清单后再继续" : undefined}
          >
            {continueLabel}
          </button>
          {!allChecked && (
            <p className="muted" style={{ margin: "0.35rem 0 0" }}>
              勾选至少一步（建议全部）后可继续；登录验证由您在官网本人完成。
            </p>
          )}
        </div>
      )}

      {children}
    </div>
  );
}
