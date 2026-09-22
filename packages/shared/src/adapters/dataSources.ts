import type { Channel, ProviderMode } from "../types.js";

export type ChannelDataStatus = {
  channel: Channel;
  /** Effective search mode for this channel given current env */
  mode: ProviderMode;
  /** Whether a live provider path is configured / reachable in principle */
  liveConfigured: boolean;
  /**
   * True only when an authorized inventory/fare source is configured
   * (Amadeus / Aviationstack / FLIGHT_PUBLIC_API_URL). OpenSky ADS-B alone is NOT inventory.
   */
  inventoryLive: boolean;
  /** True when a fare/price monitor source is configured (Amadeus shopping, etc.). */
  fareMonitor: boolean;
  /** Short label for UI: 实时 / 演示 / 需配置 / 不可用 */
  badge: "live" | "fixture" | "needs_keys" | "unavailable";
  labelZh: string;
  provider: string;
  notes: string;
};

/** Inventory/fare capable keys only — OpenSky ADS-B does not count. */
export function flightInventoryKeysConfigured(): boolean {
  if (process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET) return true;
  if (process.env.FLIGHT_API_KEY) return true;
  if (process.env.FLIGHT_PUBLIC_API_URL) return true;
  return false;
}

export function flightFareMonitorConfigured(): boolean {
  // Amadeus flight-offers is the only current fare-capable path.
  if (process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET) return true;
  // Custom public URL may return fares — treat as fare-capable when set.
  if (process.env.FLIGHT_PUBLIC_API_URL) return true;
  return false;
}

function flightLiveConfigured(): {
  configured: boolean;
  inventoryLive: boolean;
  fareMonitor: boolean;
  provider: string;
  notes: string;
  badge: ChannelDataStatus["badge"];
  labelZh: string;
} {
  const inventoryLive = flightInventoryKeysConfigured();
  const fareMonitor = flightFareMonitorConfigured();

  if (process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET) {
    return {
      configured: true,
      inventoryLive: true,
      fareMonitor: true,
      provider: "amadeus",
      notes: "Amadeus self-service shopping (AMADEUS_CLIENT_ID + AMADEUS_CLIENT_SECRET)",
      badge: "live",
      labelZh: "实时",
    };
  }
  if (process.env.FLIGHT_API_KEY) {
    return {
      configured: true,
      inventoryLive: true,
      fareMonitor: false,
      provider: "aviationstack",
      notes:
        "Aviationstack (FLIGHT_API_KEY) — schedule/status; fare monitor limited. Prefer Amadeus for bookable offers.",
      badge: "live",
      labelZh: "实时(时刻)",
    };
  }
  if (process.env.FLIGHT_PUBLIC_API_URL) {
    return {
      configured: true,
      inventoryLive: true,
      fareMonitor: true,
      provider: "flight_public",
      notes: `Custom FLIGHT_PUBLIC_API_URL=${process.env.FLIGHT_PUBLIC_API_URL}`,
      badge: "live",
      labelZh: "实时",
    };
  }
  if (process.env.FLIGHT_OPENSKY !== "0") {
    return {
      configured: true,
      inventoryLive: false,
      fareMonitor: false,
      provider: "opensky",
      notes:
        "OpenSky Network ADS-B only (no fares, no bookable inventory). 「实时可售票/票价监控不可用」. Set Amadeus/Aviationstack keys for inventory; FLIGHT_OPENSKY=0 to disable ADS-B fallback.",
      badge: "unavailable",
      labelZh: "实时可售票/票价监控不可用",
    };
  }
  return {
    configured: false,
    inventoryLive: false,
    fareMonitor: false,
    provider: "flight",
    notes:
      "No flight inventory API keys. 「实时可售票/票价监控不可用」. Set AMADEUS_CLIENT_ID+SECRET or FLIGHT_API_KEY, or FLIGHT_PUBLIC_API_URL. Query/official-redirect demo only.",
    badge: "needs_keys",
    labelZh: "实时可售票/票价监控不可用",
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
      inventoryLive: trainLive,
      fareMonitor: false,
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
      inventoryLive: showLive,
      fareMonitor: false,
      badge: showLive ? "live" : "fixture",
      labelZh: showLive ? "实时" : "演示",
      provider: "show",
      notes: showLive
        ? "Dianping/Gewara myshow public detail+shows+tickets (实时场次); optional SHOW_PUBLIC_API_URL override. Not Damai login APIs."
        : "Fixture sample Damai-style sessions (set PROVIDER_MODE=live)",
    },
    {
      channel: "flight",
      // OpenSky alone must not present as live inventory mode
      mode: mode === "live" && flight.inventoryLive ? "live" : mode === "live" ? "fixture" : "fixture",
      liveConfigured: flight.configured,
      inventoryLive: mode === "live" && flight.inventoryLive,
      fareMonitor: mode === "live" && flight.fareMonitor,
      badge:
        mode !== "live"
          ? "fixture"
          : flight.inventoryLive
            ? flight.badge
            : flight.badge === "needs_keys"
              ? "needs_keys"
              : "unavailable",
      labelZh:
        mode !== "live"
          ? "演示"
          : flight.inventoryLive
            ? flight.labelZh
            : "实时可售票/票价监控不可用",
      provider: flight.provider,
      notes: flight.notes,
    },
  ];
}

/** Aggregate honesty flags for /health and UI banners. */
export function describeFlightHonesty(opts?: { providerMode?: ProviderMode }): {
  flightInventoryLive: boolean;
  flightFareMonitor: boolean;
  flightProvider: string;
  flightLabelZh: string;
  flightNotes: string;
} {
  const channels = describeDataSources(opts);
  const flight = channels.find((c) => c.channel === "flight")!;
  return {
    flightInventoryLive: flight.inventoryLive,
    flightFareMonitor: flight.fareMonitor,
    flightProvider: flight.provider,
    flightLabelZh: flight.labelZh,
    flightNotes: flight.notes,
  };
}
