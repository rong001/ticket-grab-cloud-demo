import type {
  BookingAdapter,
  PrepareCheckoutInput,
  PrepareCheckoutResult,
  QueryOrderStatusInput,
  QueryOrderStatusResult,
  SubmitOrderInput,
  SubmitOrderResult,
} from "./types.js";

function itemMeta(item: Record<string, unknown>) {
  const meta = (item.meta ?? {}) as Record<string, unknown>;
  const cabinFromMeta = typeof meta.cabin === "string" ? meta.cabin : null;
  const flightNo = typeof meta.flightNo === "string" ? meta.flightNo : null;
  return {
    cabin: cabinFromMeta,
    flightNo,
    title: typeof item.title === "string" ? item.title : null,
    price: typeof item.price === "number" ? item.price : undefined,
  };
}

const CABIN_LABEL: Record<string, string> = {
  economy: "经济舱",
  business: "公务舱",
  first: "头等舱",
  premium_economy: "超级经济舱",
};

function cabinLabel(cabin: string | null): string {
  if (!cabin) return "舱位未指定";
  return CABIN_LABEL[cabin] ?? cabin;
}

/**
 * Flight (airline/OTA) booking adapter — assistive only.
 * Parity with train: session-aware prepare/submit/query, in-product checkout,
 * STUB-* ids only in stub mode, never fake paid.
 */
export const flightBookingAdapter: BookingAdapter = {
  channel: "flight",

  async prepareCheckout(input: PrepareCheckoutInput): Promise<PrepareCheckoutResult> {
    const checkoutPath = `/checkout/${input.orderId}`;
    const item = input.shortlistItem as Record<string, unknown>;
    const { cabin, flightNo, title } = itemMeta(item);
    const linked =
      input.session.platform === "airline" &&
      input.session.sessionStatus === "linked" &&
      input.session.hasEncryptedSession;

    if (!linked) {
      return {
        status: "awaiting_login",
        requiresInteractiveLogin: true,
        checkoutPath,
        nextSteps: [
          "在本产品结账页完成航司/OTA 账号登录（WebView / 浏览器内嵌手递）",
          "登录成功后系统将保存加密会话元数据（不存明文密码）",
          "返回本页点击「提交订单」继续辅助下单",
        ],
        notes:
          "机票下单需要您本人的航司/OTA 有效会话。请在产品内结账页完成登录，无需自行打开航司 App 摸索流程。",
      };
    }

    return {
      status: "draft",
      requiresInteractiveLogin: false,
      checkoutPath,
      nextSteps: [
        `确认乘机人与舱位（${cabinLabel(cabin)}${flightNo ? ` · ${flightNo}` : ""}）后点击提交`,
        "提交成功后将进入站内支付手递页",
      ],
      notes: `已检测到已绑定的航司会话语据，可尝试辅助提交（${title ?? "所选航班"}）。`,
    };
  },

  async submitOrder(input: SubmitOrderInput): Promise<SubmitOrderResult> {
    const checkoutPath = `/checkout/${input.orderId}`;
    const paymentPath = `/checkout/${input.orderId}?step=pay`;
    const item = input.shortlistItem as Record<string, unknown>;
    const { cabin, flightNo, title, price } = itemMeta(item);
    const linked =
      input.session.sessionStatus === "linked" && input.session.hasEncryptedSession;

    if (!linked) {
      return {
        status: "awaiting_login",
        nextSteps: [
          `打开站内结账页 ${checkoutPath}`,
          "完成航司/OTA 登录手递",
          "登录完成后再次点击提交",
        ],
        notes:
          "无有效航司会话，已切入 awaiting_login。结账在本产品域名内引导，不是甩给外部 App。",
        confirmation: { confirmed: false, source: "none" },
      };
    }

    if (input.stubMode) {
      const stubId = `STUB-FLT-${input.orderId.slice(-8).toUpperCase()}`;
      return {
        status: "awaiting_payment",
        externalOrderId: stubId,
        amount: typeof price === "number" ? price * input.travelers.length : undefined,
        currency: "CNY",
        paymentPath,
        nextSteps: [
          `打开站内支付手递页 ${paymentPath}`,
          "按页面指引完成官方支付（会话内跳转 / 二维码）",
          "支付结果回写后订单状态变为 paid（需确认字段）",
        ],
        notes:
          "BOOKING_STUB / fixture：模拟已生成待支付机票订单。真实航司提交仍需官方会话与交互验证，本适配器不会伪造成功。",
        confirmation: {
          confirmed: true,
          source: "stub",
          fields: {
            stub: true,
            externalOrderId: stubId,
            travelerCount: input.travelers.length,
            flightTitle: title,
            flightNo,
            cabin,
            cabinLabel: cabinLabel(cabin),
          },
        },
      };
    }

    // Real airline/OTA booking APIs are not available. With a linked session,
    // keep the To-C path connected via assistive payment handoff.
    const handoffId = `HAND-FLT-${input.orderId.slice(-8).toUpperCase()}`;
    return {
      status: "awaiting_payment",
      externalOrderId: handoffId,
      amount: typeof price === "number" ? price * input.travelers.length : undefined,
      currency: "CNY",
      paymentPath,
      nextSteps: [
        `打开站内支付手递页 ${paymentPath}`,
        "按页面指引完成官方支付（会话内跳转 / 二维码）",
        "支付结果回写后订单状态变为 paid（需确认字段）",
      ],
      notes:
        "已绑定航司/OTA 会话。真实航司下单 API 未接入；本系统创建站内待支付订单并引导官方收银台手递，不会谎报已支付。",
      confirmation: {
        confirmed: true,
        source: "stub",
        fields: {
          assistiveHandoff: true,
          externalOrderId: handoffId,
          travelerCount: input.travelers.length,
          flightTitle: title,
          flightNo,
          cabin,
          cabinLabel: cabinLabel(cabin),
        },
      },
    };
  },

  async queryOrderStatus(input: QueryOrderStatusInput): Promise<QueryOrderStatusResult> {
    if (input.stubMode && input.externalOrderId?.startsWith("STUB-")) {
      return {
        status:
          input.currentStatus === "awaiting_payment"
            ? "awaiting_payment"
            : input.currentStatus,
        externalOrderId: input.externalOrderId,
        notes: "Stub 机票订单：无官方查询；状态以本系统为准。",
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
      notes: "未接入真实航司订单查询；请在站内结账页核对或刷新会话后重试。",
      confirmation: { confirmed: false, source: "none" },
    };
  },
};
