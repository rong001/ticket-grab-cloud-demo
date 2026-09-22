import type {
  BookingAdapter,
  PrepareCheckoutInput,
  PrepareCheckoutResult,
  QueryOrderStatusInput,
  QueryOrderStatusResult,
  SubmitOrderInput,
  SubmitOrderResult,
} from "./types.js";

function isShowPlatformLinked(input: {
  session: PrepareCheckoutInput["session"];
}): boolean {
  const p = input.session.platform;
  const okPlatform = p === "damai" || p === "maoyan";
  return (
    okPlatform &&
    input.session.sessionStatus === "linked" &&
    input.session.hasEncryptedSession
  );
}

function itemMeta(item: Record<string, unknown>) {
  const meta = (item.meta ?? {}) as Record<string, unknown>;
  return {
    tier: typeof meta.tier === "string" ? meta.tier : null,
    platform:
      typeof meta.platform === "string"
        ? meta.platform
        : "大麦/猫眼",
    title: typeof item.title === "string" ? item.title : null,
    availability:
      typeof item.availability === "string" ? item.availability : "unknown",
    price: typeof item.price === "number" ? item.price : undefined,
  };
}

function isWaitlistAvailability(availability: string): boolean {
  return availability === "waitlist" || availability === "sold_out";
}

/**
 * Show (Damai/Maoyan) booking adapter — assistive only.
 * Parity with train: session-aware prepare/submit/query, in-product checkout,
 * 候补 when sold out / waitlist, STUB-* ids only in stub mode, never fake paid.
 */
export const showBookingAdapter: BookingAdapter = {
  channel: "show",

  async prepareCheckout(input: PrepareCheckoutInput): Promise<PrepareCheckoutResult> {
    const checkoutPath = `/checkout/${input.orderId}`;
    const item = input.shortlistItem as Record<string, unknown>;
    const { tier, platform, title, availability } = itemMeta(item);
    const waitlistLikely = isWaitlistAvailability(availability);
    const linked = isShowPlatformLinked(input);

    if (!linked) {
      return {
        status: "awaiting_login",
        requiresInteractiveLogin: true,
        checkoutPath,
        nextSteps: [
          "在本产品结账页完成大麦/猫眼账号登录（WebView / 浏览器内嵌手递）",
          "登录成功后系统将保存加密会话元数据（不存明文密码）",
          "返回本页点击「提交订单」继续辅助下单或候补",
        ],
        notes:
          "演出票下单需要您本人的大麦/猫眼有效会话。请在产品内结账页完成登录，无需自行打开大麦/猫眼 App 摸索流程。",
      };
    }

    return {
      status: "draft",
      requiresInteractiveLogin: false,
      checkoutPath,
      nextSteps: waitlistLikely
        ? [
            `确认观演人与票档${tier ? `（${tier}）` : ""}后提交候补`,
            "提交成功后订单进入「候补中」，出票后再进入站内支付手递",
          ]
        : [
            `确认观演人与票档${tier ? `（${tier}）` : ""}后点击提交`,
            "提交成功后将进入站内支付手递页",
          ],
      notes: waitlistLikely
        ? `已绑定${platform}会话。当前场次/票档「${title ?? "所选项目"}」为 ${availability}，提交将走候补（候补中）。`
        : `已检测到已绑定的演出平台会话元数据（${platform}），可尝试辅助提交。`,
    };
  },

  async submitOrder(input: SubmitOrderInput): Promise<SubmitOrderResult> {
    const checkoutPath = `/checkout/${input.orderId}`;
    const paymentPath = `/checkout/${input.orderId}?step=pay`;
    const item = input.shortlistItem as Record<string, unknown>;
    const { tier, platform, title, availability, price } = itemMeta(item);
    const waitlist = isWaitlistAvailability(availability);
    const linked =
      input.session.sessionStatus === "linked" && input.session.hasEncryptedSession;

    if (!linked) {
      return {
        status: "awaiting_login",
        nextSteps: [
          `打开站内结账页 ${checkoutPath}`,
          "完成大麦/猫眼登录手递",
          "登录完成后再次点击提交",
        ],
        notes:
          "无有效演出平台会话，已切入 awaiting_login。结账在本产品域名内引导，不是甩给外部 App。",
        confirmation: { confirmed: false, source: "none" },
      };
    }

    if (input.stubMode) {
      const stubId = `STUB-SHOW-${input.orderId.slice(-8).toUpperCase()}`;
      const amount =
        typeof price === "number" ? price * input.travelers.length : undefined;

      if (waitlist) {
        return {
          status: "候补中",
          externalOrderId: stubId,
          amount,
          currency: "CNY",
          paymentPath: checkoutPath,
          nextSteps: [
            "候补排队中 — 请在站内订单页关注状态与通知",
            "出票后将通知并进入站内支付手递（无需自行打开大麦 App）",
            `票档：${tier ?? "未指定"} · 观演人 ${input.travelers.length} 人`,
          ],
          notes:
            "BOOKING_STUB / fixture：模拟已进入候补队列。真实大麦/猫眼候补仍需官方会话与交互验证，本适配器不会伪造成功出票。",
          confirmation: {
            confirmed: true,
            source: "stub",
            fields: {
              stub: true,
              externalOrderId: stubId,
              waitlist: true,
              travelerCount: input.travelers.length,
              showTitle: title,
              tier,
              platform,
              availability,
            },
          },
        };
      }

      return {
        status: "awaiting_payment",
        externalOrderId: stubId,
        amount,
        currency: "CNY",
        paymentPath,
        nextSteps: [
          `打开站内支付手递页 ${paymentPath}`,
          "按页面指引完成官方支付（会话内跳转 / 二维码）",
          "支付结果回写后订单状态变为 paid（需确认字段）",
        ],
        notes:
          "BOOKING_STUB / fixture：模拟已生成待支付演出订单。真实大麦/猫眼提交仍需官方会话与交互验证，本适配器不会伪造成功。",
        confirmation: {
          confirmed: true,
          source: "stub",
          fields: {
            stub: true,
            externalOrderId: stubId,
            waitlist: false,
            travelerCount: input.travelers.length,
            showTitle: title,
            tier,
            platform,
          },
        },
      };
    }

    // Real Damai/Maoyan booking APIs are not available. With a linked session,
    // keep the To-C path connected via assistive handoff (候补 / 待支付),
    // honestly labeled — never mark paid without confirmation fields.
    const handoffId = `HAND-SHOW-${input.orderId.slice(-8).toUpperCase()}`;
    const amount =
      typeof price === "number" ? price * input.travelers.length : undefined;
    if (waitlist) {
      return {
        status: "候补中",
        externalOrderId: handoffId,
        amount,
        currency: "CNY",
        paymentPath: checkoutPath,
        nextSteps: [
          "候补排队中 — 请在站内订单页关注状态与通知",
          "出票后将通知并进入站内支付手递（无需自行打开大麦 App）",
          `票档：${tier ?? "未指定"} · 观演人 ${input.travelers.length} 人`,
        ],
        notes:
          "已绑定演出平台会话。真实大麦/猫眼下单 API 未接入；本系统创建站内候补订单并引导支付手递，不会伪造成功出票。",
        confirmation: {
          confirmed: true,
          source: "stub",
          fields: {
            assistiveHandoff: true,
            externalOrderId: handoffId,
            waitlist: true,
            travelerCount: input.travelers.length,
            showTitle: title,
            tier,
            platform,
            availability,
          },
        },
      };
    }
    return {
      status: "awaiting_payment",
      externalOrderId: handoffId,
      amount,
      currency: "CNY",
      paymentPath,
      nextSteps: [
        `打开站内支付手递页 ${paymentPath}`,
        "按页面指引完成官方支付（会话内跳转 / 二维码）",
        "支付结果回写后订单状态变为 paid（需确认字段）",
      ],
      notes:
        "已绑定演出平台会话。真实大麦/猫眼下单 API 未接入；本系统创建站内待支付订单并引导官方收银台手递，不会谎报已支付。",
      confirmation: {
        confirmed: true,
        source: "stub",
        fields: {
          assistiveHandoff: true,
          externalOrderId: handoffId,
          waitlist: false,
          travelerCount: input.travelers.length,
          showTitle: title,
          tier,
          platform,
        },
      },
    };
  },

  async queryOrderStatus(input: QueryOrderStatusInput): Promise<QueryOrderStatusResult> {
    if (input.stubMode && input.externalOrderId?.startsWith("STUB-")) {
      return {
        status:
          input.currentStatus === "候补中"
            ? "候补中"
            : input.currentStatus === "awaiting_payment"
              ? "awaiting_payment"
              : input.currentStatus,
        externalOrderId: input.externalOrderId,
        notes:
          input.currentStatus === "候补中"
            ? "Stub 候补订单：无官方查询；状态以本系统为准，出票前保持候补中。"
            : "Stub 演出订单：无官方查询；状态以本系统为准。",
        confirmation: {
          confirmed: true,
          source: "stub",
          fields: { externalOrderId: input.externalOrderId },
        },
      };
    }
    return {
      status: input.currentStatus,
      externalOrderId: input.externalOrderId ?? undefined,
      notes: "未接入真实大麦/猫眼订单查询；请在站内结账页核对或刷新会话后重试。",
      confirmation: { confirmed: false, source: "none" },
    };
  },
};
