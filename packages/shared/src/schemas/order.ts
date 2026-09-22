import { z } from "zod";
import { channelSchema } from "./request.js";

export const orderStatusSchema = z.enum([
  "draft",
  "awaiting_login",
  "submitting",
  "awaiting_payment",
  "paid",
  "候补中",
  "failed",
  "cancelled",
]);

export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const createOrderSchema = z.object({
  selectedShortlistItemId: z.string().min(1),
  travelerIds: z.array(z.string().min(1)).min(1).max(9),
  /** Optional snapshot of the shortlist item (client may pass; server prefers DB snapshot). */
  shortlistItem: z.record(z.unknown()).optional(),
  /** Show channel: prefer damai or maoyan session when both linked. */
  preferredPlatform: z.enum(["12306", "damai", "maoyan", "airline"]).optional(),
});

export const paymentHandoffSchema = z.object({
  /** Client can acknowledge return from payment. */
  acknowledge: z.boolean().optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/** Create draft order from a WatchJob (grab) — no submit / charge. */
export const createWatchOrderSchema = z.object({
  /** Optional; when omitted, server picks latest shortlist item matching watch preferences. */
  selectedShortlistItemId: z.string().min(1).optional(),
});

export type CreateWatchOrderInput = z.infer<typeof createWatchOrderSchema>;


/** Allowed transitions for the assistive order state machine. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ["awaiting_login", "submitting", "cancelled", "failed"],
  awaiting_login: ["submitting", "cancelled", "failed"],
  submitting: ["awaiting_payment", "候补中", "awaiting_login", "failed", "cancelled"],
  awaiting_payment: ["paid", "failed", "cancelled"],
  paid: [],
  候补中: ["awaiting_payment", "paid", "failed", "cancelled"],
  failed: ["draft", "cancelled"],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`非法订单状态流转: ${from} → ${to}`);
  }
}

export const platformKindSchema = z.enum(["12306", "damai", "maoyan", "airline"]);
export type PlatformKind = z.infer<typeof platformKindSchema>;

export function channelToPlatform(channel: z.infer<typeof channelSchema>): PlatformKind {
  switch (channel) {
    case "train":
      return "12306";
    case "show":
      return "damai";
    case "flight":
      return "airline";
    default: {
      const _e: never = channel;
      throw new Error(`Unknown channel: ${_e}`);
    }
  }
}

export const linkStartSchema = z.object({
  platform: platformKindSchema,
  displayName: z.string().max(64).optional(),
});

export const linkCompleteSchema = z.object({
  platform: platformKindSchema,
  /** Session token / cookie string from in-app WebView handoff — stored encrypted. */
  sessionToken: z.string().min(1).max(65536).optional(),
  vaultRef: z.string().min(1).max(256).optional(),
  displayName: z.string().max(64).optional(),
  /** If true, mark needs_browser_login instead of linked. */
  needsBrowserLogin: z.boolean().optional(),
});

export type LinkCompleteInput = z.infer<typeof linkCompleteSchema>;

/** Platforms that may hold a session for a given channel (show accepts damai or maoyan). */
export function platformsForChannel(
  channel: z.infer<typeof channelSchema>
): PlatformKind[] {
  switch (channel) {
    case "train":
      return ["12306"];
    case "show":
      return ["damai", "maoyan"];
    case "flight":
      return ["airline"];
    default: {
      const _e: never = channel;
      throw new Error(`Unknown channel: ${_e}`);
    }
  }
}

/** Real 12306 username/password login (assistive; never logged by API). */
export const train12306LoginSchema = z.object({
  username: z.string().min(2).max(64),
  password: z.string().min(1).max(128),
  captchaAnswer: z.string().max(256).optional(),
  displayName: z.string().max(64).optional(),
});

export const train12306ContinueSchema = z.object({
  resumeToken: z.string().min(1).max(65536),
  captchaAnswer: z.string().max(256).optional(),
  smsCode: z.string().max(16).optional(),
  displayName: z.string().max(64).optional(),
});

export type Train12306LoginInput = z.infer<typeof train12306LoginSchema>;
export type Train12306ContinueInput = z.infer<typeof train12306ContinueSchema>;
