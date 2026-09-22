import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import {
  createEmptySession,
  processTurn,
  toRequestPayload,
  buildConfirmationCard,
  type IntakeSession,
  createRequestSchema,
  watchRequestSchema,
} from "@ticket-grab/shared";
import { prisma } from "../lib/prisma.js";
import { authenticate } from "../lib/auth.js";
import { logActivity } from "../lib/activity.js";
import { getWatchQueue, getRedis, type WatchJobPayload } from "../lib/queue.js";
import { resolveTravelerIdsForUser, travelerSummariesForIds } from "../lib/travelers.js";

const SESSION_TTL_SEC = 60 * 60; // 1h
const KEY = (id: string) => `intake:session:${id}`;

async function loadSession(id: string): Promise<IntakeSession | null> {
  const raw = await getRedis().get(KEY(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as IntakeSession;
  } catch {
    return null;
  }
}

async function saveSession(id: string, session: IntakeSession) {
  await getRedis().set(KEY(id), JSON.stringify(session), "EX", SESSION_TTL_SEC);
}

export async function intakeRoutes(app: FastifyInstance) {
  /** Conversational turn — public (no auth). Does NOT create tasks. */
  app.post("/intake/turn", {
    schema: {
      tags: ["intake"],
      summary: "Chinese conversational intake turn (no task creation)",
    },
  }, async (request, reply) => {
    const body = (request.body ?? {}) as { sessionId?: string; message?: string };
    const message = (body.message ?? "").trim();
    if (!message) return reply.code(400).send({ error: "message required" });

    let sessionId = body.sessionId?.trim();
    let session = sessionId ? await loadSession(sessionId) : null;
    if (!session) {
      sessionId = randomUUID();
      session = createEmptySession();
      session.history.push({
        role: "assistant",
        text: "您好，我是票务助手。请用一句话描述需求，或告诉我要「火车 / 演出 / 机票」。确认前不会创建任何盯票任务。",
      });
    }

    // Allow "确认" only as signal — still require /intake/confirm for creation
    if (/^(确认|同意|创建|就这样|ok|OK)$/.test(message)) {
      const card = buildConfirmationCard(session.fields);
      if (!card) {
        const r = processTurn(session, message);
        await saveSession(sessionId!, r.session);
        return {
          sessionId,
          reply: r.reply,
          missing: r.missing,
          readyForConfirm: r.readyForConfirm,
          confirmation: r.confirmation ?? null,
          fields: r.session.fields,
          history: r.session.history,
          note: "请先补全信息；创建任务请调用 /intake/confirm（需登录）。",
        };
      }
      return {
        sessionId,
        reply: "信息已齐全。请点击下方「确认创建盯票」按钮（需登录），不会仅凭文字「确认」自动建任务。",
        missing: null,
        readyForConfirm: true,
        confirmation: card,
        fields: session.fields,
        history: session.history,
      };
    }

    const result = processTurn(session, message);
    await saveSession(sessionId!, result.session);
    return {
      sessionId,
      reply: result.reply,
      missing: result.missing,
      readyForConfirm: result.readyForConfirm,
      confirmation: result.confirmation ?? null,
      fields: result.session.fields,
      history: result.session.history,
    };
  });

  app.get("/intake/session/:id", {
    schema: { tags: ["intake"], summary: "Load intake session" },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await loadSession(id);
    if (!session) return reply.code(404).send({ error: "Session not found or expired" });
    const card = buildConfirmationCard(session.fields);
    return {
      sessionId: id,
      fields: session.fields,
      history: session.history,
      readyForConfirm: !!card,
      confirmation: card,
    };
  });

  /**
   * Confirm → create TicketRequest + WatchJob.
   * Auth required. Will NOT create without ready confirmation card.
   */
  app.post("/intake/confirm", {
    schema: {
      tags: ["intake"],
      summary: "Confirm conversational intake and create watch task",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const body = (request.body ?? {}) as {
      sessionId?: string;
      confirmed?: boolean;
      intervalMinutes?: number;
      travelerIds?: string[];
    };
    if (body.confirmed !== true) {
      return reply.code(400).send({ error: "confirmed must be true" });
    }
    if (!body.sessionId) return reply.code(400).send({ error: "sessionId required" });

    const session = await loadSession(body.sessionId);
    if (!session) return reply.code(404).send({ error: "Session not found or expired" });

    const card = buildConfirmationCard(session.fields);
    if (!card) {
      return reply.code(400).send({ error: "Intake incomplete", fields: session.fields });
    }

    const payload = toRequestPayload(session.fields);
    if (body.intervalMinutes && body.intervalMinutes >= 1) {
      payload.watch.intervalMinutes = body.intervalMinutes;
    }

    const parsed = createRequestSchema.parse({
      channel: payload.channel,
      fields: payload.fields,
      notifyOnly: payload.notifyOnly,
      notes: payload.notes,
    });

    const fieldsObj = { ...(parsed.fields as Record<string, unknown>) };
    const passengersHint =
      typeof fieldsObj.passengers === "number"
        ? fieldsObj.passengers
        : typeof fieldsObj.quantity === "number"
          ? fieldsObj.quantity
          : null;
    const bind = await resolveTravelerIdsForUser({
      userId: user.sub,
      travelerIds: body.travelerIds,
      passengers: passengersHint,
    });
    if (!bind.ok) return reply.code(bind.status).send({ error: bind.error });
    if (bind.travelerIds.length && bind.passengers != null) {
      if (parsed.channel === "show") {
        fieldsObj.quantity = bind.passengers;
      } else {
        fieldsObj.passengers = bind.passengers;
      }
    }

    const created = await prisma.ticketRequest.create({
      data: {
        userId: user.sub,
        channel: parsed.channel,
        fields: fieldsObj as object,
        notifyOnly: true,
        notes: parsed.notes,
      },
    });

    const watchBody = watchRequestSchema.parse({
      intervalMinutes: payload.watch.intervalMinutes,
      startsAt: payload.watch.startsAt,
      autoOrder: false,
      preferences: payload.watch.preferences,
    });

    const intervalMs = watchBody.intervalMinutes * 60_000;
    const startsAt = watchBody.startsAt ? new Date(watchBody.startsAt) : null;
    const delayMs = startsAt && startsAt.getTime() > Date.now() ? startsAt.getTime() - Date.now() : 0;
    const nextRunAt = new Date(Date.now() + (delayMs || intervalMs));

    const watchJob = await prisma.watchJob.create({
      data: {
        requestId: created.id,
        status: "queued",
        intervalMinutes: watchBody.intervalMinutes,
        startsAt,
        nextRunAt,
        autoOrder: false,
        preferences: (watchBody.preferences ?? null) as object | undefined,
        travelerIds: bind.travelerIds,
        statusReason: "Created from conversational intake confirmation",
        statusChangedAt: new Date(),
      },
    });

    const queue = getWatchQueue();
    const qPayload: WatchJobPayload = {
      watchJobId: watchJob.id,
      requestId: created.id,
      userId: user.sub,
    };
    const bullJob = await queue.add("watch", qPayload, {
      jobId: watchJob.id,
      repeat: { every: intervalMs },
    });
    await prisma.watchJob.update({
      where: { id: watchJob.id },
      data: { bullJobId: bullJob.id ?? watchJob.id },
    });
    if (delayMs <= 0) {
      await queue.add("watch-immediate", qPayload, { jobId: `${watchJob.id}-immediate` });
    }

    await prisma.notificationEvent.create({
      data: {
        requestId: created.id,
        type: "intake_confirmed",
        title: "对话建单已确认 · 盯票任务已创建",
        body: card.capabilityNote,
        payload: { watchJobId: watchJob.id, sessionId: body.sessionId, channel: parsed.channel },
      },
    });

    await logActivity(user.sub, user.email, "intake_confirm", `Intake confirmed ${parsed.channel}`, {
      requestId: created.id,
      watchJobId: watchJob.id,
    });

    // Clear session so confirm is not replayed
    await getRedis().del(KEY(body.sessionId));

    const travelers = await travelerSummariesForIds(user.sub, bind.travelerIds);
    return reply.code(201).send({
      request: created,
      watchJob: { ...watchJob, travelerIds: bind.travelerIds, travelers },
      confirmation: card,
      travelers,
      message: "盯票任务已创建（监控+通知）。未授权自动购票。",
    });
  });
}
