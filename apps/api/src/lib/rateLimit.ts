/**
 * Simple sliding-window rate limiter (in-memory, per process).
 * Optional Redis backend when RATE_LIMIT_REDIS=1.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { getRedis } from "./queue.js";

type Bucket = { timestamps: number[] };

const memory = new Map<string, Bucket>();

export interface RateLimitOpts {
  /** Max requests in the window */
  max: number;
  /** Window length in ms */
  windowMs: number;
  /** Key prefix for namespacing */
  name: string;
  /** Extract client key (default: IP) */
  keyFn?: (req: FastifyRequest) => string;
}

function clientKey(req: FastifyRequest): string {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0]!.trim();
  return req.ip || "unknown";
}

async function hitMemory(key: string, max: number, windowMs: number): Promise<{ ok: boolean; remaining: number }> {
  const now = Date.now();
  let bucket = memory.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    memory.set(key, bucket);
  }
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
  if (bucket.timestamps.length >= max) {
    return { ok: false, remaining: 0 };
  }
  bucket.timestamps.push(now);
  return { ok: true, remaining: Math.max(0, max - bucket.timestamps.length) };
}

async function hitRedis(key: string, max: number, windowMs: number): Promise<{ ok: boolean; remaining: number }> {
  const redis = getRedis();
  const now = Date.now();
  const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  const pipe = redis.pipeline();
  pipe.zremrangebyscore(key, 0, now - windowMs);
  pipe.zadd(key, now, member);
  pipe.zcard(key);
  pipe.pexpire(key, windowMs);
  const results = await pipe.exec();
  const count = Number(results?.[2]?.[1] ?? 0);
  if (count > max) {
    await redis.zrem(key, member);
    return { ok: false, remaining: 0 };
  }
  return { ok: true, remaining: Math.max(0, max - count) };
}

export function rateLimit(opts: RateLimitOpts) {
  const keyFn = opts.keyFn ?? clientKey;
  const useRedis = process.env.RATE_LIMIT_REDIS === "1" || process.env.RATE_LIMIT_REDIS === "true";

  return async function rateLimitHook(req: FastifyRequest, reply: FastifyReply) {
    const key = `rl:${opts.name}:${keyFn(req)}`;
    const result = useRedis
      ? await hitRedis(key, opts.max, opts.windowMs).catch(() => hitMemory(key, opts.max, opts.windowMs))
      : await hitMemory(key, opts.max, opts.windowMs);

    reply.header("X-RateLimit-Limit", String(opts.max));
    reply.header("X-RateLimit-Remaining", String(result.remaining));

    if (!result.ok) {
      return reply.code(429).send({ error: "Too many requests, please retry later" });
    }
  };
}

/** Clear in-memory buckets (tests). */
export function resetRateLimits() {
  memory.clear();
}
