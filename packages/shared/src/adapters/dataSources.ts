import type { Channel, ProviderMode } from "../types.js";

export type ChannelDataStatus = {
  channel: Channel;
  /** Effective search mode for this channel given current env */
  mode: ProviderMode;
  /** Whether a live provider path is configured / reachable in principle */
  liveConfigured: boolean;
  /**
   * True ONLY when a sellable inventory/fare API is configured
   * (Amadeus Flight Offers / FLIGHT_PUBLIC_API_URL with bookable offers).
   * Aviationstack timetable, OpenSky ADS-B, and fixtures are NOT inventory.
   */
  inventoryLive: boolean;
  /**
   * True when a schedule/status/ADS-B/timetable source is **configured**
   * (Aviationstack, OpenSky, or inventory sources that also expose schedules).
   * Does NOT mean the last HTTP fetch succeeded — see scheduleLive.
   */
  scheduleConfigured: boolean;
  /**
   * True when the **last realtime schedule/ADS-B fetch in this process succeeded**.
   * Health/meta with no probe stay false; public search sets this from the current query.
   * Never infer from scheduleConfigured alone (OpenSky 429/404 → false).
   */
  scheduleLive: boolean;
  /** True when a fare/price monitor source is configured (Amadeus shopping, etc.). */
  fareMonitor: boolean;
  /** Short label for UI: 实时 / 演示 / 需配置 / 不可用 */
  badge: "live" | "fixture" | "needs_keys" | "unavailable";
  labelZh: string;
  provider: string;
  notes: string;
};

/** Sellable inventory/fare keys only — Aviationstack + OpenSky do NOT count. */
export function flightInventoryKeysConfigured(): boolean {
  if (process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET) return true;
  if (process.env.FLIGHT_PUBLIC_API_URL) return true;
  return false;
}

/** Schedule/status/ADS-B/timetable sources (not proof of sellable seats/fares). */
export function flightScheduleKeysConfigured(): boolean {
  if (process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET) return true;
  if (process.env.FLIGHT_API_KEY) return true;
  if (process.env.FLIGHT_PUBLIC_API_URL) return true;
  if (process.env.FLIGHT_OPENSKY !== "0") return true;
  return false;
}

export function flightFareMonitorConfigured(): boolean {
  // Amadeus flight-offers is the only current fare-capable path.
  if (process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET) return true;
  // Custom public URL may return fares — treat as fare-capable when set.
  if (process.env.FLIGHT_PUBLIC_API_URL) return true;
  return false;
}

/**
 * Process-local last flight schedule/ADS-B fetch outcome.
 * Updated by flight adapter / public search; health reads this so it never
 * claims scheduleLive=true merely because OpenSky/Aviationstack is configured.
 */
let lastFlightScheduleFetchOk = false;
let lastFlightScheduleFetchAt: string | null = null;

export function recordFlightScheduleFetch(ok: boolean): void {
  lastFlightScheduleFetchOk = ok === true;
  lastFlightScheduleFetchAt = new Date().toISOString();
}

export function getLastFlightScheduleFetch(): { ok: boolean; at: string | null } {
  return { ok: lastFlightScheduleFetchOk, at: lastFlightScheduleFetchAt };
}

/** Test helper — reset process-local schedule fetch probe state. */
export function resetFlightScheduleFetchForTests(): void {
  lastFlightScheduleFetchOk = false;
  lastFlightScheduleFetchAt = null;
}

function flightLiveConfigured(): {
  configured: boolean;
  inventoryLive: boolean;
  scheduleConfigured: boolean;
  fareMonitor: boolean;
  provider: string;
  notes: string;
  badge: ChannelDataStatus["badge"];
  labelZh: string;
} {
  if (process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET) {
    return {
      configured: true,
      inventoryLive: true,
      scheduleConfigured: true,
      fareMonitor: true,
      provider: "amadeus",
      notes: "Amadeus Self-Service Flight Offers (AMADEUS_CLIENT_ID + AMADEUS_CLIENT_SECRET) — bookable offers + fares.",
      badge: "live",
      labelZh: "实时",
    };
  }
  if (process.env.FLIGHT_PUBLIC_API_URL) {
    return {
      configured: true,
      inventoryLive: true,
      scheduleConfigured: true,
      fareMonitor: true,
      provider: "flight_public",
      notes: `Custom FLIGHT_PUBLIC_API_URL=${process.env.FLIGHT_PUBLIC_API_URL} (treated as inventory/fare when it returns bookable offers).`,
      badge: "live",
      labelZh: "实时",
    };
  }
  if (process.env.FLIGHT_API_KEY) {
    return {
      configured: true,
      inventoryLive: false,
      scheduleConfigured: true,
      fareMonitor: false,
      provider: "aviationstack",
      notes:
        "Aviationstack (FLIGHT_API_KEY) — schedule/status ONLY. No reliable fares or sellable inventory. flightScheduleConfigured may be true; flightScheduleLive follows last successful fetch (not config alone). Prefer Amadeus Flight Offers for inventoryLive.",
      badge: "unavailable",
      labelZh: "实时可售票/票价监控不可用",
    };
  }
  if (process.env.FLIGHT_OPENSKY !== "0") {
    return {
      configured: true,
      inventoryLive: false,
      scheduleConfigured: true,
      fareMonitor: false,
      provider: "opensky",
      notes:
        "OpenSky Network ADS-B only (no fares, no bookable inventory). 「实时可售票/票价监控不可用」. flightScheduleConfigured=true means ADS-B is enabled; flightScheduleLive is last successful fetch only (429/404 → false). Set AMADEUS_CLIENT_ID+SECRET for inventory; FLIGHT_OPENSKY=0 to disable ADS-B fallback.",
      badge: "unavailable",
      labelZh: "实时可售票/票价监控不可用",
    };
  }
  return {
    configured: false,
    inventoryLive: false,
    scheduleConfigured: false,
    fareMonitor: false,
    provider: "flight",
    notes:
      "No flight inventory or schedule API keys. 「实时可售票/票价监控不可用」. Set AMADEUS_CLIENT_ID+SECRET (inventory) or FLIGHT_API_KEY (schedule only).",
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
  const lastSched = getLastFlightScheduleFetch();

  const trainLive = mode === "live";
  const showLive = mode === "live";

  return [
    {
      channel: "train",
      mode: trainLive ? "live" : "fixture",
      liveConfigured: true,
      inventoryLive: trainLive,
      scheduleConfigured: trainLive,
      scheduleLive: trainLive,
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
      scheduleConfigured: showLive,
      scheduleLive: showLive,
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
      // Only inventory-capable sources present as live inventory mode
      mode: mode === "live" && flight.inventoryLive ? "live" : "fixture",
      liveConfigured: flight.configured,
      inventoryLive: mode === "live" && flight.inventoryLive,
      scheduleConfigured: mode === "live" && flight.scheduleConfigured,
      // Never claim live success from config alone — last process fetch only.
      scheduleLive: mode === "live" && flight.scheduleConfigured && lastSched.ok,
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
  /** Schedule/ADS-B source configured (OpenSky enabled or Aviationstack/Amadeus key). */
  flightScheduleConfigured: boolean;
  /**
   * Last successful realtime schedule fetch in this process.
   * False until a successful probe/search; false after 429/404/fail.
   */
  flightScheduleLive: boolean;
  flightFareMonitor: boolean;
  flightProvider: string;
  flightLabelZh: string;
  flightNotes: string;
  flightScheduleFetchAt: string | null;
} {
  const channels = describeDataSources(opts);
  const flight = channels.find((c) => c.channel === "flight")!;
  const last = getLastFlightScheduleFetch();
  return {
    flightInventoryLive: flight.inventoryLive,
    flightScheduleConfigured: flight.scheduleConfigured,
    flightScheduleLive: flight.scheduleLive,
    flightFareMonitor: flight.fareMonitor,
    flightProvider: flight.provider,
    flightLabelZh: flight.labelZh,
    flightNotes: flight.notes,
    flightScheduleFetchAt: last.at,
  };
}

/** Providers that may emit tickets_found / 可售 for flight watches. */
export function isFlightInventoryProvider(provider: string | undefined | null): boolean {
  const p = String(provider ?? "").toLowerCase();
  return p === "amadeus" || p === "flight_public";
}
