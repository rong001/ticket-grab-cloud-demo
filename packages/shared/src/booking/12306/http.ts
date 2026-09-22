import type { CookieJar, FetchLike } from "./types.js";

export const KYFW = "https://kyfw.12306.cn";

export const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export function jarFromCookieHeader(header: string): CookieJar {
  const jar: CookieJar = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) jar[k] = v;
  }
  return jar;
}

export function parseSessionBlob(blob: string): CookieJar {
  const trimmed = blob.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const jar: CookieJar = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === "string") jar[k] = v;
        }
        return jar;
      }
    } catch {
      /* fall through */
    }
  }
  return jarFromCookieHeader(trimmed);
}

export function serializeCookies(jar: CookieJar): string {
  return JSON.stringify(jar);
}

export function cookieHeader(jar: CookieJar): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

export function mergeSetCookie(jar: CookieJar, res: Response): void {
  const raw =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie")!]
        : [];
  for (const line of raw) {
    const pair = line.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) {
      jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    }
  }
}

export function formBody(data: Record<string, string | number | undefined | null>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    params.set(k, String(v));
  }
  return params.toString();
}

export type HttpResult<T = unknown> = {
  ok: boolean;
  status: number;
  data?: T;
  text: string;
  error?: string;
  nonJson?: boolean;
};

export async function request12306<T = unknown>(
  fetchImpl: FetchLike,
  jar: CookieJar,
  url: string,
  init: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    referer?: string;
  } = {}
): Promise<HttpResult<T>> {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Origin: KYFW,
    Referer: init.referer ?? `${KYFW}/otn/leftTicket/init?linktypeid=dc`,
    "X-Requested-With": "XMLHttpRequest",
    ...(init.headers ?? {}),
  };
  const cookie = cookieHeader(jar);
  if (cookie) headers.Cookie = cookie;
  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
  }

  try {
    const res = await fetchImpl(url, {
      method,
      headers,
      body: init.body,
      signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
      redirect: "follow",
    });
    mergeSetCookie(jar, res);
    const text = await res.text();
    const trimmed = text.trim();
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        text: text.slice(0, 800),
        error: `HTTP ${res.status}`,
      };
    }
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return {
        ok: false,
        status: res.status,
        text: text.slice(0, 800),
        error: "12306 returned non-JSON (captcha/HTML/risk control)",
        nonJson: true,
      };
    }
    try {
      return { ok: true, status: res.status, data: JSON.parse(text) as T, text };
    } catch {
      return {
        ok: false,
        status: res.status,
        text: text.slice(0, 800),
        error: "JSON parse failed",
        nonJson: true,
      };
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      text: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Encode resume state (cookies + step) as base64url JSON — not a secret, just opaque to UI. */
export function encodeResumeToken(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeResumeToken(token: string): Record<string, unknown> | null {
  try {
    const json = Buffer.from(token, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function seatTypeCode(seatClass: string): string {
  const map: Record<string, string> = {
    商务座: "9",
    特等座: "P",
    一等座: "M",
    二等座: "O",
    高级软卧: "6",
    软卧: "4",
    动卧: "F",
    硬卧: "3",
    软座: "2",
    硬座: "1",
    无座: "1",
  };
  return map[seatClass] ?? map[seatClass.replace(/\s/g, "")] ?? "O";
}

export function idTypeCode(idType: string): string {
  const t = idType.toLowerCase();
  if (t === "id_card" || t === "1" || t.includes("身份证")) return "1";
  if (t === "passport" || t === "b" || t.includes("护照")) return "B";
  if (t === "gangao" || t === "c" || t.includes("港澳")) return "C";
  if (t === "taiwan" || t === "g" || t.includes("台")) return "G";
  return "1";
}
