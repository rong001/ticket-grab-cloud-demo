import { PrismaClient } from "@prisma/client";
import { Worker, Queue } from "bullmq";
import { Redis } from "ioredis";
import { processWatchJob, type WatchJobPayload } from "./processor.js";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const prisma = new PrismaClient();

const QUEUE_NAME = "watch-jobs";

/** Re-enqueue durable watches after restart (DB is source of truth). */
async function rehydrateWatchJobs() {
  const queue = new Queue(QUEUE_NAME, { connection });
  const active = await prisma.watchJob.findMany({
    where: {
      status: {
        in: ["queued", "querying", "has_tickets", "notified", "pending", "active"],
      },
    },
    include: { request: { select: { userId: true } } },
  });
  console.log(`[rehydrate] found ${active.length} watch job(s) to restore`);
  for (const job of active) {
    const payload: WatchJobPayload = {
      watchJobId: job.id,
      requestId: job.requestId,
      userId: job.request.userId,
    };
    const intervalMs = Math.max(1, job.intervalMinutes) * 60_000;
    try {
      const repeatables = await queue.getRepeatableJobs();
      const redis = connection;
      for (const r of repeatables) {
        let match = r.id === job.id || (r.key?.includes(job.id) ?? false);
        if (!match && r.key) {
          try {
            const raw = await redis.hget(`bull:${QUEUE_NAME}:repeat:${r.key}`, "data");
            if (raw && JSON.parse(raw).watchJobId === job.id) match = true;
          } catch {
            /* ignore */
          }
        }
        if (match && r.key) {
          await queue.removeRepeatableByKey(r.key);
        }
      }
    } catch (err) {
      console.warn("[rehydrate] cleanup", job.id, err);
    }
    await queue.add("watch", payload, {
      jobId: job.id,
      repeat: { every: intervalMs },
    });
    const due = !job.startsAt || job.startsAt.getTime() <= Date.now();
    if (due) {
      await queue.add("watch-immediate", payload, {
        jobId: `${job.id}-rehydrate-${Date.now()}`,
      });
    }
    await prisma.watchJob.update({
      where: { id: job.id },
      data: {
        status: "queued",
        statusReason: "Rehydrated after worker restart",
        statusChangedAt: new Date(),
        bullJobId: job.id,
      },
    });
  }
  await queue.close();
}

const worker = new Worker<WatchJobPayload>(
  QUEUE_NAME,
  async (job) => {
    console.log(`Processing ${job.name} ${job.id}`, job.data);
    await processWatchJob(job.data);
  },
  { connection }
);

worker.on("completed", (job) => console.log(`Completed ${job.id}`));
worker.on("failed", (job, err) => console.error(`Failed ${job?.id}`, err));

rehydrateWatchJobs().catch((err) => console.error("[rehydrate]", err));

console.log(`Watch worker started (queue: ${QUEUE_NAME})`);

process.on("SIGTERM", async () => {
  await worker.close();
  await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
});
