import type { FastifyInstance } from "fastify";
import {
  createRequestSchema,
  searchTickets,
  watchRequestSchema,
  type Channel,
} from "@ticket-grab/shared";
import { prisma } from "../lib/prisma.js";
import { authenticate } from "../lib/auth.js";
import { logActivity } from "../lib/activity.js";
import { getWatchQueue, removeWatchRepeatable, type WatchJobPayload } from "../lib/queue.js";
import { env } from "../env.js";

export async function requestRoutes(app: FastifyInstance) {
  app.post("/requests", {
    schema: {
      tags: ["requests"],
      summary: "Create ticket request (intake)",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const body = createRequestSchema.parse(request.body);
    const created = await prisma.ticketRequest.create({
      data: {
        userId: user.sub,
        channel: body.channel,
        fields: body.fields as object,
        notifyOnly: body.notifyOnly ?? true,
        notes: body.notes,
      },
    });
    await logActivity(user.sub, user.email, "request_create", `Created ${body.channel} request`, {
      requestId: created.id,
      channel: body.channel,
    });
    return reply.code(201).send(created);
  });

  app.get("/requests", {
    schema: { tags: ["requests"], security: [{ bearerAuth: [] }] },
  }, async (request) => {
    const user = await authenticate(request);
    return prisma.ticketRequest.findMany({
      where: { userId: user.sub },
      orderBy: { createdAt: "desc" },
      include: {
        shortlists: { orderBy: { createdAt: "desc" }, take: 1 },
        watchJobs: { orderBy: { createdAt: "desc" }, take: 3 },
      },
    });
  });

  /** 我的定时盯票 — all non-terminal watches (incl. far-future queued), regardless of startsAt */
  app.get("/grabs", {
    schema: {
      tags: ["requests"],
      summary: "List scheduled grab/watch jobs (includes queued far-future startsAt)",
      security: [{ bearerAuth: [] }],
    },
  }, async (request) => {
    const user = await authenticate(request);
    const statusFilter = (request.query as { status?: string }).status;
    /** Default = in-progress lifecycle (queued stays until startsAt; not only active/pending). */
    const LIVE_STATUSES = [
      "queued",
      "querying",
      "has_tickets",
      "notified",
      "pending",
      "active",
    ] as const;
    const statuses =
      statusFilter === "all"
        ? undefined
        : statusFilter
          ? [statusFilter]
          : [...LIVE_STATUSES];

    const jobs = await prisma.watchJob.findMany({
      where: {
        request: { userId: user.sub },
        ...(statuses ? { status: { in: statuses as never } } : {}),
      },
      orderBy: [{ status: "asc" }, { nextRunAt: "asc" }, { createdAt: "desc" }],
      include: {
        request: {
          select: {
            id: true,
            channel: true,
            fields: true,
            notifyOnly: true,
            createdAt: true,
          },
        },
      },
    });
    // Explicit field projection so list/detail consumers always see lifecycle metadata
    // (Prisma already returns scalars; map keeps contract stable if select is tightened later).
    return {
      items: jobs.map((j) => ({
        id: j.id,
        requestId: j.requestId,
        status: j.status,
        statusReason: j.statusReason ?? null,
        statusChangedAt: j.statusChangedAt ?? null,
        intervalMinutes: j.intervalMinutes,
        startsAt: j.startsAt ?? null,
        endsAt: j.endsAt ?? null,
        autoOrder: j.autoOrder,
        preferences: j.preferences ?? null,
        lastRunAt: j.lastRunAt ?? null,
        nextRunAt: j.nextRunAt ?? null,
        bullJobId: j.bullJobId ?? null,
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
        request: j.request,
      })),
      labelZh: "我的定时盯票",
      limits:
        "Watch + notify + optional assistive auto-create awaiting_login order. No captcha/SMS/face/queue/payment bypass.",
    };
  });

  app.get("/requests/:id", {
    schema: { tags: ["requests"], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const { id } = request.params as { id: string };
    const row = await prisma.ticketRequest.findFirst({
      where: { id, userId: user.sub },
      include: {
        shortlists: { orderBy: { createdAt: "desc" }, take: 5 },
        watchJobs: { orderBy: { createdAt: "desc" } },
        events: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (!row) return reply.code(404).send({ error: "Not found" });
    return row;
  });

  app.post("/requests/:id/search", {
    schema: {
      tags: ["requests"],
      summary: "Run adapter search and store shortlist",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const { id } = request.params as { id: string };
    const row = await prisma.ticketRequest.findFirst({ where: { id, userId: user.sub } });
    if (!row) return reply.code(404).send({ error: "Not found" });

    const result = await searchTickets(
      row.channel as Channel,
      row.fields as Record<string, unknown>,
      env.providerMode
    );

    const snapshot = await prisma.shortlistSnapshot.create({
      data: {
        requestId: row.id,
        provider: result.provider,
        mode: result.mode,
        liveOk: result.liveOk === true,
        items: result.items as object[],
        notes: result.notes,
      },
    });

    await prisma.notificationEvent.create({
      data: {
        requestId: row.id,
        type: "search_completed",
        title: `Search completed (${result.items.length} options)`,
        body: result.notes ?? null,
        payload: { snapshotId: snapshot.id, itemCount: result.items.length },
      },
    });

    await logActivity(user.sub, user.email, "request_search", `Search on request ${id} (${result.items.length} options)`, {
      requestId: id,
      itemCount: result.items.length,
    });
    return { snapshot, result };
  });

  app.post("/requests/:id/watch", {
    schema: {
      tags: ["requests"],
      summary: "Start 定时抢票 watch job (≥1 min interval)",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const { id } = request.params as { id: string };
    const body = watchRequestSchema.parse(request.body ?? {});
    const row = await prisma.ticketRequest.findFirst({ where: { id, userId: user.sub } });
    if (!row) return reply.code(404).send({ error: "Not found" });

    const intervalMs = body.intervalMinutes * 60_000;
    const endsAt = body.endsAt ? new Date(body.endsAt) : null;
    const startsAt = body.startsAt ? new Date(body.startsAt) : null;
    const autoOrder = body.autoOrder === true;
    const preferences = body.preferences ?? null;
    const delayMs = startsAt && startsAt.getTime() > Date.now()
      ? startsAt.getTime() - Date.now()
      : 0;
    const nextRunAt = new Date(Date.now() + (delayMs || intervalMs));

    const watchJob = await prisma.watchJob.create({
      data: {
        requestId: row.id,
        status: "queued",
        intervalMinutes: body.intervalMinutes,
        startsAt,
        endsAt,
        autoOrder,
        preferences: preferences as object | undefined,
        nextRunAt,
        statusReason: delayMs > 0 ? "Queued until startsAt" : "Queued for first query",
        statusChangedAt: new Date(),
      },
    });

    const queue = getWatchQueue();
    const payload: WatchJobPayload = {
      watchJobId: watchJob.id,
      requestId: row.id,
      userId: user.sub,
    };

    const bullJob = await queue.add(
      "watch",
      payload,
      {
        jobId: watchJob.id,
        repeat: {
          every: intervalMs,
          ...(endsAt ? { endDate: endsAt } : {}),
        },
      }
    );

    const updated = await prisma.watchJob.update({
      where: { id: watchJob.id },
      data: { bullJobId: bullJob.id ?? watchJob.id },
    });

    const channelLabel =
      row.channel === "show"
        ? "定时抢票 / 开售自动抢"
        : row.channel === "train"
          ? "定时抢票"
          : "航班查询演示（库存监控不可用）";

    await prisma.notificationEvent.create({
      data: {
        requestId: row.id,
        type: "watch_started",
        title: `${channelLabel}已开启（每 ${body.intervalMinutes} 分钟）`,
        body: [
          endsAt ? `Ends at ${endsAt.toISOString()}` : "No end date",
          startsAt ? `Starts at ${startsAt.toISOString()}` : "First run ASAP",
          autoOrder ? "autoOrder=on (draft/awaiting_login only; captcha/SMS still need you)" : "notify only",
          preferences ? `prefs=${JSON.stringify(preferences)}` : null,
          row.channel === "flight"
            ? "实时可售票/票价监控不可用 — ticks will be degraded; no fake tickets_found"
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
        payload: { watchJobId: watchJob.id, autoOrder, preferences },
      },
    });

    if (delayMs <= 0) {
      await queue.add("watch-immediate", payload, { jobId: `${watchJob.id}-immediate` });
    }

    await logActivity(user.sub, user.email, "watch_start", `${channelLabel} every ${body.intervalMinutes} min`, {
      requestId: row.id,
      watchJobId: watchJob.id,
      autoOrder,
      endsAt: endsAt?.toISOString() ?? null,
      startsAt: startsAt?.toISOString() ?? null,
      preferences,
    });
    return reply.code(201).send(updated);
  });

  app.post("/requests/:id/watch/:jobId/cancel", {
    schema: {
      tags: ["requests"],
      summary: "Cancel a 定时抢票 job",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const { id, jobId } = request.params as { id: string; jobId: string };
    const row = await prisma.ticketRequest.findFirst({ where: { id, userId: user.sub } });
    if (!row) return reply.code(404).send({ error: "Not found" });

    const job = await prisma.watchJob.findFirst({ where: { id: jobId, requestId: id } });
    if (!job) return reply.code(404).send({ error: "Watch job not found" });

    try {
      const result = await removeWatchRepeatable({
        id: job.id,
        intervalMinutes: job.intervalMinutes,
        endsAt: job.endsAt,
        bullJobId: job.bullJobId,
      });
      request.log.info(
        {
          watchJobId: job.id,
          removeRepeatableOk: result.removeRepeatableOk,
          removedRepeatableKeys: result.removedRepeatableKeys,
          removedJobIds: result.removedJobIds.slice(0, 20),
        },
        "Removed BullMQ repeatable for cancelled watch"
      );
    } catch (err) {
      request.log.warn({ err }, "Failed to remove bull job; marking cancelled in DB");
    }

    const updated = await prisma.watchJob.update({
      where: { id: job.id },
      data: {
        status: "cancelled",
        statusReason: "Cancelled by user",
        statusChangedAt: new Date(),
      },
    });

    await prisma.notificationEvent.create({
      data: {
        requestId: row.id,
        type: "watch_cancelled",
        title: "定时抢票已取消",
        body: `Job ${job.id}`,
        payload: { watchJobId: job.id },
      },
    });

    await logActivity(user.sub, user.email, "watch_cancel", `Cancelled watch ${job.id}`, {
      requestId: id,
      watchJobId: job.id,
    });
    return updated;
  });

  app.get("/requests/:id/events", {
    schema: { tags: ["requests"], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const { id } = request.params as { id: string };
    const row = await prisma.ticketRequest.findFirst({ where: { id, userId: user.sub } });
    if (!row) return reply.code(404).send({ error: "Not found" });
    return prisma.notificationEvent.findMany({
      where: { requestId: id },
      orderBy: { createdAt: "desc" },
    });
  });
}
