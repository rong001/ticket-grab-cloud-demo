import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

/** Best-effort activity log — never throws to callers. */
export async function logActivity(
  userId: string,
  email: string,
  action: string,
  summary: string,
  meta?: Record<string, unknown> | null
): Promise<void> {
  try {
    await prisma.userActivity.create({
      data: {
        userId,
        userEmail: email,
        action,
        summary,
        meta: meta != null ? (meta as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch (err) {
    console.warn("[activity] log failed:", err instanceof Error ? err.message : err);
  }
}
