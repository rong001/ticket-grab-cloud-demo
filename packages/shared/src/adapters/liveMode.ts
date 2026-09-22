import type { Channel, ProviderMode, ShortlistItem, ShortlistResult } from "../types.js";

export function resolveProviderMode(inputMode?: ProviderMode): ProviderMode {
  return inputMode ?? (process.env.PROVIDER_MODE as ProviderMode) ?? "fixture";
}

export function isStrictLive(): boolean {
  return process.env.STRICT_LIVE === "1" || process.env.STRICT_LIVE === "true";
}

export class LiveProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly causeDetail?: string
  ) {
    super(`[STRICT_LIVE] ${provider}: ${message}${causeDetail ? ` (${causeDetail})` : ""}`);
    this.name = "LiveProviderError";
  }
}

export interface LiveAttempt<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** Build a ShortlistResult that never silently pretends fixture data is live. */
export function finalizeSearchResult(opts: {
  channel: Channel;
  provider: string;
  requestedMode: ProviderMode;
  live: LiveAttempt<ShortlistItem[]>;
  fixtureItems: ShortlistItem[];
  fixtureNotes: string;
}): ShortlistResult {
  const { channel, provider, requestedMode, live, fixtureItems, fixtureNotes } = opts;

  if (requestedMode !== "live") {
    return {
      channel,
      provider,
      mode: "fixture",
      liveOk: false,
      queriedAt: new Date().toISOString(),
      items: fixtureItems,
      notes: fixtureNotes,
    };
  }

  if (live.ok && live.data && live.data.length > 0) {
    return {
      channel,
      provider,
      mode: "live",
      liveOk: true,
      queriedAt: new Date().toISOString(),
      items: live.data,
      notes: `Live data from ${provider}.`,
    };
  }

  const reason = live.error ?? "Live provider returned no usable items";
  if (isStrictLive()) {
    throw new LiveProviderError(provider, "live fetch failed", reason);
  }

  return {
    channel,
    provider,
    mode: "fixture",
    liveOk: false,
    queriedAt: new Date().toISOString(),
    items: fixtureItems,
    notes: `实时源暂不可用：${reason}（已回退演示数据，非实时库存）`,
  };
}

export async function fetchText(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<{ ok: boolean; status: number; text: string; error?: string }> {
  const { timeoutMs = 12_000, ...rest } = init;
  try {
    const res = await fetch(url, {
      ...rest,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      text: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<{ ok: boolean; status: number; data?: T; error?: string; text?: string }> {
  const result = await fetchText(url, init);
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error: result.error ?? `HTTP ${result.status}`,
      text: result.text.slice(0, 400),
    };
  }
  try {
    return { ok: true, status: result.status, data: JSON.parse(result.text) as T };
  } catch {
    return {
      ok: false,
      status: result.status,
      error: "Response was not JSON",
      text: result.text.slice(0, 400),
    };
  }
}
