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
