import type { FastifyInstance } from "fastify";
import {
  assertTransition,
  channelToPlatform,
  createOrderSchema,
  platformsForChannel,
  prepareCheckout,
  queryOrderStatus as bookingQueryStatus,
  submitOrder as bookingSubmit,
  type Channel,
  type OrderStatus,
  type PlatformKind,
  type ShortlistItem,
} from "@ticket-grab/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { authenticate } from "../lib/auth.js";
import { logActivity } from "../lib/activity.js";
import { decryptSensitive, encryptSensitive } from "../lib/crypto.js";
import { env } from "../env.js";
import {
  dryRunMode,
  stubMode,
  trainRealSubmitEnabled,
  TRAIN_REAL_SUBMIT_DISABLED_CODE,
  trainRealSubmitDisabledNextSteps,
  SHOW_AUTO_BUY_UNAVAILABLE_CODE,
  showAutoBuyUnavailableNextSteps,
} from "../lib/bookingFlags.js";
import { travelerSummariesForIds } from "../lib/travelers.js";
import {
  fromPrismaOrderStatus,
  fromPrismaPlatform,
  toPrismaOrderStatus,
  toPrismaPlatform,
} from "../lib/platformMap.js";


function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function publicOrder(row: {
  id: string;
  userId: string;
  requestId: string;
  channel: string;
  status: string;
  selectedShortlistItemId: string;
  travelerIds: string[];
  amount: number | null;
  currency: string;
  externalOrderId: string | null;
  payload: unknown;
  errorMessage: string | null;
  paymentUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...row,
    status: fromPrismaOrderStatus(row.status),
    checkoutPath: `/checkout/${row.id}`,
  };
}

async function loadSession(
  userId: string,
  channel: Channel,
  preferredPlatform?: PlatformKind
) {
  const candidates = platformsForChannel(channel);
  const ordered: PlatformKind[] =
    preferredPlatform && candidates.includes(preferredPlatform)
      ? [preferredPlatform, ...candidates.filter((p) => p !== preferredPlatform)]
      : candidates;

  for (const platform of ordered) {
    const cred = await prisma.platformCredential.findUnique({
      where: {
        userId_platform: { userId, platform: toPrismaPlatform(platform) },
      },
    });
    if (!cred) continue;
    const hasEncryptedSession = Boolean(cred.sessionCookieEnc || cred.vaultRef);
    const sessionStatus = cred.sessionStatus as
      | "unlinked"
      | "needs_browser_login"
      | "linked"
      | "expired";
    // Prefer a linked session with blob; otherwise keep scanning.
    if (sessionStatus === "linked" && hasEncryptedSession) {
      let cookies: string | undefined;
      if (cred.sessionCookieEnc) {
        try {
          cookies = decryptSensitive(cred.sessionCookieEnc);
        } catch {
          cookies = undefined;
        }
      }
      return {
        platform,
        sessionStatus,
        hasEncryptedSession,
        lastVerifiedAt: cred.lastVerifiedAt?.toISOString() ?? null,
        cookies,
      };
    }
  }

  // Fall back to first candidate row (even if unlinked) or default.
  const primary = ordered[0] ?? channelToPlatform(channel);
  const cred = await prisma.platformCredential.findUnique({
    where: {
      userId_platform: { userId, platform: toPrismaPlatform(primary) },
    },
  });
  return {
    platform: primary,
    sessionStatus: (cred?.sessionStatus ?? "unlinked") as
      | "unlinked"
      | "needs_browser_login"
      | "linked"
      | "expired",
    hasEncryptedSession: Boolean(cred?.sessionCookieEnc || cred?.vaultRef),
    lastVerifiedAt: cred?.lastVerifiedAt?.toISOString() ?? null,
  };
}

function channelPaymentInstructions(
  channel: Channel,
  status: OrderStatus,
  path: string
): string[] {
  const platformHint =
    channel === "train"
      ? "12306"
      : channel === "show"
        ? "大麦/猫眼"
        : "航司/OTA";
  const payee =
    channel === "train" ? "铁路（12306）" : channel === "show" ? "主办方（大麦/猫眼）" : "航司/OTA";
  return [
    `支付在官方完成，款项付给${payee}`,
    `在本产品结账页打开${platformHint}官方收银台（跳转 / 回写），本站不收取票款`,
    "支付成功后订单状态将更新为 paid（需确认字段，不会口头谎报）",
    `请打开 ${path} — 无需自行打开${platformHint} App 摸索流程`,
    status === "候补中" ? "当前为候补：出票前请关注订单页与通知" : null,
    status === "awaiting_login" ? `请先在结账页完成${platformHint}登录，再支付` : null,
  ].filter(Boolean) as string[];
}

async function notifyOrder(
  requestId: string | null,
  orderId: string,
  type: string,
  title: string,
  body?: string,
  payload?: object
) {
  await prisma.notificationEvent.create({
    data: {
      requestId: requestId ?? undefined,
      orderId,
      type,
      title,
      body: body ?? null,
      payload: payload ?? undefined,
    },
  });
}

export async function orderRoutes(app: FastifyInstance) {
  app.post("/requests/:id/orders", {
    schema: {
      tags: ["orders"],
      summary: "Create order from shortlist item + travelers",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const { id: requestId } = request.params as { id: string };
    const body = createOrderSchema.parse(request.body);

    const ticketReq = await prisma.ticketRequest.findFirst({
      where: { id: requestId, userId: user.sub },
      include: { shortlists: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!ticketReq) return reply.code(404).send({ error: "Request not found" });

    const travelers = await prisma.traveler.findMany({
      where: { userId: user.sub, id: { in: body.travelerIds } },
    });
    if (travelers.length !== body.travelerIds.length) {
      return reply.code(400).send({ error: "One or more travelers not found" });
    }

    const snapshot = ticketReq.shortlists[0];
    const items = (snapshot?.items as unknown as ShortlistItem[] | undefined) ?? [];
    let item: ShortlistItem | Record<string, unknown> | undefined = items.find(
      (i) => i.id === body.selectedShortlistItemId
    );
    if (!item && body.shortlistItem) item = body.shortlistItem;
    if (!item) {
      return reply.code(400).send({
        error: "Shortlist item not found — run search first or pass shortlistItem",
      });
    }

    const itemChannel = (item as ShortlistItem).channel;
    if (itemChannel && itemChannel !== ticketReq.channel) {
      return reply.code(400).send({
        error: `Shortlist item channel (${itemChannel}) does not match request (${ticketReq.channel})`,
      });
    }

    if (body.preferredPlatform) {
      const allowed = platformsForChannel(ticketReq.channel as Channel);
      if (!allowed.includes(body.preferredPlatform)) {
        return reply.code(400).send({
          error: `preferredPlatform ${body.preferredPlatform} not valid for channel ${ticketReq.channel}`,
        });
      }
    }

    const amount =
      typeof (item as ShortlistItem).price === "number"
        ? (item as ShortlistItem).price! * travelers.length
        : null;

    const order = await prisma.order.create({
      data: {
        userId: user.sub,
        requestId,
        channel: ticketReq.channel,
        status: "draft",
        selectedShortlistItemId: body.selectedShortlistItemId,
        travelerIds: body.travelerIds,
        amount,
        currency: (item as ShortlistItem).currency ?? "CNY",
        payload: asJson({
          shortlistItem: item,
          nextSteps: [] as string[],
          preferredPlatform: body.preferredPlatform ?? null,
        }),
      },
    });

    const session = await loadSession(
      user.sub,
      ticketReq.channel as Channel,
      body.preferredPlatform
    );
    const prepared = await prepareCheckout({
      channel: ticketReq.channel as Channel,
      orderId: order.id,
      shortlistItem: item,
      travelers: travelers.map((t) => ({
        id: t.id,
        name: t.name,
        idType: t.idType,
        idNumberHint: t.idNumberHint ?? undefined,
        type: t.type as "adult" | "child",
      })),
      session,
      webBaseUrl: env.webBaseUrl,
    });

    const nextStatus = prepared.requiresInteractiveLogin ? "awaiting_login" : "draft";
    if (nextStatus !== "draft") {
      assertTransition("draft", nextStatus as OrderStatus);
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: toPrismaOrderStatus(nextStatus as OrderStatus),
        payload: asJson({
          shortlistItem: item,
          nextSteps: prepared.nextSteps,
          notes: prepared.notes,
          checkoutPath: prepared.checkoutPath,
          preferredPlatform: body.preferredPlatform ?? session.platform,
        }),
        paymentUrl: `${env.webBaseUrl}${prepared.checkoutPath}`,
      },
    });

    await notifyOrder(
      requestId,
      order.id,
      "order_created",
      `订单已创建 (${fromPrismaOrderStatus(updated.status)})`,
      prepared.notes,
      { orderId: order.id, status: fromPrismaOrderStatus(updated.status) }
    );

    await logActivity(user.sub, user.email, "order_create", `Order created (${ticketReq.channel})`, {
      orderId: order.id,
      requestId,
      channel: ticketReq.channel,
    });
    return reply.code(201).send(publicOrder(updated));
  });

  app.post("/orders/:id/submit", {
    schema: {
      tags: ["orders"],
      summary: "Channel-specific assistive submit (session-aware; may await_login)",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const { id } = request.params as { id: string };
    const order = await prisma.order.findFirst({ where: { id, userId: user.sub } });
    if (!order) return reply.code(404).send({ error: "Not found" });

    const current = fromPrismaOrderStatus(order.status);
    if (current === "paid" || current === "cancelled") {
      return reply.code(400).send({ error: `Cannot submit from status ${current}` });
    }

    // Hard gate: live 12306 assistive submit requires explicit TRAIN_REAL_SUBMIT=1.
    // Stub mode remains available for demos. Intake/watch never call this path.
    // When gated: do NOT call bookingSubmit / 12306 confirm; keep honest non-success status.
    if (
      order.channel === "train" &&
      !stubMode() &&
      !trainRealSubmitEnabled()
    ) {
      const nextSteps = trainRealSubmitDisabledNextSteps();
      // Keep draft / awaiting_login / failed — never promote to paid / 候补成功.
      const keepStatus = current === "submitting" ? "draft" : current;
      const prevPayload = (order.payload ?? {}) as Record<string, unknown>;
      const updated = await prisma.order.update({
        where: { id },
        data: {
          status: toPrismaOrderStatus(keepStatus as OrderStatus),
          errorMessage: TRAIN_REAL_SUBMIT_DISABLED_CODE,
          payload: asJson({
            ...prevPayload,
            nextSteps,
            notes:
              "TRAIN_REAL_SUBMIT 未开启：协助提交已拒绝，未调用 12306 占座/确认，本站不扣款。",
            bookingMode: {
              stub: stubMode(),
              dryRun: dryRunMode(),
              trainRealSubmit: false,
            },
            gate: {
              code: TRAIN_REAL_SUBMIT_DISABLED_CODE,
              trainRealSubmit: false,
            },
          }),
        },
      });
      await notifyOrder(
        order.requestId,
        order.id,
        "order_submit_gated",
        "12306 协助提交未开启（TRAIN_REAL_SUBMIT=0）",
        "请绑定会话、完成验证码、由管理员开闸后在官方支付。未产生真实占座/扣款。",
        {
          orderId: order.id,
          code: TRAIN_REAL_SUBMIT_DISABLED_CODE,
          trainRealSubmit: false,
          status: fromPrismaOrderStatus(updated.status),
        }
      );
      return reply.code(403).send({
        code: TRAIN_REAL_SUBMIT_DISABLED_CODE,
        error: "train_submit_disabled",
        message:
          "12306 assistive submit is disabled on this deployment (TRAIN_REAL_SUBMIT≠1). No live confirm/seat-hold/charge was attempted. Monitor/notify and official redirect remain available.",
        trainRealSubmit: false,
        nextSteps,
        orderId: order.id,
        status: fromPrismaOrderStatus(updated.status),
        order: publicOrder(updated),
      });
    }

    // Honest gate: real Damai/Maoyan auto-buy API is not integrated.
    // Stub mode keeps demo handoff (STUB-SHOW-*). Never mark paid from fixtures.
    if (order.channel === "show" && !stubMode()) {
      const nextSteps = showAutoBuyUnavailableNextSteps();
      const keepStatus = current === "submitting" ? "draft" : current;
      const prevPayload = (order.payload ?? {}) as Record<string, unknown>;
      const updated = await prisma.order.update({
        where: { id },
        data: {
          status: toPrismaOrderStatus(keepStatus as OrderStatus),
          errorMessage: SHOW_AUTO_BUY_UNAVAILABLE_CODE,
          payload: asJson({
            ...prevPayload,
            nextSteps,
            notes:
              "SHOW_AUTO_BUY_UNAVAILABLE：真实大麦/猫眼下单 API 未接入；未自动购票、未谎报已支付。请用户登录官方完成支付。",
            bookingMode: {
              stub: stubMode(),
              dryRun: dryRunMode(),
              trainRealSubmit: trainRealSubmitEnabled(),
              showAutoBuy: false,
            },
            gate: {
              code: SHOW_AUTO_BUY_UNAVAILABLE_CODE,
              showAutoBuy: false,
            },
          }),
        },
      });
      await notifyOrder(
        order.requestId,
        order.id,
        "order_submit_gated",
        "演出自动购票不可用（SHOW_AUTO_BUY_UNAVAILABLE）",
        "请绑定大麦/猫眼、在官方完成登录与支付。本站仅草稿/手递，不产生真实购票成功。",
        {
          orderId: order.id,
          code: SHOW_AUTO_BUY_UNAVAILABLE_CODE,
          showAutoBuy: false,
          status: fromPrismaOrderStatus(updated.status),
        }
      );
      return reply.code(403).send({
        code: SHOW_AUTO_BUY_UNAVAILABLE_CODE,
        error: "show_auto_buy_unavailable",
        message:
          "Damai/Maoyan auto-buy API is not integrated. Draft + official handoff only; no fake paid success. User must login and pay on the official platform.",
        showAutoBuy: false,
        nextSteps,
        orderId: order.id,
        status: fromPrismaOrderStatus(updated.status),
        order: publicOrder(updated),
      });
    }

    const travelers = await prisma.traveler.findMany({
      where: { userId: user.sub, id: { in: order.travelerIds } },
    });
    const payload = (order.payload ?? {}) as {
      shortlistItem?: ShortlistItem | Record<string, unknown>;
      preferredPlatform?: PlatformKind;
    };
    const item = payload.shortlistItem ?? { id: order.selectedShortlistItemId };
    const session = await loadSession(
      user.sub,
      order.channel as Channel,
      payload.preferredPlatform
    );

    assertTransition(current === "awaiting_login" ? "awaiting_login" : current, "submitting");
    await prisma.order.update({
      where: { id },
      data: { status: "submitting" },
    });

    const result = await bookingSubmit({
      channel: order.channel as Channel,
      orderId: order.id,
      shortlistItem: item,
      travelers: travelers.map((t) => {
        let idNumber: string | undefined;
        try {
          idNumber = decryptSensitive(t.idNumberEnc);
        } catch {
          idNumber = undefined;
        }
        return {
          id: t.id,
          name: t.name,
          idType: t.idType,
          idNumberHint: t.idNumberHint ?? undefined,
          idNumber,
          phone: t.phone ?? undefined,
          type: t.type as "adult" | "child",
        };
      }),
      session,
      webBaseUrl: env.webBaseUrl,
      stubMode: stubMode(),
      dryRun: dryRunMode(),
    });

    if (result.cookiesToPersist && session.platform === "12306") {
      await prisma.platformCredential.upsert({
        where: {
          userId_platform: {
            userId: user.sub,
            platform: toPrismaPlatform("12306"),
          },
        },
        create: {
          userId: user.sub,
          platform: toPrismaPlatform("12306"),
          sessionStatus: "linked",
          sessionCookieEnc: encryptSensitive(result.cookiesToPersist),
          lastVerifiedAt: new Date(),
        },
        update: {
          sessionStatus: "linked",
          sessionCookieEnc: encryptSensitive(result.cookiesToPersist),
          lastVerifiedAt: new Date(),
        },
      });
    }

    // submitting → result.status
    try {
      assertTransition("submitting", result.status);
    } catch {
      // allow awaiting_login from draft path already handled
    }

    const paymentUrl = result.paymentPath
      ? `${env.webBaseUrl}${result.paymentPath}`
      : `${env.webBaseUrl}/checkout/${order.id}`;

    const updated = await prisma.order.update({
      where: { id },
      data: {
        status: toPrismaOrderStatus(result.status),
        externalOrderId: result.externalOrderId ?? undefined,
        amount: result.amount ?? order.amount,
        currency: result.currency ?? order.currency,
        errorMessage: result.errorMessage ?? null,
        paymentUrl,
        payload: asJson({
          ...payload,
          shortlistItem: item,
          nextSteps: result.nextSteps,
          notes: result.notes,
          confirmation: result.confirmation,
          checkoutPath: `/checkout/${order.id}`,
          paymentPath: result.paymentPath,
          paymentUrlOfficial: result.paymentUrl,
          payDeadline: result.payDeadline,
          interaction: result.interaction,
          bookingMode: {
            stub: stubMode(),
            dryRun: dryRunMode(),
            trainRealSubmit: trainRealSubmitEnabled(),
          },
        }),
      },
    });

    await notifyOrder(
      order.requestId,
      order.id,
      "order_submitted",
      `订单提交结果: ${fromPrismaOrderStatus(updated.status)}`,
      result.notes,
      {
        orderId: order.id,
        status: fromPrismaOrderStatus(updated.status),
        confirmation: result.confirmation,
      }
    );

    await logActivity(user.sub, user.email, "order_submit", `Order submit → ${fromPrismaOrderStatus(updated.status)}`, {
      orderId: order.id,
      status: fromPrismaOrderStatus(updated.status),
    });
    return publicOrder(updated);
  });

  app.get("/orders", {
    schema: {
      tags: ["orders"],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          channel: { type: "string", enum: ["train", "show", "flight"] },
        },
      },
    },
  }, async (request) => {
    const user = await authenticate(request);
    const q = request.query as { channel?: "train" | "show" | "flight" };
    const rows = await prisma.order.findMany({
      where: {
        userId: user.sub,
        ...(q.channel ? { channel: q.channel } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(publicOrder);
  });

  app.get("/orders/:id", {
    schema: { tags: ["orders"], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const { id } = request.params as { id: string };
    const row = await prisma.order.findFirst({
      where: { id, userId: user.sub },
      include: {
        events: { orderBy: { createdAt: "asc" }, take: 50 },
        request: { select: { id: true, channel: true, fields: true } },
      },
    });
    if (!row) return reply.code(404).send({ error: "Not found" });

    // Summaries only: name / hint / relationship — never full ID or enc blob.
    const travelers = await travelerSummariesForIds(user.sub, row.travelerIds);

    const preferred = (row.payload as { preferredPlatform?: PlatformKind } | null)
      ?.preferredPlatform;
    const session = await loadSession(user.sub, row.channel as Channel, preferred);
    const timeline = [
      { at: row.createdAt, status: "draft", label: "订单创建" },
      ...row.events.map((e) => ({
        at: e.createdAt,
        status: (e.payload as { status?: string } | null)?.status ?? e.type,
        label: e.title,
        body: e.body,
      })),
    ];

    return {
      ...publicOrder(row),
      travelers,
      session,
      timeline,
      events: row.events,
      request: row.request,
    };
  });

  app.post("/orders/:id/payment-handoff", {
    schema: {
      tags: ["orders"],
      summary: "Return in-product payment URL / instructions (stay in our chrome)",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const { id } = request.params as { id: string };
    const order = await prisma.order.findFirst({ where: { id, userId: user.sub } });
    if (!order) return reply.code(404).send({ error: "Not found" });

    const status = fromPrismaOrderStatus(order.status);
    const path = `/checkout/${order.id}?step=pay`;
    const checkoutUrl = `${env.webBaseUrl}${path}`;
    const payload = (order.payload ?? {}) as {
      paymentUrlOfficial?: string;
    };
    const official = payload.paymentUrlOfficial ?? null;
    // Prefer official cashier URL when present; keep checkout path as in-app handoff.
    const paymentUrl = official || checkoutUrl;

    await prisma.order.update({
      where: { id },
      data: { paymentUrl },
    });

    await notifyOrder(
      order.requestId,
      order.id,
      "order_payment_handoff",
      "已生成站内支付手递",
      `支付在官方完成，款项付给铁路/主办方/航司。请打开 ${path} 或官方收银台。`,
      { orderId: id, paymentPath: path, paymentUrlOfficial: official, status }
    );

    await logActivity(user.sub, user.email, "checkout_open", `Opened checkout for order ${id}`, {
      orderId: id,
      paymentPath: path,
    });
    return {
      orderId: id,
      status,
      channel: order.channel,
      paymentUrl,
      paymentUrlOfficial: official,
      paymentPath: path,
      checkoutUrl,
      instructions: channelPaymentInstructions(
        order.channel as Channel,
        status,
        path
      ),
      notice: "支付在官方完成，款项付给铁路/主办方/航司",
      externalOrderId: order.externalOrderId,
      amount: order.amount,
      currency: order.currency,
    };
  });

  app.get("/orders/:id/12306-status", {
    schema: {
      tags: ["orders"],
      summary: "Refresh train order status from official 12306 (session required)",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const { id } = request.params as { id: string };
    const order = await prisma.order.findFirst({ where: { id, userId: user.sub } });
    if (!order) return reply.code(404).send({ error: "Not found" });
    if (order.channel !== "train") {
      return reply.code(400).send({ error: "仅火车票订单支持 12306 状态刷新" });
    }

    const preferred = (order.payload as { preferredPlatform?: PlatformKind } | null)?.preferredPlatform;
    const session = await loadSession(user.sub, "train", preferred);
    const current = fromPrismaOrderStatus(order.status);

    const live = await bookingQueryStatus({
      channel: "train",
      orderId: order.id,
      externalOrderId: order.externalOrderId,
      session,
      stubMode: stubMode(),
      currentStatus: current,
    });

    if (live.cookiesToPersist) {
      await prisma.platformCredential.upsert({
        where: {
          userId_platform: { userId: user.sub, platform: toPrismaPlatform("12306") },
        },
        create: {
          userId: user.sub,
          platform: toPrismaPlatform("12306"),
          sessionStatus: "linked",
          sessionCookieEnc: encryptSensitive(live.cookiesToPersist),
          lastVerifiedAt: new Date(),
        },
        update: {
          sessionCookieEnc: encryptSensitive(live.cookiesToPersist),
          lastVerifiedAt: new Date(),
        },
      });
    }

    // Only advance to paid when live confirmation says so with live_session source.
    let nextStatus = live.status;
    if (nextStatus === "paid") {
      const conf = live.confirmation;
      if (!conf?.confirmed || conf.source !== "live_session") {
        nextStatus = current === "awaiting_payment" ? "awaiting_payment" : current;
      }
    }

    if (nextStatus !== current) {
      try {
        assertTransition(current, nextStatus);
      } catch {
        nextStatus = current;
      }
    }

    const payload = (order.payload ?? {}) as Record<string, unknown>;
    const updated = await prisma.order.update({
      where: { id },
      data: {
        status: toPrismaOrderStatus(nextStatus),
        externalOrderId: live.externalOrderId ?? order.externalOrderId,
        amount: live.amount ?? order.amount,
        payload: asJson({
          ...payload,
          notes: live.notes,
          confirmation: live.confirmation ?? payload.confirmation,
          payDeadline: live.payDeadline,
          last12306RefreshAt: new Date().toISOString(),
        }),
      },
    });

    await notifyOrder(
      order.requestId,
      id,
      "order_12306_refresh",
      `12306 状态刷新: ${fromPrismaOrderStatus(updated.status)}`,
      live.notes,
      {
        orderId: id,
        status: fromPrismaOrderStatus(updated.status),
        confirmation: live.confirmation,
      }
    );

    return {
      ...publicOrder(updated),
      refresh: {
        notes: live.notes,
        confirmation: live.confirmation,
      },
    };
  });

  /** Stub helper: mark paid only when confirmation stub/external present — for demo payment return. */
  app.post("/orders/:id/mark-paid", {
    schema: {
      tags: ["orders"],
      summary: "Demo/stub: mark paid when awaiting_payment and stub confirmation exists",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const { id } = request.params as { id: string };
    const order = await prisma.order.findFirst({ where: { id, userId: user.sub } });
    if (!order) return reply.code(404).send({ error: "Not found" });
    const status = fromPrismaOrderStatus(order.status);
    if (status !== "awaiting_payment") {
      return reply.code(400).send({ error: `Cannot mark paid from ${status}` });
    }
    const conf = (order.payload as { confirmation?: { confirmed?: boolean; source?: string } })
      ?.confirmation;
    if (!conf?.confirmed || (conf.source !== "stub" && conf.source !== "live_session")) {
      return reply.code(400).send({
        error: "拒绝标记已支付：缺少确认字段（不会谎报成功）",
      });
    }
    assertTransition("awaiting_payment", "paid");
    const updated = await prisma.order.update({
      where: { id },
      data: { status: "paid" },
    });
    await notifyOrder(order.requestId, id, "order_paid", "订单已支付（已确认）", undefined, {
      orderId: id,
      status: "paid",
      confirmation: conf,
    });
    return publicOrder(updated);
  });
}
