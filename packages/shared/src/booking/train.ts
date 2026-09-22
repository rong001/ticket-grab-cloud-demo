import {
  parseSessionBlob,
  serializeCookies,
  submitTrainOrder,
  queryTrainOrderStatus,
} from "./12306/index.js";
import type {
  BookingAdapter,
  PrepareCheckoutInput,
  PrepareCheckoutResult,
  QueryOrderStatusInput,
  QueryOrderStatusResult,
  SubmitOrderInput,
  SubmitOrderResult,
} from "./types.js";

function shortlistMeta(item: SubmitOrderInput["shortlistItem"]): Record<string, unknown> {
  if (item && typeof item === "object" && "meta" in item && item.meta && typeof item.meta === "object") {
    return item.meta as Record<string, unknown>;
  }
  return {};
}

function parseTitleRoute(title: string | undefined): { from?: string; to?: string; trainNo?: string } {
  if (!title) return {};
  const m = title.match(/^(\S+)\s+(.+?)\s*→\s*(.+)$/);
  if (!m) return {};
  return { trainNo: m[1], from: m[2].trim(), to: m[3].trim() };
}

/**
 * Train (12306) booking adapter — assistive only.
 *
 * Real path: uses official kyfw.12306.cn endpoints with the user's own session cookies.
 * Stub path: BOOKING_STUB=1 / fixture mode.
 * Never invents captcha/SMS codes; never marks paid without confirmation fields.
 */
export const trainBookingAdapter: BookingAdapter = {
  channel: "train",

  async prepareCheckout(input: PrepareCheckoutInput): Promise<PrepareCheckoutResult> {
    const checkoutPath = `/checkout/${input.orderId}`;
    const linked = input.session.sessionStatus === "linked" && input.session.hasEncryptedSession;

    if (!linked) {
      return {
        status: "awaiting_login",
        requiresInteractiveLogin: true,
        checkoutPath,
        nextSteps: [
          "在本产品结账页或账号绑定页登录您本人的 12306 账号（用户名/密码）",
          "如需验证码/短信/人脸，按站内步骤完成（不会自动打码）",
          "登录成功后系统加密保存会话 cookie，再点击「提交订单」",
        ],
        notes:
          "12306 下单需要您本人的有效会话。请在产品内完成登录，无需自行打开 12306 App 摸索流程。",
      };
    }

    return {
      status: "draft",
      requiresInteractiveLogin: false,
      checkoutPath,
      nextSteps: ["确认乘车人与车次后点击提交", "提交成功后将进入站内支付手递页（官方收银台）"],
      notes: "已检测到已绑定的 12306 会话，可尝试真实辅助提交（BOOKING_STUB 关闭时）。",
    };
  },

  async submitOrder(input: SubmitOrderInput): Promise<SubmitOrderResult> {
    const checkoutPath = `/checkout/${input.orderId}`;
    const paymentPath = `/checkout/${input.orderId}?step=pay`;
    const linked = input.session.sessionStatus === "linked" && input.session.hasEncryptedSession;

    if (!linked) {
      return {
        status: "awaiting_login",
        nextSteps: [
          `打开站内结账页 ${checkoutPath}`,
          "使用您本人 12306 账号完成登录（含验证码/短信）",
          "登录完成后再次点击提交",
        ],
        notes: "无有效会话，已切入 awaiting_login。结账在本产品域名内引导。",
        confirmation: { confirmed: false, source: "none" },
      };
    }

    if (input.stubMode) {
      const stubId = `STUB-12306-${input.orderId.slice(-8).toUpperCase()}`;
      const item = input.shortlistItem as { price?: number; title?: string };
      return {
        status: "awaiting_payment",
        externalOrderId: stubId,
        amount: typeof item.price === "number" ? item.price * input.travelers.length : undefined,
        currency: "CNY",
        paymentPath,
        nextSteps: [
          `打开站内支付手递页 ${paymentPath}`,
          "按页面指引完成官方支付（会话内跳转 / 二维码）",
          "支付结果回写后订单状态变为 paid（需确认字段）",
        ],
        notes:
          "BOOKING_STUB / fixture：模拟已生成待支付订单。真实 12306 提交请设置 BOOKING_STUB=0 并绑定有效会话。",
        confirmation: {
          confirmed: true,
          source: "stub",
          fields: {
            stub: true,
            externalOrderId: stubId,
            travelerCount: input.travelers.length,
            trainTitle: item.title ?? null,
          },
        },
      };
    }

    // —— Real path ——
    const cookiesRaw = input.session.cookies;
    if (!cookiesRaw || (typeof cookiesRaw === "string" && !cookiesRaw.trim())) {
      return {
        status: "awaiting_login",
        nextSteps: [
          `打开站内结账页 ${checkoutPath}`,
          "重新登录 12306 以写入会话 cookie",
        ],
        notes: "已标记 linked 但无解密会话内容，无法真实提交。",
        confirmation: { confirmed: false, source: "none" },
        errorMessage: "缺少会话 cookie",
      };
    }

    const jar = typeof cookiesRaw === "string" ? parseSessionBlob(cookiesRaw) : { ...cookiesRaw };
    const meta = shortlistMeta(input.shortlistItem);
    const item = input.shortlistItem as {
      title?: string;
      price?: number;
      availability?: string;
      datetime?: string;
    };
    const route = parseTitleRoute(item.title);
    const trainNo = String(meta.trainNo ?? route.trainNo ?? "");
    const fromStation = String(meta.fromName ?? route.from ?? "");
    const toStation = String(meta.toName ?? route.to ?? "");
    const fromTelecode = meta.fromTelecode ? String(meta.fromTelecode) : undefined;
    const toTelecode = meta.toTelecode ? String(meta.toTelecode) : undefined;
    const seatType = String(meta.seatClass ?? "二等座");
    const secretStr = meta.secretStr ? String(meta.secretStr) : undefined;
    const trainDate =
      (item.datetime && String(item.datetime).slice(0, 10)) ||
      (meta.date ? String(meta.date) : "") ||
      "";

    const missingId = input.travelers.filter((t) => !t.idNumber);
    if (missingId.length) {
      return {
        status: "failed",
        nextSteps: ["请确认乘车人证件号已保存，然后重试"],
        notes: "真实下单需要乘车人完整证件号（服务端解密，不会写入日志）。",
        confirmation: { confirmed: false, source: "none" },
        errorMessage: "乘车人证件号缺失",
      };
    }

    if (!trainNo || !trainDate || (!fromStation && !fromTelecode) || (!toStation && !toTelecode)) {
      return {
        status: "failed",
        nextSteps: ["请重新查票并选择车次后再下单"],
        notes: "短名单缺少车次/日期/车站信息。",
        confirmation: { confirmed: false, source: "none" },
        errorMessage: "短名单信息不完整",
      };
    }

    const dryRun = Boolean(input.dryRun) || process.env.TRAIN_BOOKING_DRY_RUN === "1";

    const result = await submitTrainOrder({
      cookies: jar,
      secretStr,
      trainNo,
      fromStation: fromStation || fromTelecode || "",
      toStation: toStation || toTelecode || "",
      fromTelecode,
      toTelecode,
      trainDate,
      seatType,
      dryRun,
      passengers: input.travelers.map((t) => ({
        name: t.name,
        idType: t.idType,
        idNumber: t.idNumber!,
        passengerType: t.type,
        mobile: t.phone,
      })),
    });

    const cookiesToPersist = serializeCookies(result.cookies);

    if (result.status === "dry_run_ok") {
      return {
        status: "awaiting_login",
        paymentPath: checkoutPath,
        nextSteps: [
          "DRY RUN 已通过鉴权与下单准备，未调用最终确认",
          "确认无误后关闭 TRAIN_BOOKING_DRY_RUN 再提交（将产生真实待支付订单）",
          "支付仍须在官方 12306 收银台完成",
        ],
        notes: result.message,
        confirmation: {
          confirmed: false,
          source: "none",
          fields: { dryRun: true, prepared: result.prepared },
        },
        cookiesToPersist,
        errorMessage: undefined,
      };
    }

    if (result.status === "awaiting_payment") {
      return {
        status: "awaiting_payment",
        externalOrderId: result.externalOrderId,
        amount: result.amount ?? (typeof item.price === "number" ? item.price * input.travelers.length : undefined),
        currency: "CNY",
        paymentPath,
        paymentUrl: result.paymentUrl,
        payDeadline: result.payDeadline,
        nextSteps: [
          `打开站内支付手递页 ${paymentPath}`,
          result.payDeadline ? `请在 ${result.payDeadline} 前完成官方支付` : "请在官方时限内支付",
          "支付成功后可通过「刷新 12306 状态」回写；无确认字段不会标记 paid",
        ],
        notes: result.message,
        confirmation: result.confirmation,
        cookiesToPersist,
      };
    }

    if (result.status === "候补中") {
      return {
        status: "候补中",
        externalOrderId: result.externalOrderId,
        paymentPath: checkoutPath,
        nextSteps: ["候补中，请关注订单页与通知", "出票后可在结账页进入支付手递"],
        notes: result.message,
        confirmation: result.confirmation,
        cookiesToPersist,
      };
    }

    if (
      result.status === "needCaptcha" ||
      result.status === "needSms" ||
      result.status === "needFace" ||
      result.status === "awaiting_login"
    ) {
      const type =
        result.status === "needSms"
          ? "sms"
          : result.status === "needFace"
            ? "face"
            : result.status === "needCaptcha"
              ? "captcha"
              : "captcha";
      return {
        status: "awaiting_login",
        nextSteps: [
          `打开站内结账页 ${checkoutPath}`,
          result.message,
          "完成验证后再次提交（不会自动打码/代收短信）",
        ],
        notes: result.message,
        confirmation: { confirmed: false, source: "none" },
        cookiesToPersist,
        interaction: {
          type: result.status === "awaiting_login" ? "captcha" : type,
          message: result.message,
          imageBase64: result.challenge?.kind === "captcha" ? result.challenge.imageBase64 : undefined,
          resumeToken: result.resumeToken,
        },
        errorMessage: result.message,
      };
    }

    return {
      status: "failed",
      nextSteps: ["根据失败原因调整后重试，或在结账页重新登录"],
      notes: result.message,
      confirmation: { confirmed: false, source: "none" },
      cookiesToPersist,
      errorMessage: result.message,
    };
  },

  async queryOrderStatus(input: QueryOrderStatusInput): Promise<QueryOrderStatusResult> {
    if (input.stubMode && input.externalOrderId?.startsWith("STUB-")) {
      return {
        status: input.currentStatus === "awaiting_payment" ? "awaiting_payment" : input.currentStatus,
        externalOrderId: input.externalOrderId,
        notes: "Stub 订单：无官方查询；状态以本系统为准。",
        confirmation: {
          confirmed: true,
          source: "stub",
          fields: { externalOrderId: input.externalOrderId },
        },
      };
    }

    if (!input.session.cookies) {
      return {
        status: input.currentStatus,
        externalOrderId: input.externalOrderId ?? undefined,
        notes: "无会话，无法向 12306 刷新订单状态。",
        confirmation: { confirmed: false, source: "none" },
      };
    }

    const jar =
      typeof input.session.cookies === "string"
        ? parseSessionBlob(input.session.cookies)
        : input.session.cookies;

    const live = await queryTrainOrderStatus({
      cookies: jar,
      externalOrderId: input.externalOrderId ?? undefined,
    });

    return {
      status:
        live.status === "unknown"
          ? input.currentStatus
          : live.status === "paid" ||
              live.status === "awaiting_payment" ||
              live.status === "候补中" ||
              live.status === "cancelled" ||
              live.status === "failed"
            ? live.status
            : input.currentStatus,
      externalOrderId: live.externalOrderId ?? input.externalOrderId ?? undefined,
      amount: live.amount,
      payDeadline: live.payDeadline,
      notes: live.message,
      confirmation: live.confirmation,
      cookiesToPersist: serializeCookies(live.cookies),
    };
  },
};
