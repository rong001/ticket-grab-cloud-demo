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

/** Stable machine-readable code when assistive 12306 submit is gated off. */
export const TRAIN_REAL_SUBMIT_DISABLED_CODE = "TRAIN_REAL_SUBMIT_DISABLED" as const;

/**
 * Honest next steps when TRAIN_REAL_SUBMIT is off.
 * No real seat-hold / charge — user must login, captcha, enable gate, pay officially.
 */
export function trainRealSubmitDisabledNextSteps(): string[] {
  return [
    "在「账号绑定」(/accounts) 关联本人 12306 会话（用户名/密码）",
    "如出现验证码/短信/人脸，请在站内引导步骤手动完成（本站不会自动打码或绕过）",
    "由管理员将环境变量 TRAIN_REAL_SUBMIT=1 开启后，才允许协助提交",
    "提交成功后请在官方 12306 收银台完成支付（本站不代收票款、不产生真实占座/扣款）",
    "乘车人请在「乘车人」(/travelers) 维护；订单须绑定 travelerIds",
  ];
}

/** Stable machine-readable code when Damai/Maoyan auto-buy is unavailable. */
export const SHOW_AUTO_BUY_UNAVAILABLE_CODE = "SHOW_AUTO_BUY_UNAVAILABLE" as const;

/**
 * Honest next steps when show auto-buy API is not integrated.
 * Never mark paid — user must login + pay on official Damai/Maoyan.
 */
export function showAutoBuyUnavailableNextSteps(): string[] {
  return [
    "在「账号绑定」(/accounts) 关联本人大麦或猫眼会话（待用户登录官方）",
    "如出现验证码/风控/短信，请在官方 App 或站内引导步骤手动完成（本站不会自动打码或绕过）",
    "真实大麦/猫眼下单 API 未接入：本站仅创建草稿并做官方收银台手递，不自动购票",
    "支付仅在官方大麦/猫眼收银台完成（待用户登录官方 · 本站不代收票款、不谎报已支付）",
    "观演人请在「出行人/观演人」(/travelers) 维护；订单须绑定 travelerIds",
  ];
}

/** Stable machine-readable code when flight fare/inventory API is not configured. */
export const FLIGHT_INVENTORY_UNAVAILABLE_CODE = "FLIGHT_INVENTORY_UNAVAILABLE" as const;

/** Alias for handoff/docs — same gate as inventory unavailable (no auto-buy). */
export const FLIGHT_AUTO_BUY_UNAVAILABLE_CODE = "FLIGHT_AUTO_BUY_UNAVAILABLE" as const;

/**
 * Honest next steps when Amadeus / authorized fare inventory is not integrated.
 * OpenSky / Aviationstack schedule must NEVER be treated as sellable inventory.
 * Never mark paid — user must configure fare API + airline login + official pay.
 */
export function flightInventoryUnavailableNextSteps(): string[] {
  return [
    "配置已授权的机票运价/库存 API（如 Amadeus Flight Offers 或 FLIGHT_PUBLIC_API_URL；OpenSky/Aviationstack 仅为航班动态，不可售）",
    "在「账号绑定」(/accounts) 关联本人航司/OTA 会话（待用户登录官方）",
    "如出现验证码/风控/短信，请在官方 App 或站内引导步骤手动完成（本站不会自动打码或绕过）",
    "真实机票自动下单未接入（FLIGHT_INVENTORY_UNAVAILABLE / FLIGHT_AUTO_BUY_UNAVAILABLE）：本站仅创建草稿并做官方收银台手递，不自动购票",
    "支付仅在官方航司/OTA 收银台完成（待用户登录官方 · 本站不代收票款、不谎报已支付）",
    "乘机人请在「出行人/乘机人」(/travelers) 维护；订单须绑定 travelerIds",
  ];
}

