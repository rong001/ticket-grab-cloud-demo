/** Soft cap on concurrent non-terminal watches per user (no new microservice). */
export const MAX_ACTIVE_WATCHES_PER_USER = 10;

/** Statuses that occupy a concurrent-watch slot (paused still holds a slot until cancel). */
export const ACTIVE_WATCH_STATUSES = [
  "queued",
  "querying",
  "has_tickets",
  "notified",
  "pending",
  "active",
  "paused",
] as const;

export type ActiveWatchStatus = (typeof ACTIVE_WATCH_STATUSES)[number];

export function isActiveWatchStatus(status: string): boolean {
  return (ACTIVE_WATCH_STATUSES as readonly string[]).includes(status);
}
