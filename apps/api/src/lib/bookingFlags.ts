import { describeFlightHonesty } from "@ticket-grab/shared";
import { env } from "../env.js";

/**
 * Honest booking / query capability flags for /health and UI.
 *
 * Historical bug: `realTrainSubmit` was computed as `!bookingStub` (apps/api/src/app.ts),
 * which lit up whenever BOOKING_STUB=0 even though that only means "not using stub
 * confirmations". Live public left-ticket query (PROVIDER_MODE=live) is NOT an
 * authorized auto-buy license.
 *
 * TRAIN_REAL_SUBMIT must be explicitly "1" to allow assistive 12306 submit
 * (POST /orders/:id/submit → submitTrainOrder → confirmSingleForQueue). Default OFF.
 * Legacy alias: TRAIN_SUBMIT_ENABLED=1 (same meaning).
 */
export type BookingFlags = {
  providerMode: "live" | "fixture";
  /** True when booking adapter returns stub/fake confirmations. */
  bookingStub: boolean;
  /** Stop before final 12306 confirmSingleForQueue. */
  trainBookingDryRun: boolean;
  /** PROVIDER_MODE=live — public left-ticket / catalog query path. */
  trainLiveQuery: boolean;
  /** Explicit opt-in for assistive 12306 order submit. Default false. */
  trainRealSubmit: boolean;
  /**
   * @deprecated Same as trainRealSubmit.
   * Previously meant !bookingStub only — that was misleading for ToC honesty.
   */
  realTrainSubmit: boolean;
  /** True only with Amadeus Flight Offers / FLIGHT_PUBLIC_API_URL — not Aviationstack/OpenSky. */
  flightInventoryLive: boolean;
  /** True when schedule/status/ADS-B/timetable source is configured (not last-fetch success). */
  flightScheduleConfigured: boolean;
  /**
   * True only after a successful realtime schedule fetch in this process.
   * Config alone (OpenSky enabled) must NOT set this — 429/404 leave it false.
   */
  flightScheduleLive: boolean;
  /** True when a fare/price monitor source is configured. */
  flightFareMonitor: boolean;
  flightProvider: string;
  flightLabelZh: string;
  flightNotes: string;
  flightScheduleFetchAt: string | null;
};

function envFlagOn(...names: string[]): boolean {
  for (const n of names) {
    if (process.env[n] === "1") return true;
  }
  return false;
}

export function resolveBookingFlags(): BookingFlags {
  let bookingStub =
    env.providerMode === "fixture" || process.env.BOOKING_STUB === "1";
  if (process.env.BOOKING_STUB === "0") bookingStub = false;

  const trainBookingDryRun = process.env.TRAIN_BOOKING_DRY_RUN === "1";
  const trainRealSubmit = envFlagOn("TRAIN_REAL_SUBMIT", "TRAIN_SUBMIT_ENABLED");
  const trainLiveQuery = env.providerMode === "live";
  const flight = describeFlightHonesty({ providerMode: env.providerMode });

  return {
    providerMode: env.providerMode,
    bookingStub,
    trainBookingDryRun,
    trainLiveQuery,
    trainRealSubmit,
    realTrainSubmit: trainRealSubmit && !bookingStub,
    flightInventoryLive: flight.flightInventoryLive,
    flightScheduleConfigured: flight.flightScheduleConfigured,
    flightScheduleLive: flight.flightScheduleLive,
    flightFareMonitor: flight.flightFareMonitor,
    flightProvider: flight.flightProvider,
    flightLabelZh: flight.flightLabelZh,
    flightNotes: flight.flightNotes,
    flightScheduleFetchAt: flight.flightScheduleFetchAt,
  };
}

export function stubMode(): boolean {
  return resolveBookingFlags().bookingStub;
}

export function dryRunMode(): boolean {
  return resolveBookingFlags().trainBookingDryRun;
}

/** Assistive 12306 submit allowed only when TRAIN_REAL_SUBMIT=1 (default off). */
export function trainRealSubmitEnabled(): boolean {
  return resolveBookingFlags().trainRealSubmit;
}
