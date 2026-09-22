import { Prisma, PrismaClient } from "@prisma/client";
import {
  searchTickets,
  diffShortlists,
  type Channel,
  type ShortlistItem,
} from "@ticket-grab/shared";
import { sendNotificationEmail } from "./mail.js";

const prisma = new PrismaClient();
const providerMode = (process.env.PROVIDER_MODE as "live" | "fixture") ?? "fixture";

async function setWatchStatus(
  id: string,
  status: "queued" | "querying" | "has_tickets" | "notified" | "failed" | "cancelled" | "completed",
  reason: string,
  extra: Record<string, unknown> = {}
) {
  await prisma.watchJob.update({
    where: { id },
    data: {
      status,
      statusReason: reason,
      statusChangedAt: new Date(),
      ...(extra as object),
    } as never,
  });
}


export interface WatchJobPayload {
  watchJobId: string;
  requestId: string;
  userId: string;
}

async function logUserActivity(
  userId: string,
  email: string,
  action: string,
  summary: string,
  meta?: Record<string, unknown>
) {
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
    console.warn("[worker/activity]", err instanceof Error ? err.message : err);
  }
}

/** Assistive only: create awaiting_login draft — never bypass captcha/SMS/face. */
async function maybeAutoOrder(opts: {
  requestId: string;
  userId: string;
  userEmail: string;
  channel: Channel;
  notifyOnly: boolean;
  autoOrder: boolean;
  items: ShortlistItem[];
  preferences?: Record<string, unknown> | null;
}): Promise<string | null> {
  if (!opts.autoOrder || opts.notifyOnly) return null;
  let available = opts.items.filter(
    (i) => i.availability === "available" || i.availability === "limited"
  );
  const prefs = opts.preferences ?? {};
  const preferredTrains = Array.isArray(prefs.preferredTrains) ? prefs.preferredTrains.map(String) : [];
  const preferredSeats = Array.isArray(prefs.preferredSeats) ? prefs.preferredSeats.map(String) : [];
  const preferredTiers = Array.isArray(prefs.preferredTiers) ? prefs.preferredTiers.map(String) : [];
  if (preferredTrains.length) {
    const filtered = available.filter((i) => {
      const no = String(i.meta?.trainNo ?? i.title.split(" ")[0] ?? "");
      return preferredTrains.some((t) => no.includes(t) || i.title.includes(t));
    });
    if (filtered.length) available = filtered;
  }
  if (preferredSeats.length) {
    const filtered = available.filter((i) => {
      const seat = String(i.meta?.seatClass ?? "");
      return preferredSeats.some((s) => seat.includes(s) || i.title.includes(s) || i.subtitle?.includes(s));
    });
    if (filtered.length) available = filtered;
  }
  if (preferredTiers.length) {
    const filtered = available.filter((i) => {
      const tier = String(i.meta?.tier ?? "");
      return preferredTiers.some((t) => tier.includes(t));
    });
    if (filtered.length) available = filtered;
  }
  if (!available.length) return null;

  const travelers = await prisma.traveler.findMany({
    where: { userId: opts.userId },
    take: 5,
  });
  if (!travelers.length) {
    await prisma.notificationEvent.create({
      data: {
        requestId: opts.requestId,
        type: "watch_auto_order",
        title: "有票但仍需乘车人",
        body: "已开启自动建单，但账户下暂无乘车人/观演人。请先添加后再试。",
        payload: { reason: "no_travelers" } as unknown as Prisma.InputJsonValue,
      },
    });
    return null;
  }

  const item = available[0]!;
  const existing = await prisma.order.findFirst({
    where: {
      requestId: opts.requestId,
      status: { in: ["draft", "awaiting_login", "submitting"] },
      selectedShortlistItemId: item.id,
    },
  });
  if (existing) return existing.id;

  const order = await prisma.order.create({
    data: {
      userId: opts.userId,
      requestId: opts.requestId,
      channel: opts.channel,
      status: "awaiting_login",
      selectedShortlistItemId: item.id,
      travelerIds: [travelers[0]!.id],
      amount: typeof item.price === "number" ? item.price : null,
      currency: item.currency ?? "CNY",
      payload: {
        shortlistItem: item,
        autoCreatedByWatch: true,
        requiresUserVerification: true,
        nextSteps:
          opts.channel === "show"
            ? [
                "打开结账页，使用本人大麦/猫眼完成官方登录（验证码/短信需本人）",
                "确认场次票档与观演人后提交",
                "支付仅在大麦/猫眼官方收银台完成 — 系统不绕过登录风控",
              ]
            : opts.channel === "flight"
              ? [
                  "打开结账页，使用本人航司/OTA 完成官方登录",
                  "确认航班舱位与乘机人后提交",
                  "支付仅在官方收银台完成",
                ]
              : [
                  "打开结账页，使用本人 12306 完成官方登录（验证码/短信/人脸需本人）",
                  "确认车次席别与乘车人后提交",
                  "支付仅在 12306/官方收银台完成",
                ],
      } as unknown as Prisma.InputJsonValue,
    },
  });

  await prisma.notificationEvent.create({
    data: {
      requestId: opts.requestId,
      orderId: order.id,
      type: "watch_auto_order",
      title: `已自动创建待登录订单 · ${item.title}`,
      body: "协助建单成功。验证码/短信/人脸须本人在官方流程完成，系统不会代过验证。",
      payload: { orderId: order.id, itemId: item.id } as unknown as Prisma.InputJsonValue,
    },
  });

  await logUserActivity(
    opts.userId,
    opts.userEmail,
    "watch_auto_order",
    `Auto-created order ${order.id} for ${item.title}`,
    { orderId: order.id, requestId: opts.requestId, itemId: item.id }
  );

  if (opts.userEmail) {
    await sendNotificationEmail({
      to: opts.userEmail,
      subject: `[Ticket Grab] 已自动建单（待登录）· ${item.title}`,
      text:
        opts.channel === "show"
          ? `订单 ${order.id} 状态为 awaiting_login。请打开结账页完成大麦/猫眼登录与支付。系统不会绕过验证码/队列/登录，也不会自动扣款。`
          : `订单 ${order.id} 状态为 awaiting_login。请打开结账页完成官方登录与支付。系统不会绕过验证码/短信/人脸，也不会自动扣款。`,
    });
  }

  return order.id;
}

export async function processWatchJob(payload: WatchJobPayload): Promise<void> {
  const watch = await prisma.watchJob.findUnique({ where: { id: payload.watchJobId } });
  if (!watch || watch.status === "cancelled" || watch.status === "completed" || watch.status === "paused") {
    return;
  }
  if (watch.startsAt && watch.startsAt.getTime() > Date.now()) {
    await setWatchStatus(watch.id, "queued", "Waiting for startsAt", { nextRunAt: watch.startsAt });
    return;
  }
  if (watch.endsAt && watch.endsAt.getTime() < Date.now()) {
    await setWatchStatus(watch.id, "completed", "Ended: past endsAt");
    return;
  }

  const request = await prisma.ticketRequest.findUnique({
    where: { id: payload.requestId },
    include: { user: true, shortlists: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!request) {
    await setWatchStatus(watch.id, "failed", "TicketRequest missing");
    return;
  }

  await setWatchStatus(watch.id, "querying", "Querying upstream availability");

  let result;
  try {
    result = await searchTickets(
      request.channel as Channel,
      request.fields as Record<string, unknown>,
      providerMode
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setWatchStatus(watch.id, "failed", `Query failed: ${msg}`);
    await prisma.notificationEvent.create({
      data: {
        requestId: request.id,
        type: "watch_failed",
        title: "盯票查询失败",
        body: msg,
        payload: { watchJobId: watch.id } as unknown as Prisma.InputJsonValue,
      },
    });
    throw err;
  }

  const previousItems =
    (request.shortlists[0]?.items as unknown as ShortlistItem[] | undefined) ?? [];
  const diff = diffShortlists(previousItems, result.items);

  const snapshot = await prisma.shortlistSnapshot.create({
    data: {
      requestId: request.id,
      provider: result.provider,
      mode: result.mode,
      liveOk: result.liveOk === true,
      items: result.items as object[],
      notes: result.notes,
    },
  });

  const nextRunAt = new Date(Date.now() + watch.intervalMinutes * 60_000);
  await prisma.watchJob.update({
    where: { id: watch.id },
    data: {
      lastRunAt: new Date(),
      nextRunAt,
    },
  });

  // Honesty: never treat fixture / schedule-only / liveOk=false as bookable inventory success.
  // Aviationstack + OpenSky are schedule/ADS-B only — must not emit tickets_found / 「可抢」.
  const provider = String(result.provider ?? "");
  const scheduleOnlyFlight =
    request.channel === "flight" &&
    (provider === "opensky" ||
      provider === "aviationstack" ||
      provider === "flight" ||
      !provider ||
      result.items.some(
        (i) =>
          i.meta?.scheduleOnly === true ||
          i.meta?.inventoryHonest === false ||
          i.meta?.noPrice === true
      ));
  const inventoryUnreliable =
    result.liveOk !== true ||
    result.mode === "fixture" ||
    scheduleOnlyFlight ||
    (request.channel === "flight" &&
      provider !== "amadeus" &&
      provider !== "flight_public");

  if (inventoryUnreliable && request.channel === "flight") {
    const reason =
      result.notes ??
      "实时可售票/票价监控不可用（OpenSky/Aviationstack 时刻或 fixture / liveOk=false）";
    await setWatchStatus(watch.id, "failed", `degraded: ${reason}`, { nextRunAt });
    await prisma.notificationEvent.create({
      data: {
        requestId: request.id,
        type: "watch_failed",
        title: "航班库存监控不可用",
        body: [
          reason,
          "本 tick 不发送「发现可购票」类通知。仍可使用查询/官方跳转演示。",
          `Snapshot: ${snapshot.id}`,
        ].join("\n"),
        payload: {
          snapshotId: snapshot.id,
          liveOk: false,
          degraded: true,
          provider,
          mode: result.mode,
        } as unknown as Prisma.InputJsonValue,
        emailed: false,
      },
    });
    return;
  }

  const interesting =
    diff.availabilityImproved.length > 0 ||
    diff.added.length > 0 ||
    previousItems.length === 0;

  // Never mark seatsFound when liveOk is false (any channel).
  // Flight: only Amadeus / flight_public inventory may claim available/limited seats.
  const seatsFound =
    result.liveOk === true &&
    !(request.channel === "flight" && scheduleOnlyFlight) &&
    (request.channel !== "flight" ||
      provider === "amadeus" ||
      provider === "flight_public") &&
    result.items.some(
      (i) =>
        (i.availability === "available" || i.availability === "limited") &&
        i.meta?.scheduleOnly !== true &&
        i.meta?.noPrice !== true
    );

  const isShow = request.channel === "show";
  const title = interesting
    ? seatsFound
      ? isShow
        ? `开售/有票提醒！改进 ${diff.availabilityImproved.length} / 新增 ${diff.added.length}`
        : `发现可购票！改进 ${diff.availabilityImproved.length} / 新增 ${diff.added.length}`
      : isShow
        ? `预约抢票更新：改进 ${diff.availabilityImproved.length} / 新增 ${diff.added.length}`
        : `盯票更新：改进 ${diff.availabilityImproved.length} / 新增 ${diff.added.length}`
    : isShow
      ? `开售提醒检查：无实质变化（${result.items.length} 个场次）`
      : `盯票检查：无实质变化（${result.items.length} 个选项）`;

  const body = [
    result.notes,
    result.liveOk === false ? "数据源：非实时（fixture/回退）" : "数据源：实时",
    diff.availabilityImproved.length
      ? `Improved: ${diff.availabilityImproved.map((i) => i.title).join("; ")}`
      : null,
    `Snapshot: ${snapshot.id}`,
  ]
    .filter(Boolean)
    .join("\n");

  let emailed = false;
  if (interesting && request.user.email) {
    emailed = await sendNotificationEmail({
      to: request.user.email,
      subject: `[Ticket Grab] ${title}`,
      text: body,
    });
  }

  await prisma.notificationEvent.create({
    data: {
      requestId: request.id,
      type: interesting ? (seatsFound ? "tickets_found" : "watch_alert") : "watch_check",
      title,
      body: body,
      payload: {
        snapshotId: snapshot.id,
        liveOk: result.liveOk === true,
        diff: {
          added: diff.added.map((i) => i.id),
          removed: diff.removed.map((i) => i.id),
          improved: diff.availabilityImproved.map((i) => i.id),
        },
        // Deep-link hint only — do NOT auto-create orders on has_tickets (surprise drafts).
        createOrderHint: seatsFound
          ? {
              uiPath: "/grabs",
              apiPath: `/grabs/${watch.id}/create-order`,
              method: "POST",
              hasTravelerIds: ((watch as { travelerIds?: string[] }).travelerIds ?? []).length > 0,
              note: "有绑定乘车人时，请在「我的抢票」手动点「用已选乘客创建草稿订单」（不自动提交/扣款）",
            }
          : undefined,
      } as unknown as Prisma.InputJsonValue,
      emailed,
    },
  });

  if (interesting) {
    await logUserActivity(
      request.userId,
      request.user.email,
      seatsFound ? "watch_tickets_found" : "watch_alert",
      title,
      { requestId: request.id, watchJobId: watch.id, snapshotId: snapshot.id }
    );
  }

  if (seatsFound && interesting) {
    await setWatchStatus(watch.id, "has_tickets", title, { nextRunAt });
    await setWatchStatus(
      watch.id,
      "notified",
      emailed ? "Notification emailed" : "Notification recorded (email skipped/failed)",
      { nextRunAt }
    );
  } else {
    await setWatchStatus(watch.id, "queued", "No actionable change; waiting next interval", {
      nextRunAt,
    });
  }

  if (interesting && seatsFound && watch.autoOrder) {
    await maybeAutoOrder({
      requestId: request.id,
      userId: request.userId,
      userEmail: request.user.email,
      channel: request.channel as Channel,
      notifyOnly: request.notifyOnly,
      autoOrder: true,
      items: result.items,
      preferences: (watch as { preferences?: Record<string, unknown> | null }).preferences ?? null,
    });
  }
}
