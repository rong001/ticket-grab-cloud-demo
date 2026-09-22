import { createHash } from "crypto";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../env.js";

export const WATCH_QUEUE = "watch-jobs";

let connection: Redis | null = null;
let watchQueue: Queue | null = null;

export function getRedis(): Redis {
  if (!connection) {
    connection = new Redis(env.redisUrl, { maxRetriesPerRequest: null });
  }
  return connection;
}

export function getWatchQueue(): Queue {
  if (!watchQueue) {
    watchQueue = new Queue(WATCH_QUEUE, { connection: getRedis() });
  }
  return watchQueue;
}

export interface WatchJobPayload {
  watchJobId: string;
  requestId: string;
  userId: string;
}

/** BullMQ 5 hashes `name:jobId:endDate:tz:every` — keys do not embed the cuid. */
export function watchRepeatHash(
  watchJobId: string,
  intervalMinutes: number,
  endsAt?: Date | string | null
): string {
  const every = Math.max(1, intervalMinutes) * 60_000;
  const endDate = endsAt ? new Date(endsAt).getTime() : "";
  const concat = `watch:${watchJobId}:${endDate}::${every}`;
  return createHash("md5").update(concat).digest("hex");
}

export type RemoveWatchRepeatableResult = {
  removedRepeatableKeys: string[];
  removedJobIds: string[];
  removeRepeatableOk: boolean;
};

/**
 * Fully remove a watch's BullMQ repeatable + any delayed/waiting instances.
 * Matches by (1) removeRepeatable(name, every[+endDate], jobId),
 * (2) recomputed hash key, (3) Redis hash `data.watchJobId`,
 * (4) scanning delayed/waiting/active jobs for payload.watchJobId.
 */
export async function removeWatchRepeatable(job: {
  id: string;
  intervalMinutes: number;
  endsAt?: Date | string | null;
  bullJobId?: string | null;
}): Promise<RemoveWatchRepeatableResult> {
  const queue = getWatchQueue();
  const redis = getRedis();
  const removedRepeatableKeys: string[] = [];
  const removedJobIds: string[] = [];
  let removeRepeatableOk = false;

  const every = Math.max(1, job.intervalMinutes) * 60_000;
  const repeatOpts: { every: number; endDate?: number } = { every };
  if (job.endsAt) {
    repeatOpts.endDate = new Date(job.endsAt).getTime();
  }

  try {
    removeRepeatableOk = Boolean(
      await queue.removeRepeatable("watch", repeatOpts, job.id)
    );
  } catch {
    removeRepeatableOk = false;
  }

  // Also try without endDate in case schedule was added without it
  if (!removeRepeatableOk && job.endsAt) {
    try {
      removeRepeatableOk = Boolean(
        await queue.removeRepeatable("watch", { every }, job.id)
      );
    } catch {
      /* ignore */
    }
  }

  const candidateHashes = new Set<string>([
    watchRepeatHash(job.id, job.intervalMinutes, job.endsAt ?? null),
    watchRepeatHash(job.id, job.intervalMinutes, null),
  ]);

  const repeatables = await queue.getRepeatableJobs();
  for (const r of repeatables) {
    let match =
      r.id === job.id ||
      (r.key != null && (r.key.includes(job.id) || candidateHashes.has(r.key)));

    if (!match && r.key) {
      try {
        const raw = await redis.hget(`bull:${WATCH_QUEUE}:repeat:${r.key}`, "data");
        if (raw) {
          const parsed = JSON.parse(raw) as { watchJobId?: string };
          if (parsed.watchJobId === job.id) match = true;
        }
      } catch {
        /* ignore */
      }
    }

    if (match && r.key) {
      try {
        await queue.removeRepeatableByKey(r.key);
        removedRepeatableKeys.push(r.key);
      } catch {
        /* may already be gone */
      }
    }
  }

  // Remove any already-enqueued instances (delayed repeat ticks, immediate, etc.)
  const states = ["delayed", "waiting", "active", "paused", "prioritized", "wait"] as const;
  try {
    const jobs = await queue.getJobs([...states], 0, 500);
    for (const j of jobs) {
      const data = j.data as WatchJobPayload | undefined;
      if (data?.watchJobId === job.id) {
        try {
          await j.remove();
          if (j.id) removedJobIds.push(String(j.id));
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* getJobs may fail on some states */
  }

  for (const maybeId of [job.bullJobId, job.id, `${job.id}-immediate`].filter(Boolean)) {
    try {
      await queue.remove(String(maybeId));
      removedJobIds.push(String(maybeId));
    } catch {
      /* may already be gone */
    }
  }

  return { removedRepeatableKeys, removedJobIds, removeRepeatableOk };
}

/** Operator hygiene: drop repeatables whose WatchJob is cancelled/completed/missing. */
export async function sweepOrphanWatchRepeatables(
  isAlive: (watchJobId: string) => Promise<boolean>
): Promise<{ scanned: number; removed: string[] }> {
  const queue = getWatchQueue();
  const redis = getRedis();
  const repeatables = await queue.getRepeatableJobs();
  const removed: string[] = [];
  for (const r of repeatables) {
    if (!r.key) continue;
    let watchJobId: string | undefined = r.id ?? undefined;
    try {
      const raw = await redis.hget(`bull:${WATCH_QUEUE}:repeat:${r.key}`, "data");
      if (raw) {
        watchJobId = (JSON.parse(raw) as { watchJobId?: string }).watchJobId ?? watchJobId;
      }
    } catch {
      /* ignore */
    }
    if (!watchJobId) continue;
    const alive = await isAlive(watchJobId);
    if (!alive) {
      try {
        await queue.removeRepeatableByKey(r.key);
        removed.push(r.key);
      } catch {
        /* ignore */
      }
    }
  }
  return { scanned: repeatables.length, removed };
}


/**
 * Read-only: does a BullMQ repeatable still exist for this watchJobId?
 * Safe to expose to the owning user (no Redis secrets / raw keys).
 */
export async function hasWatchRepeatable(watchJobId: string): Promise<boolean> {
  const queue = getWatchQueue();
  const redis = getRedis();
  const repeatables = await queue.getRepeatableJobs();
  for (const r of repeatables) {
    if (r.id === watchJobId) return true;
    if (r.key?.includes(watchJobId)) return true;
    if (!r.key) continue;

    // BullMQ 5: getRepeatableJobs leaves r.id undefined and Redis `data` may be empty.
    // Match via recomputed MD5(name:jobId:endDate:tz:every) === r.key.
    if (r.every != null) {
      const minutes = Math.max(1, Math.round(Number(r.every) / 60_000));
      if (watchRepeatHash(watchJobId, minutes, null) === r.key) return true;
      if (r.endDate) {
        const endMs = Number(r.endDate);
        if (
          Number.isFinite(endMs) &&
          watchRepeatHash(watchJobId, minutes, new Date(endMs)) === r.key
        ) {
          return true;
        }
      }
    }

    try {
      const raw = await redis.hget(`bull:${WATCH_QUEUE}:repeat:${r.key}`, "data");
      if (raw) {
        const parsed = JSON.parse(raw) as { watchJobId?: string };
        if (parsed.watchJobId === watchJobId) return true;
      }
    } catch {
      /* ignore */
    }
  }
  return false;
}


/** Test / shutdown helper — close BullMQ queue + shared Redis so Node can exit. */
export async function closeQueueConnections(): Promise<void> {
  try {
    if (watchQueue) {
      await watchQueue.close();
      watchQueue = null;
    }
  } catch {
    /* ignore */
  }
  try {
    if (connection) {
      connection.disconnect();
      connection = null;
    }
  } catch {
    /* ignore */
  }
}
