/**
 * Assistive 12306 client types.
 * Legal assistive only — user’s own credentials; official endpoints; no captcha farms.
 */

export type CookieJar = Record<string, string>;

export type LoginChallenge =
  | { kind: "captcha"; imageBase64?: string; message: string }
  | { kind: "sms"; message: string; mobileHint?: string }
  | { kind: "face"; message: string };

export type LoginResult =
  | {
      status: "ok";
      cookies: CookieJar;
      username?: string;
      message: string;
    }
  | {
      status: "needCaptcha" | "needSms" | "needFace";
      cookies: CookieJar;
      challenge: LoginChallenge;
      message: string;
      /** Opaque resume token for continue endpoints (cookie jar + step). */
      resumeToken: string;
    }
  | {
      status: "fail";
      cookies: CookieJar;
      message: string;
      errorCode?: string | number;
    };

export type SessionValidation =
  | { ok: true; username?: string; cookies: CookieJar }
  | { ok: false; reason: string; cookies: CookieJar };

export interface PassengerDto {
  passengerId: string;
  name: string;
  idType: string;
  idTypeCode?: string;
  idNumberHint?: string;
  /** Full id only when available from session — never log. */
  idNumber?: string;
  passengerType: string;
  mobileHint?: string;
}

export interface TrainSubmitRequest {
  cookies: CookieJar;
  /** Secret string from left-ticket row (parts[0]) when available. */
  secretStr?: string;
  trainNo: string;
  fromStation: string;
  toStation: string;
  fromTelecode?: string;
  toTelecode?: string;
  trainDate: string;
  seatType: string;
  passengers: Array<{
    name: string;
    idType: string;
    idNumber: string;
    passengerType?: "adult" | "child";
    mobile?: string;
  }>;
  /** When true, stop before confirmSingleForQueue / final commit. */
  dryRun?: boolean;
  purposeCodes?: string;
}

export type TrainSubmitResult =
  | {
      status: "awaiting_payment";
      externalOrderId: string;
      amount?: number;
      currency: "CNY";
      payDeadline?: string;
      paymentUrl?: string;
      cookies: CookieJar;
      confirmation: {
        confirmed: true;
        source: "live_session";
        fields: Record<string, unknown>;
      };
      message: string;
    }
  | {
      status: "候补中";
      externalOrderId?: string;
      cookies: CookieJar;
      confirmation: {
        confirmed: true;
        source: "live_session";
        fields: Record<string, unknown>;
      };
      message: string;
    }
  | {
      status: "dry_run_ok";
      cookies: CookieJar;
      prepared: Record<string, unknown>;
      message: string;
    }
  | {
      status: "needCaptcha" | "needSms" | "needFace" | "awaiting_login";
      cookies: CookieJar;
      challenge?: LoginChallenge;
      message: string;
      resumeToken?: string;
    }
  | {
      status: "failed";
      cookies: CookieJar;
      message: string;
      errorCode?: string;
    };

export interface OrderStatusQuery {
  cookies: CookieJar;
  externalOrderId?: string;
}

export type OrderStatusResult = {
  status: "awaiting_payment" | "paid" | "候补中" | "cancelled" | "unknown" | "failed";
  externalOrderId?: string;
  payDeadline?: string;
  amount?: number;
  message: string;
  confirmation?: {
    confirmed: boolean;
    source: "live_session" | "none";
    fields?: Record<string, unknown>;
  };
  cookies: CookieJar;
};

export type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;
