import { toTravelerSummary } from "@ticket-grab/shared";
import { prisma } from "./prisma.js";

export type TravelerBindResult =
  | { ok: true; travelerIds: string[]; passengers: number | null }
  | { ok: false; error: string; status: number };

/**
 * Validate travelerIds belong to user; optionally reconcile with passengers count.
 * - If travelerIds provided and passengers set: lengths must match
 * - If travelerIds provided without passengers: passengers = length
 */
export async function resolveTravelerIdsForUser(opts: {
  userId: string;
  travelerIds?: string[] | null;
  passengers?: number | null;
}): Promise<TravelerBindResult> {
  const ids = Array.isArray(opts.travelerIds)
    ? [...new Set(opts.travelerIds.filter(Boolean))]
    : [];
  if (!ids.length) {
    return { ok: true, travelerIds: [], passengers: opts.passengers ?? null };
  }

  const rows = await prisma.traveler.findMany({
    where: { userId: opts.userId, id: { in: ids } },
    select: { id: true },
  });
  if (rows.length !== ids.length) {
    return { ok: false, error: "部分出行人/观演人不存在或不属于当前用户", status: 400 };
  }

  if (opts.passengers != null && opts.passengers > 0 && ids.length !== opts.passengers) {
    return {
      ok: false,
      error: `出行人/观演人数量（${ids.length}）与人数（${opts.passengers}）不一致`,
      status: 400,
    };
  }

  return {
    ok: true,
    travelerIds: ids,
    passengers: opts.passengers != null && opts.passengers > 0 ? opts.passengers : ids.length,
  };
}

export async function travelerSummariesForIds(userId: string, travelerIds: string[]) {
  if (!travelerIds?.length) return [];
  const rows = await prisma.traveler.findMany({
    where: { userId, id: { in: travelerIds } },
    select: { id: true, name: true, idNumberHint: true, relationship: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return travelerIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((r) => toTravelerSummary(r!));
}
