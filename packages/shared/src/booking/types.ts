import type { Channel, ShortlistItem } from "../types.js";
import type { OrderStatus, PlatformKind } from "../schemas/order.js";

export interface TravelerRef {
  id: string;
  name: string;
  idType: string;
  /** Hint only — never full id in booking logs. */
  idNumberHint?: string;
  /** Full ID for live 12306 submit only — never log. */
  idNumber?: string;
  phone?: string;
  type: "adult" | "child";
}

export interface SessionContext {
  platform: PlatformKind;
  sessionStatus: "unlinked" | "needs_browser_login" | "linked" | "expired";
  hasEncryptedSession: boolean;
  lastVerifiedAt?: string | null;
  /**
   * Decrypted cookie jar or cookie header — server-side only for live submit.
   * Prefer JSON CookieJar from serializeCookies().
   */
  cookies?: string | Record<string, string>;
}

export interface PrepareCheckoutInput {
  channel: Channel;
  orderId: string;
  shortlistItem: ShortlistItem | Record<string, unknown>;
  travelers: TravelerRef[];
  session: SessionContext;
  /** Public web origin for in-product handoff pages. */
  webBaseUrl: string;
}

export interface PrepareCheckoutResult {
  status: OrderStatus;
  nextSteps: string[];
  checkoutPath: string;
  notes: string;
  requiresInteractiveLogin: boolean;
}

export interface SubmitOrderInput extends PrepareCheckoutInput {
  /** When PROVIDER_MODE=fixture or BOOKING_STUB=1, allow stub progress with fake confirmation. */
  stubMode?: boolean;
  /** Stop before final 12306 confirm (env TRAIN_BOOKING_DRY_RUN=1 also sets this). */
  dryRun?: boolean;
}

export interface SubmitOrderResult {
  status: OrderStatus;
  externalOrderId?: string;
  amount?: number;
  currency?: string;
  paymentPath?: string;
  paymentUrl?: string;
  payDeadline?: string;
  nextSteps: string[];
  notes: string;
  /** Present only when a real or stub confirmation was obtained. */
  confirmation?: {
    confirmed: boolean;
    source: "live_session" | "stub" | "none";
    fields?: Record<string, unknown>;
  };
  errorMessage?: string;
  /** Updated cookies to re-encrypt into PlatformCredential after live calls. */
  cookiesToPersist?: string;
  interaction?: {
    type: "captcha" | "sms" | "face";
    message: string;
    imageBase64?: string;
    resumeToken?: string;
  };
}

export interface QueryOrderStatusInput {
  channel: Channel;
  orderId: string;
  externalOrderId?: string | null;
  session: SessionContext;
  stubMode?: boolean;
  currentStatus: OrderStatus;
}

export interface QueryOrderStatusResult {
  status: OrderStatus;
  externalOrderId?: string;
  amount?: number;
  payDeadline?: string;
  notes: string;
  confirmation?: {
    confirmed: boolean;
    source: "live_session" | "stub" | "none";
    fields?: Record<string, unknown>;
  };
  cookiesToPersist?: string;
}

export interface BookingAdapter {
  channel: Channel;
  prepareCheckout(input: PrepareCheckoutInput): Promise<PrepareCheckoutResult>;
  submitOrder(input: SubmitOrderInput): Promise<SubmitOrderResult>;
  queryOrderStatus(input: QueryOrderStatusInput): Promise<QueryOrderStatusResult>;
}
