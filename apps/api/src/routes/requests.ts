import type { FastifyInstance } from "fastify";
import {
  createRequestSchema,
  createWatchOrderSchema,
  searchTickets,
  watchRequestSchema,
  type Channel,
  type ShortlistItem,
} from "@ticket-grab/shared";
import type { Prisma } from "@prisma/client";
import {
  trainRealSubmitDisabledNextSteps,
  trainRealSubmitEnabled,
} from "../lib/bookingFlags.js";
import { prisma } from "../lib/prisma.js";
import { authenticate } from "../lib/auth.js";
import { logActivity } from "../lib/activity.js";
import { getWatchQueue, removeWatchRepeatable, hasWatchRepeatable, type WatchJobPayload } from "../lib/queue.js";
import { env } from "../env.js";
import { resolveTravelerIdsForUser, travelerSummariesForIds } from "../lib/travelers.js";


function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Pick shortlist item: explicit id, else prefs filter, else first available/limited. */
function pickShortlistItem(
  items: ShortlistItem[],
  preferences: Record<string, unknown> | null | undefined,
  selectedId?: string
): ShortlistItem | null {
  if (!items.length) return null;
  if (selectedId) {
    const hit = items.find((i) => i.id === selectedId);
    return hit ?? null;
  }
  let pool = items.filter(
    (i) => i.availability === "available" || i.availability === "limited"
  );
  if (!pool.length) pool = [...items];
  const prefs = preferences ?? {};
  const preferredTrains = Array.isArray(prefs.preferredTrains)
    ? prefs.preferredTrains.map(String)
    : [];
  const preferredSeats = Array.isArray(prefs.preferredSeats)
    ? prefs.preferredSeats.map(String)
    : [];
  const preferredTiers = Array.isArray(prefs.preferredTiers)
    ? prefs.preferredTiers.map(String)
    : [];
  if (preferredTrains.length) {
    const filtered = pool.filter((i) => {
      const no = String(i.meta?.trainNo ?? i.title.split(" ")[0] ?? "");
      return preferredTrains.some((t) => no.includes(t) || i.title.includes(t));
    });
    if (filtered.length) pool = filtered;
  }
  if (preferredSeats.length) {
    const filtered = pool.filter((i) => {
      const seat = String(i.meta?.seatClass ?? "");
      return preferredSeats.some(
        (s) => seat.includes(s) || i.title.includes(s) || i.subtitle?.includes(s)
      );
    });
    if (filtered.length) pool = filtered;
  }
  if (preferredTiers.length) {
    const filtered = pool.filter((i) => {
      const tier = String(i.meta?.tier ?? "");
      return preferredTiers.some((t) => tier.includes(t));
    });
    if (filtered.length) pool = filtered;
  }
  return pool[0] ?? null;
}

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
    const items = await Promise.all(
      jobs.map(async (j) => {
        let repeatableArmed = false;
        try {
          // Always probe — cancelled jobs must show false to prove removeRepeatable worked.
          repeatableArmed = await hasWatchRepeatable(j.id);
        } catch {
          repeatableArmed = false;
        }
        const travelerIds = (j as { travelerIds?: string[] }).travelerIds ?? [];
        const travelers = await travelerSummariesForIds(user.sub, travelerIds);
        return {
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
          travelerIds,
          travelers,
          lastRunAt: j.lastRunAt ?? null,
          nextRunAt: j.nextRunAt ?? null,
          bullJobId: j.bullJobId ?? null,
          /** True when a BullMQ repeatable still exists for this job (no Redis secrets). */
          repeatableArmed,
          createdAt: j.createdAt,
          updatedAt: j.updatedAt,
          request: j.request,
        };
      })
    );
    return {
      items,
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
    const watchJobs = await Promise.all(
      (row.watchJobs ?? []).map(async (j) => {
        let repeatableArmed = false;
        try {
          // Always probe — cancelled jobs must show false to prove removeRepeatable worked.
          repeatableArmed = await hasWatchRepeatable(j.id);
        } catch {
          repeatableArmed = false;
        }
        const travelerIds = (j as { travelerIds?: string[] }).travelerIds ?? [];
        const travelers = await travelerSummariesForIds(user.sub, travelerIds);
        return { ...j, travelerIds, travelers, repeatableArmed };
      })
    );
    return { ...row, watchJobs };
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

    const fieldsObj = (row.fields ?? {}) as Record<string, unknown>;
    const passengersHint =
      typeof fieldsObj.passengers === "number"
        ? fieldsObj.passengers
        : typeof fieldsObj.quantity === "number"
          ? fieldsObj.quantity
          : null;
    const bind = await resolveTravelerIdsForUser({
      userId: user.sub,
      travelerIds: body.travelerIds,
      passengers: body.travelerIds?.length ? passengersHint : null,
    });
    // When travelerIds omitted, skip passengers match; when provided, enforce.
    if (!bind.ok) return reply.code(bind.status).send({ error: bind.error });
    if (bind.travelerIds.length && passengersHint == null && bind.passengers != null) {
      const nextFields = { ...fieldsObj, passengers: bind.passengers };
      await prisma.ticketRequest.update({
        where: { id: row.id },
        data: { fields: nextFields as object },
      });
    }

    const watchJob = await prisma.watchJob.create({
      data: {
        requestId: row.id,
        status: "queued",
        intervalMinutes: body.intervalMinutes,
        startsAt,
        endsAt,
        autoOrder,
        preferences: preferences as object | undefined,
        travelerIds: bind.travelerIds,
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
      travelerIds: bind.travelerIds,
    });
    const travelers = await travelerSummariesForIds(user.sub, bind.travelerIds);
    return reply.code(201).send({ ...updated, travelerIds: bind.travelerIds, travelers });
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

    let repeatableArmed = false;
    try {
      repeatableArmed = await hasWatchRepeatable(job.id);
    } catch {
      repeatableArmed = false;
    }
    return {
      ...updated,
      repeatableArmed,
      proofHint:
        "Poll GET /api/grabs (or GET /api/requests/:id) for ≥5m: status=cancelled, lastRunAt unchanged, repeatableArmed=false. Optional operator redis dump is not required.",
    };
  });


  /**
   * Explicit user action: create a draft Order from a WatchJob's bound travelerIds
   * + latest (or selected) shortlist item. Never submits / charges.
   */
  app.post("/grabs/:id/create-order", {
    schema: {
      tags: ["requests", "orders"],
      summary: "Create draft order from grab/watch (bound travelers + shortlist; no submit)",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const { id: watchJobId } = request.params as { id: string };
    const body = createWatchOrderSchema.parse(request.body ?? {});

    const watch = await prisma.watchJob.findFirst({
      where: { id: watchJobId, request: { userId: user.sub } },
      include: {
        request: {
          include: { shortlists: { orderBy: { createdAt: "desc" }, take: 1 } },
        },
      },
    });
    if (!watch) return reply.code(404).send({ error: "Watch job not found" });

    const travelerIds = (watch as { travelerIds?: string[] }).travelerIds ?? [];
    if (!travelerIds.length) {
      return reply.code(400).send({
        error: "该抢票任务未绑定乘车人；请先在创建盯票时选择 travelerIds",
        code: "TRAVELER_IDS_REQUIRED",
      });
    }

    const bind = await resolveTravelerIdsForUser({
      userId: user.sub,
      travelerIds,
    });
    if (!bind.ok) return reply.code(bind.status).send({ error: bind.error });

    const snapshot = watch.request.shortlists[0];
    const items = (snapshot?.items as unknown as ShortlistItem[] | undefined) ?? [];
    if (!items.length) {
      return reply.code(400).send({
        error: "暂无候选短名单；请等待盯票发现有票或先执行一次搜索",
        code: "SHORTLIST_EMPTY",
      });
    }

    const preferences = (watch.preferences ?? null) as Record<string, unknown> | null;
    const item = pickShortlistItem(items, preferences, body.selectedShortlistItemId);
    if (!item) {
      return reply.code(400).send({
        error: body.selectedShortlistItemId
          ? "指定的短名单项不存在于最新快照"
          : "无法从短名单中选出匹配项",
        code: "SHORTLIST_ITEM_NOT_FOUND",
      });
    }

    // Idempotent: reuse draft/awaiting_login for same watch + item
    const candidates = await prisma.order.findMany({
      where: {
        userId: user.sub,
        requestId: watch.requestId,
        selectedShortlistItemId: item.id,
        status: { in: ["draft", "awaiting_login"] },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    const existing = candidates.find((o) => {
      const payload = (o.payload ?? {}) as Record<string, unknown>;
      return payload.watchJobId === watchJobId;
    });

    const travelers = await travelerSummariesForIds(user.sub, bind.travelerIds);
    const nextSteps = [
      `打开订单页 /orders/${existing?.id ?? "{id}"} 确认车次与乘车人`,
      "在「账号绑定」(/accounts) 关联本人 12306 会话",
      "如出现验证码/短信/人脸，请在站内引导步骤手动完成（本站不会自动打码或绕过）",
      ...trainRealSubmitDisabledNextSteps().filter((s) => /TRAIN_REAL_SUBMIT|支付|乘车人/.test(s)),
      "本接口只创建草稿订单，不会自动提交或扣款",
    ];

    if (existing) {
      nextSteps[0] = `打开订单页 /orders/${existing.id} 确认车次与乘车人`;
      return {
        orderId: existing.id,
        status: existing.status === "awaiting_login" ? "awaiting_login" : "draft",
        reused: true,
        watchJobId,
        selectedShortlistItemId: item.id,
        shortlistItem: item,
        travelerIds: bind.travelerIds,
        travelers,
        trainRealSubmit: trainRealSubmitEnabled(),
        nextSteps,
        orderPath: `/orders/${existing.id}`,
      };
    }

    const amount =
      typeof item.price === "number" ? item.price * bind.travelerIds.length : null;

    const order = await prisma.order.create({
      data: {
        userId: user.sub,
        requestId: watch.requestId,
        channel: watch.request.channel,
        status: "draft",
        selectedShortlistItemId: item.id,
        travelerIds: bind.travelerIds,
        amount,
        currency: item.currency ?? "CNY",
        payload: asJson({
          shortlistItem: item,
          watchJobId,
          createdFromWatch: true,
          nextSteps: [
            `打开订单页确认车次与乘车人`,
            "在「账号绑定」(/accounts) 关联本人 12306 会话",
            "验证码/短信/人脸须本人完成；TRAIN_REAL_SUBMIT=1 后才可协助提交",
            "支付仅在官方 12306 收银台；本站不代扣",
          ],
          notes: "由抢票任务手动创建的草稿订单（未提交、未扣款）",
        }),
      },
    });

    nextSteps[0] = `打开订单页 /orders/${order.id} 确认车次与乘车人`;

    await prisma.notificationEvent.create({
      data: {
        requestId: watch.requestId,
        orderId: order.id,
        type: "watch_order_draft",
        title: `已创建草稿订单 · ${item.title}`,
        body: "来自抢票任务的手动建单。未提交、未扣款。请打开订单页继续。",
        payload: {
          orderId: order.id,
          watchJobId,
          itemId: item.id,
          orderPath: `/orders/${order.id}`,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    await logActivity(
      user.sub,
      user.email,
      "watch_order_draft",
      `Draft order ${order.id} from watch ${watchJobId}`,
      { orderId: order.id, watchJobId, requestId: watch.requestId, itemId: item.id }
    );

    return reply.code(201).send({
      orderId: order.id,
      status: "draft",
      reused: false,
      watchJobId,
      selectedShortlistItemId: item.id,
      shortlistItem: item,
      travelerIds: bind.travelerIds,
      travelers,
      trainRealSubmit: trainRealSubmitEnabled(),
      nextSteps,
      orderPath: `/orders/${order.id}`,
    });
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
