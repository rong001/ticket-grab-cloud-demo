/** Purchase-gate business codes (explicit — not every HTTP 403). */
export const PURCHASE_GATE_CODES = [
  "TRAIN_REAL_SUBMIT_DISABLED",
  "SHOW_AUTO_BUY_UNAVAILABLE",
  "FLIGHT_INVENTORY_UNAVAILABLE",
  "FLIGHT_AUTO_BUY_UNAVAILABLE",
] as const;

export type PurchaseGateCode = (typeof PURCHASE_GATE_CODES)[number];

export function isPurchaseGateCode(code: string | null | undefined): code is PurchaseGateCode {
  return !!code && (PURCHASE_GATE_CODES as readonly string[]).includes(code);
}

export type GateOffState = {
  code: string;
  nextSteps: string[];
  message: string;
};

/**
 * Map order detail gate/error to UI gate banner.
 * Keeps the *actual* gateCode (flight must not collapse into SHOW_AUTO_BUY_UNAVAILABLE).
 */
export function resolveGateOffFromOrderDetail(d: {
  errorMessage?: string | null;
  payload?: {
    nextSteps?: string[];
    notes?: string;
    gate?: { code?: string; trainRealSubmit?: boolean };
  };
}): GateOffState | null {
  const gateCode = d.payload?.gate?.code ?? d.errorMessage ?? undefined;
  const nextSteps = d.payload?.nextSteps ?? [];

  if (gateCode === "SHOW_AUTO_BUY_UNAVAILABLE") {
    return {
      code: "SHOW_AUTO_BUY_UNAVAILABLE",
      nextSteps,
      message:
        d.payload?.notes ??
        "真实大麦/猫眼下单 API 未接入；未自动购票、未谎报已支付。请用户登录官方完成支付。",
    };
  }
  if (
    gateCode === "FLIGHT_INVENTORY_UNAVAILABLE" ||
    gateCode === "FLIGHT_AUTO_BUY_UNAVAILABLE"
  ) {
    return {
      code: gateCode,
      nextSteps,
      message:
        d.payload?.notes ??
        "真实机票运价/库存 API 未接入；未自动购票、未谎报已支付。请配置授权运价并走官方支付。",
    };
  }
  if (
    gateCode === "TRAIN_REAL_SUBMIT_DISABLED" ||
    d.payload?.gate?.trainRealSubmit === false
  ) {
    return {
      code: "TRAIN_REAL_SUBMIT_DISABLED",
      nextSteps,
      message:
        d.payload?.notes ??
        "12306 协助提交未开启（TRAIN_REAL_SUBMIT=0），未产生真实占座/扣款。",
    };
  }
  return null;
}

/** Submit/handoff catch: only explicit gate codes open purchase-gate UI. */
export function resolveGateOffFromApiError(e: {
  code?: string;
  message: string;
  nextSteps?: string[];
  status?: number;
}): GateOffState | null {
  if (!isPurchaseGateCode(e.code)) return null;
  return {
    code: e.code,
    nextSteps: e.nextSteps ?? [],
    message: e.message,
  };
}

export function gateInfoBanner(code: string): string {
  if (code === "SHOW_AUTO_BUY_UNAVAILABLE") {
    return "演出自动购票不可用 — 仅草稿/官方手递，未谎报已支付。详见下方下一步。";
  }
  if (code === "FLIGHT_INVENTORY_UNAVAILABLE" || code === "FLIGHT_AUTO_BUY_UNAVAILABLE") {
    return "机票库存/运价未接入 — 仅草稿/官方手递，未谎报已支付。详见下方下一步。";
  }
  return "协助提交已拒绝（门禁关闭）— 详见下方下一步。订单未标记已支付。";
}
