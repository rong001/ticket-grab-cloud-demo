import {
  KYFW,
  cookieHeader,
  decodeResumeToken,
  encodeResumeToken,
  formBody,
  parseSessionBlob,
  request12306,
  serializeCookies,
} from "./http.js";
import type {
  CookieJar,
  FetchLike,
  LoginResult,
  PassengerDto,
  SessionValidation,
} from "./types.js";

export interface AuthClientOptions {
  fetchImpl?: FetchLike;
}

function fetchOf(opts?: AuthClientOptions): FetchLike {
  return opts?.fetchImpl ?? fetch;
}

async function warmCookies(fetchImpl: FetchLike, jar: CookieJar): Promise<void> {
  await request12306(fetchImpl, jar, `${KYFW}/otn/leftTicket/init?linktypeid=dc`, {
    method: "GET",
    timeoutMs: 10_000,
  });
  await request12306(fetchImpl, jar, `${KYFW}/passport/web/auth/uamtk-static`, {
    method: "POST",
    body: formBody({ appid: "otn" }),
    referer: `${KYFW}/otn/resources/login.html`,
    timeoutMs: 10_000,
  });
}

type PassportLoginPayload = {
  result_code?: number | string;
  result_message?: string;
  uamtk?: string;
};

type UamtkPayload = {
  result_code?: number | string;
  result_message?: string;
  newapptk?: string;
  apptk?: string;
};

type UamAuthPayload = {
  result_code?: number | string;
  result_message?: string;
  username?: string;
  apptk?: string;
};

function codeOf(v: number | string | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return -1;
}

function detectChallengeMessage(msg: string): LoginResult["status"] | null {
  const m = msg.toLowerCase();
  if (/短信|验证码|sms|mobile/.test(msg) || m.includes("sms")) return "needSms";
  if (/人脸|face|刷脸/.test(msg)) return "needFace";
  if (/验证码|captcha|图片/.test(msg)) return "needCaptcha";
  return null;
}

async function fetchCaptchaImage(
  fetchImpl: FetchLike,
  jar: CookieJar
): Promise<string | undefined> {
  const url = `${KYFW}/passport/captcha/captcha-image64?login_site=E&module=login&rand=sjrand&${Date.now()}`;
  const res = await request12306<{ image?: string; result_code?: string }>(fetchImpl, jar, url, {
    method: "GET",
    referer: `${KYFW}/otn/resources/login.html`,
  });
  if (res.ok && res.data?.image) return res.data.image;
  return undefined;
}

async function exchangeTickets(
  fetchImpl: FetchLike,
  jar: CookieJar
): Promise<{ ok: boolean; username?: string; message: string }> {
  const uamtk = await request12306<UamtkPayload>(
    fetchImpl,
    jar,
    `${KYFW}/passport/web/auth/uamtk`,
    {
      method: "POST",
      body: formBody({ appid: "otn" }),
      referer: `${KYFW}/otn/passport?redirect=/otn/login/userLogin`,
    }
  );
  if (!uamtk.ok || codeOf(uamtk.data?.result_code) !== 0 || !uamtk.data?.newapptk) {
    return {
      ok: false,
      message: uamtk.data?.result_message ?? uamtk.error ?? "uamtk 失败",
    };
  }

  const auth = await request12306<UamAuthPayload>(
    fetchImpl,
    jar,
    `${KYFW}/otn/uamauthclient`,
    {
      method: "POST",
      body: formBody({ tk: uamtk.data.newapptk }),
      referer: `${KYFW}/otn/passport?redirect=/otn/login/userLogin`,
    }
  );
  if (!auth.ok || codeOf(auth.data?.result_code) !== 0) {
    return {
      ok: false,
      message: auth.data?.result_message ?? auth.error ?? "uamauthclient 失败",
    };
  }
  return { ok: true, username: auth.data?.username, message: auth.data?.result_message ?? "验证通过" };
}

/**
 * Start or complete username/password login against official passport endpoints.
 * May return needCaptcha / needSms / needFace — never invents codes.
 */
export async function login12306(
  username: string,
  password: string,
  opts?: AuthClientOptions & { captchaAnswer?: string; cookies?: CookieJar | string }
): Promise<LoginResult> {
  const fetchImpl = fetchOf(opts);
  const jar: CookieJar =
    typeof opts?.cookies === "string"
      ? parseSessionBlob(opts.cookies)
      : { ...(opts?.cookies ?? {}) };

  if (!Object.keys(jar).length) {
    await warmCookies(fetchImpl, jar);
  }

  // If no captcha answer yet, try to pull captcha first when risk requires it.
  // Official flow historically needs captcha-check before login; we attempt login
  // and surface captcha when passport asks, plus proactively expose image for UI.
  if (!opts?.captchaAnswer) {
    const image = await fetchCaptchaImage(fetchImpl, jar);
    if (image) {
      // Soft: many IPs still require captcha. Surface it so UI can continue.
      // Caller may skip and call again with captchaAnswer empty if login works without.
      // We still attempt login below when captchaAnswer provided; without answer we
      // return needCaptcha so the product can collect user input (no auto-solve).
      return {
        status: "needCaptcha",
        cookies: jar,
        challenge: {
          kind: "captcha",
          imageBase64: image,
          message: "12306 要求图片验证码，请在产品内完成（不会自动打码）",
        },
        message: "需要验证码",
        resumeToken: encodeResumeToken({
          step: "captcha",
          username,
          // password held only in resume for continue — encrypted at rest by API layer
          password,
          cookies: jar,
        }),
      };
    }
  } else {
    const checkUrl =
      `${KYFW}/passport/captcha/captcha-check?` +
      formBody({
        answer: opts.captchaAnswer,
        rand: "sjrand",
        login_site: "E",
      });
    const checked = await request12306<{ result_code?: string; result_message?: string }>(
      fetchImpl,
      jar,
      checkUrl,
      { method: "GET", referer: `${KYFW}/otn/resources/login.html` }
    );
    const rc = String(checked.data?.result_code ?? "");
    if (checked.ok && rc !== "4" && rc !== "0") {
      const image = await fetchCaptchaImage(fetchImpl, jar);
      return {
        status: "needCaptcha",
        cookies: jar,
        challenge: {
          kind: "captcha",
          imageBase64: image,
          message: checked.data?.result_message ?? "验证码错误，请重试",
        },
        message: checked.data?.result_message ?? "验证码校验失败",
        resumeToken: encodeResumeToken({
          step: "captcha",
          username,
          password,
          cookies: jar,
        }),
      };
    }
  }

  const loginRes = await request12306<PassportLoginPayload>(
    fetchImpl,
    jar,
    `${KYFW}/passport/web/login`,
    {
      method: "POST",
      body: formBody({
        username,
        password,
        appid: "otn",
        ...(opts?.captchaAnswer ? { answer: opts.captchaAnswer } : {}),
      }),
      referer: `${KYFW}/otn/resources/login.html`,
    }
  );

  if (!loginRes.ok || !loginRes.data) {
    if (loginRes.nonJson) {
      const image = await fetchCaptchaImage(fetchImpl, jar);
      return {
        status: "needCaptcha",
        cookies: jar,
        challenge: {
          kind: "captcha",
          imageBase64: image,
          message: "登录被风控/验证码拦截，请完成验证后重试",
        },
        message: loginRes.error ?? "登录失败",
        resumeToken: encodeResumeToken({ step: "captcha", username, password, cookies: jar }),
      };
    }
    return {
      status: "fail",
      cookies: jar,
      message: loginRes.error ?? "登录请求失败",
    };
  }

  const rc = codeOf(loginRes.data.result_code);
  const msg = loginRes.data.result_message ?? "";

  if (rc === 0) {
    const exchanged = await exchangeTickets(fetchImpl, jar);
    if (!exchanged.ok) {
      const challenge = detectChallengeMessage(exchanged.message);
      if (challenge === "needSms") {
        return {
          status: "needSms",
          cookies: jar,
          challenge: { kind: "sms", message: exchanged.message },
          message: exchanged.message,
          resumeToken: encodeResumeToken({ step: "sms", username, password, cookies: jar }),
        };
      }
      if (challenge === "needFace") {
        return {
          status: "needFace",
          cookies: jar,
          challenge: { kind: "face", message: exchanged.message },
          message: exchanged.message,
          resumeToken: encodeResumeToken({ step: "face", username, cookies: jar }),
        };
      }
      return { status: "fail", cookies: jar, message: exchanged.message };
    }
    return {
      status: "ok",
      cookies: jar,
      username: exchanged.username,
      message: exchanged.message || "登录成功",
    };
  }

  // Common passport codes: 91/101 SMS, 94 face, 91 captcha variants — message-based detect
  const challenge = detectChallengeMessage(msg);
  if (challenge === "needSms" || rc === 91 || rc === 101) {
    return {
      status: "needSms",
      cookies: jar,
      challenge: { kind: "sms", message: msg || "需要短信验证码" },
      message: msg || "需要短信验证码",
      resumeToken: encodeResumeToken({ step: "sms", username, password, cookies: jar }),
    };
  }
  if (challenge === "needFace" || rc === 94) {
    return {
      status: "needFace",
      cookies: jar,
      challenge: { kind: "face", message: msg || "需要人脸核验" },
      message: msg || "需要人脸核验",
      resumeToken: encodeResumeToken({ step: "face", username, cookies: jar }),
    };
  }
  if (challenge === "needCaptcha" || rc === 4 || rc === 5) {
    const image = await fetchCaptchaImage(fetchImpl, jar);
    return {
      status: "needCaptcha",
      cookies: jar,
      challenge: {
        kind: "captcha",
        imageBase64: image,
        message: msg || "需要图片验证码",
      },
      message: msg || "需要图片验证码",
      resumeToken: encodeResumeToken({ step: "captcha", username, password, cookies: jar }),
    };
  }

  return {
    status: "fail",
    cookies: jar,
    message: msg || `登录失败 (code=${rc})`,
    errorCode: loginRes.data.result_code,
  };
}

/**
 * Continue login after captcha / SMS. Does not invent codes — user supplies them.
 */
export async function continueLogin12306(
  resumeToken: string,
  continuation: { captchaAnswer?: string; smsCode?: string },
  opts?: AuthClientOptions
): Promise<LoginResult> {
  const payload = decodeResumeToken(resumeToken);
  if (!payload) {
    return { status: "fail", cookies: {}, message: "无效的 resumeToken" };
  }
  const username = String(payload.username ?? "");
  const password = String(payload.password ?? "");
  const cookies = (payload.cookies as CookieJar) ?? {};
  const step = String(payload.step ?? "");

  if (step === "sms" || continuation.smsCode) {
    if (!continuation.smsCode) {
      return {
        status: "needSms",
        cookies,
        challenge: { kind: "sms", message: "请输入短信验证码" },
        message: "请输入短信验证码",
        resumeToken,
      };
    }
    const fetchImpl = fetchOf(opts);
    // Official SMS verify endpoint family (best-effort — APIs evolve)
    const verify = await request12306<{ result_code?: number | string; result_message?: string }>(
      fetchImpl,
      cookies,
      `${KYFW}/passport/web/checkVerification`,
      {
        method: "POST",
        body: formBody({
          appid: "otn",
          username,
          randCode: continuation.smsCode,
        }),
        referer: `${KYFW}/otn/resources/login.html`,
      }
    );
    if (!verify.ok || codeOf(verify.data?.result_code) !== 0) {
      // Fallback: retry full login after user provided SMS (some flows bind SMS into session)
      return {
        status: "needSms",
        cookies,
        challenge: {
          kind: "sms",
          message: verify.data?.result_message ?? verify.error ?? "短信验证失败，请重试",
        },
        message: verify.data?.result_message ?? "短信验证失败",
        resumeToken: encodeResumeToken({ step: "sms", username, password, cookies }),
      };
    }
    return login12306(username, password, {
      ...opts,
      cookies,
      captchaAnswer: continuation.captchaAnswer,
    });
  }

  if (!continuation.captchaAnswer) {
    return {
      status: "needCaptcha",
      cookies,
      challenge: { kind: "captcha", message: "请提交验证码坐标/答案" },
      message: "请提交验证码",
      resumeToken,
    };
  }

  return login12306(username, password, {
    ...opts,
    cookies,
    captchaAnswer: continuation.captchaAnswer,
  });
}

export async function validateSession(
  cookies: CookieJar | string,
  opts?: AuthClientOptions
): Promise<SessionValidation> {
  const fetchImpl = fetchOf(opts);
  const jar = typeof cookies === "string" ? parseSessionBlob(cookies) : { ...cookies };
  if (!Object.keys(jar).length) {
    return { ok: false, reason: "无会话 cookie", cookies: jar };
  }

  const res = await request12306<{ data?: { flag?: boolean }; status?: boolean }>(
    fetchImpl,
    jar,
    `${KYFW}/otn/login/checkUser`,
    {
      method: "POST",
      body: formBody({ _json_att: "" }),
      referer: `${KYFW}/otn/leftTicket/init`,
    }
  );

  if (!res.ok) {
    return {
      ok: false,
      reason: res.error ?? `checkUser HTTP ${res.status}`,
      cookies: jar,
    };
  }
  if (res.data?.data?.flag === true) {
    return { ok: true, cookies: jar };
  }
  return { ok: false, reason: "会话无效或已过期", cookies: jar };
}

export async function listPassengers(
  cookies: CookieJar | string,
  opts?: AuthClientOptions
): Promise<{ ok: boolean; passengers: PassengerDto[]; message: string; cookies: CookieJar }> {
  const fetchImpl = fetchOf(opts);
  const jar = typeof cookies === "string" ? parseSessionBlob(cookies) : { ...cookies };

  const res = await request12306<{
    data?: {
      normal_passengers?: Array<Record<string, string>>;
      isExist?: boolean;
      exMsg?: string;
    };
    status?: boolean;
    messages?: string[];
  }>(fetchImpl, jar, `${KYFW}/otn/confirmPassenger/getPassengerDTOs`, {
    method: "POST",
    body: formBody({ _json_att: "" }),
    referer: `${KYFW}/otn/confirmPassenger/initDc`,
  });

  if (!res.ok || !res.data) {
    return {
      ok: false,
      passengers: [],
      message: res.error ?? "获取乘车人失败",
      cookies: jar,
    };
  }

  const list = res.data.data?.normal_passengers ?? [];
  if (!list.length) {
    return {
      ok: false,
      passengers: [],
      message: res.data.data?.exMsg ?? res.data.messages?.join(";") ?? "无乘车人或会话无效",
      cookies: jar,
    };
  }

  const passengers: PassengerDto[] = list.map((p) => {
    const id = p.passenger_id_no ?? "";
    return {
      passengerId: p.passenger_id ?? p.allEncStr ?? id,
      name: p.passenger_name ?? "",
      idType: p.passenger_id_type_name ?? p.passenger_id_type_code ?? "1",
      idTypeCode: p.passenger_id_type_code,
      idNumberHint: id.length >= 4 ? `****${id.slice(-4)}` : undefined,
      idNumber: id || undefined,
      passengerType: p.passenger_type ?? p.passenger_type_name ?? "1",
      mobileHint: p.mobile_no ? `****${p.mobile_no.slice(-4)}` : undefined,
    };
  });

  return { ok: true, passengers, message: "ok", cookies: jar };
}

export { serializeCookies, parseSessionBlob, cookieHeader, encodeResumeToken, decodeResumeToken };
