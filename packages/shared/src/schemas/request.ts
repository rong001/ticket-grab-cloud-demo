import { z } from "zod";

export const channelSchema = z.enum(["train", "show", "flight"]);

export const trainFieldsSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  timeWindow: z.string().optional(),
  seatClass: z.string().optional(),
  passengers: z.number().int().min(1).max(9).optional().default(1),
  fromCity: z.string().optional(),
  toCity: z.string().optional(),
});

export const showFieldsSchema = z.object({
  eventName: z.string().min(1),
  city: z.string().optional(),
  venue: z.string().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  saleOpenAt: z.string().optional(),
  tier: z.string().optional(),
  quantity: z.number().int().min(1).max(20).optional().default(1),
  performanceId: z.union([z.string(), z.number()]).optional(),
  detailUrl: z.string().url().optional(),
  category: z.string().optional(),
});

export const flightFieldsSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  returnDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  cabin: z.string().optional(),
  passengers: z.number().int().min(1).max(9).optional().default(1),
});

export const createRequestSchema = z.discriminatedUnion("channel", [
  z.object({
    channel: z.literal("train"),
    fields: trainFieldsSchema,
    notifyOnly: z.boolean().optional().default(true),
    notes: z.string().max(2000).optional(),
  }),
  z.object({
    channel: z.literal("show"),
    fields: showFieldsSchema,
    notifyOnly: z.boolean().optional().default(true),
    notes: z.string().max(2000).optional(),
  }),
  z.object({
    channel: z.literal("flight"),
    fields: flightFieldsSchema,
    notifyOnly: z.boolean().optional().default(true),
    notes: z.string().max(2000).optional(),
  }),
]);

/** Preferences for 定时抢票 — assistive watch only (no captcha/SMS bypass). */
export const watchPreferencesSchema = z
  .object({
    /** Train: preferred train numbers e.g. ["G102","D312"] */
    preferredTrains: z.array(z.string().min(1).max(32)).max(20).optional(),
    /** Train: preferred seat classes e.g. ["二等座","一等座"] */
    preferredSeats: z.array(z.string().min(1).max(32)).max(10).optional(),
    /** Show: preferred ticket tiers */
    preferredTiers: z.array(z.string().min(1).max(64)).max(10).optional(),
    /** Show: preferred session names / ids */
    preferredSessions: z.array(z.string().min(1).max(128)).max(20).optional(),
    /** Always notify on interesting diffs (default true) */
    notify: z.boolean().optional().default(true),
  })
  .optional();

export const watchRequestSchema = z.object({
  intervalMinutes: z.number().int().min(1).max(1440).default(15),
  endsAt: z.string().datetime().optional(),
  startsAt: z.string().datetime().optional(),
  /** Assistive auto-create awaiting_login order — never silent paid bypass */
  autoOrder: z.boolean().optional().default(false),
  preferences: watchPreferencesSchema,
  /** Saved traveler IDs bound to this watch/grab task (train-first multi-pax). */
  travelerIds: z.array(z.string().min(1).max(64)).max(9).optional(),
});

export type CreateRequestInput = z.infer<typeof createRequestSchema>;
export type WatchRequestInput = z.infer<typeof watchRequestSchema>;
export type WatchPreferences = NonNullable<z.infer<typeof watchPreferencesSchema>>;

/** Route channel to adapter provider id */
export function routeChannel(channel: z.infer<typeof channelSchema>): string {
  switch (channel) {
    case "train":
      return "train12306";
    case "show":
      return "show";
    case "flight":
      return "flight";
    default: {
      const _exhaustive: never = channel;
      throw new Error(`Unknown channel: ${_exhaustive}`);
    }
  }
}
