import type { Channel, ProviderMode } from "../types.js";

export type ChannelDataStatus = {
  channel: Channel;
  /** Effective search mode for this channel given current env */
  mode: ProviderMode;
  /** Whether a live provider path is configured / reachable in principle */
  liveConfigured: boolean;
  /** Short label for UI: 实时 / 演示 / 需配置 */
  badge: "live" | "fixture" | "needs_keys";
  labelZh: string;
  provider: string;
  notes: string;
};

function flightLiveConfigured(): { configured: boolean; provider: string; notes: string } {
  if (process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET) {
    return {
      configured: true,
      provider: "amadeus",
      notes: "Amadeus self-service (AMADEUS_CLIENT_ID + AMADEUS_CLIENT_SECRET)",
    };
  }
  if (process.env.FLIGHT_API_KEY) {
    return {
      configured: true,
      provider: "aviationstack",
      notes: "Aviationstack (FLIGHT_API_KEY)",
    };
  }
  if (process.env.FLIGHT_PUBLIC_API_URL) {
    return {
      configured: true,
      provider: "flight_public",
      notes: `Custom FLIGHT_PUBLIC_API_URL=${process.env.FLIGHT_PUBLIC_API_URL}`,
    };
  }
  if (process.env.FLIGHT_OPENSKY !== "0") {
    return {
      configured: true,
      provider: "opensky",
      notes:
        "OpenSky Network free fallback (no prices; ADS-B departures). Set FLIGHT_OPENSKY=0 to disable. Prefer Amadeus/Aviationstack for booking-quality data.",
    };
  }
  return {
    configured: false,
    provider: "flight",
    notes:
      "No flight API keys. Set AMADEUS_CLIENT_ID+SECRET or FLIGHT_API_KEY (Aviationstack), or FLIGHT_PUBLIC_API_URL. See README「5 分钟启用实时机票」.",
  };
}

export function describeDataSources(opts?: {
  providerMode?: ProviderMode;
  bookingStub?: boolean;
}): ChannelDataStatus[] {
  const mode = opts?.providerMode ?? ((process.env.PROVIDER_MODE as ProviderMode) || "fixture");
  const flight = flightLiveConfigured();

  const trainLive = mode === "live";
  const showLive = mode === "live";

  return [
    {
      channel: "train",
      mode: trainLive ? "live" : "fixture",
      liveConfigured: true,
      badge: trainLive ? "live" : "fixture",
      labelZh: trainLive ? "实时" : "演示",
      provider: "train12306",
      notes: trainLive
        ? "12306 public left-ticket query (kyfw.12306.cn)"
        : "Fixture sample trains (set PROVIDER_MODE=live)",
    },
    {
      channel: "show",
      mode: showLive ? "live" : "fixture",
      liveConfigured: true,
      badge: showLive ? "live" : "fixture",
      labelZh: showLive ? "实时" : "演示",
      provider: "show",
      notes: showLive
        ? "Dianping/Gewara myshow public detail+shows+tickets (实时场次); optional SHOW_PUBLIC_API_URL override. Not Damai login APIs."
        : "Fixture sample Damai-style sessions (set PROVIDER_MODE=live)",
    },
    {
      channel: "flight",
      mode: mode === "live" && flight.configured ? "live" : "fixture",
      liveConfigured: flight.configured,
      badge:
        mode !== "live"
          ? "fixture"
          : flight.configured
            ? "live"
            : "needs_keys",
      labelZh:
        mode !== "live" ? "演示" : flight.configured ? "实时" : "需配置",
      provider: flight.provider,
      notes: flight.notes,
    },
  ];
}
