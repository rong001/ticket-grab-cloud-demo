import type { PlatformKind as ApiPlatform, OrderStatus as ApiOrderStatus } from "@ticket-grab/shared";

/** Prisma enum member ↔ API string for platforms (DB stores mapped '12306'). */
export type PrismaPlatform = "train12306" | "damai" | "maoyan" | "airline";
export type PrismaOrderStatus =
  | "draft"
  | "awaiting_login"
  | "submitting"
  | "awaiting_payment"
  | "paid"
  | "waitlist"
  | "failed"
  | "cancelled";

export function toPrismaPlatform(p: ApiPlatform): PrismaPlatform {
  if (p === "12306") return "train12306";
  return p;
}

export function fromPrismaPlatform(p: PrismaPlatform | string): ApiPlatform {
  if (p === "train12306" || p === "12306") return "12306";
  return p as ApiPlatform;
}

export function toPrismaOrderStatus(s: ApiOrderStatus): PrismaOrderStatus {
  if (s === "候补中") return "waitlist";
  return s as PrismaOrderStatus;
}

export function fromPrismaOrderStatus(s: PrismaOrderStatus | string): ApiOrderStatus {
  if (s === "waitlist" || s === "候补中") return "候补中";
  return s as ApiOrderStatus;
}
