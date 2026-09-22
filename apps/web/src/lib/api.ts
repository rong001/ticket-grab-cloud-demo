const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("tg_token");
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem("tg_token", token);
  else localStorage.removeItem("tg_token");
}

/** Structured API failure (e.g. TRAIN_REAL_SUBMIT_DISABLED 403). */
export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    const msg =
      (typeof body.message === "string" && body.message) ||
      (typeof body.error === "string" && body.error) ||
      `HTTP ${status}`;
    super(msg);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  get code(): string | undefined {
    return typeof this.body.code === "string" ? this.body.code : undefined;
  }

  get nextSteps(): string[] {
    const ns = this.body.nextSteps;
    return Array.isArray(ns) ? ns.filter((s): s is string => typeof s === "string") : [];
  }
}

export async function api<T>(
  path: string,
  opts: RequestInit & { auth?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string>),
  };
  if (opts.body !== undefined && opts.body !== null) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
  }
  if (opts.auth !== false) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_URL}${path}`, { ...opts, headers });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}
