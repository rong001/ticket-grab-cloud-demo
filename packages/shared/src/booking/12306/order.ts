import { resolveStationTelecode } from "../../adapters/train12306.js";
import {
  KYFW,
  decodeResumeToken,
  encodeResumeToken,
  formBody,
  idTypeCode,
  parseSessionBlob,
  request12306,
  seatTypeCode,
} from "./http.js";
import { validateSession } from "./auth.js";
import type {
  CookieJar,
  FetchLike,
  OrderStatusQuery,
  OrderStatusResult,
  TrainSubmitRequest,
  TrainSubmitResult,
} from "./types.js";

export interface OrderClientOptions {
  fetchImpl?: FetchLike;
}

function fetchOf(opts?: OrderClientOptions): FetchLike {
  return opts?.fetchImpl ?? fetch;
}

function htmlToken(html: string, name: string): string | undefined {
  const re = new RegExp(`['"]${name}['"]\\s*,\\s*['"]([^'"]+)['"]`);
  const m = html.match(re);
  if (m) return m[1];
  const re2 = new RegExp(`name=["']${name}["']\\s+value=["']([^"']*)["']`, "i");
  const m2 = html.match(re2);
  return m2?.[1];
}

function parseInitDc(text: string): {
  globalRepeatSubmitToken?: string;
  keyCheckIsChange?: string;
  leftTicketStr?: string;
  trainLocation?: string;
  purposeCodes?: string;
  toStationTelecode?: string;
  fromStationTelecode?: string;
  stationTrainCode?: string;
} {
  return {
    globalRepeatSubmitToken: htmlToken(text, "globalRepeatSubmitToken") ?? text.match(/globalRepeatSubmitToken\s*=\s*'([^']+)'/)?.[1],
    keyCheckIsChange: text.match(/key_check_isChange['"]?\s*[:=]\s*['"]([^'"]+)['"]/)?.[1],
    leftTicketStr: text.match(/leftTicketStr['"]?\s*[:=]\s*['"]([^'"]+)['"]/)?.[1],
    trainLocation: text.match(/train_location['"]?\s*[:=]\s*['"]([^'"]+)['"]/)?.[1],
    purposeCodes: text.match(/purpose_codes['"]?\s*[:=]\s*['"]([^'"]+)['"]/)?.[1],
    toStationTelecode: text.match(/to_station_telecode['"]?\s*[:=]\s*['"]([^'"]+)['"]/)?.[1],
    fromStationTelecode: text.match(/from_station_telecode['"]?\s*[:=]\s*['"]([^'"]+)['"]/)?.[1],
    stationTrainCode: text.match(/station_train_code['"]?\s*[:=]\s*['"]([^'"]+)['"]/)?.[1],
  };
}

function passengerTickets(
  seat: string,
  passengers: TrainSubmitRequest["passengers"]
): { passengerTicketStr: string; oldPassengerStr: string } {
  const seatCode = seatTypeCode(seat);
  const ticketParts: string[] = [];
  const oldParts: string[] = [];
  for (const p of passengers) {
    const idCode = idTypeCode(p.idType);
    const ptype = p.passengerType === "child" ? "2" : "1";
    // seatType,0,ticketType,name,idType,idNo,mobile,save
    ticketParts.push(
      `${seatCode},0,${ptype},${p.name},${idCode},${p.idNumber},${p.mobile ?? ""},N,${p.name}`
    );
    oldParts.push(`${p.name},${idCode},${p.idNumber},${ptype}_`);
  }
  return {
    passengerTicketStr: ticketParts.join("_"),
    oldPassengerStr: oldParts.join(""),
  };
}

/**
 * Best-effort assistive submit against official OTN endpoints.
 * Stops cleanly on captcha/SMS/risk; TRAIN_BOOKING_DRY_RUN / dryRun skips final confirm.
 */
export async function submitTrainOrder(
  input: TrainSubmitRequest,
  opts?: OrderClientOptions
): Promise<TrainSubmitResult> {
  const fetchImpl = fetchOf(opts);
  const jar: CookieJar =
    typeof (input.cookies as unknown) === "string"
      ? parseSessionBlob(input.cookies as unknown as string)
      : { ...input.cookies };

  const session = await validateSession(jar, { fetchImpl });
  if (!session.ok) {
    return {
      status: "awaiting_login",
      cookies: jar,
      message: session.reason || "会话无效，请重新登录 12306",
    };
  }

  const fromCode =
    input.fromTelecode ?? (await resolveStationTelecode(input.fromStation)) ?? undefined;
  const toCode = input.toTelecode ?? (await resolveStationTelecode(input.toStation)) ?? undefined;
  if (!fromCode || !toCode) {
    return {
      status: "failed",
      cookies: jar,
      message: `无法解析车站电报码 from=${input.fromStation} to=${input.toStation}`,
      errorCode: "station_resolve",
    };
  }

  // 1) checkUser already done via validateSession

  // 2) submitOrderRequest
  const secretStr = input.secretStr ?? "";
  if (!secretStr) {
    return {
      status: "failed",
      cookies: jar,
      message:
        "短名单缺少 secretStr（余票查询 secret）。请重新查票后下单；无法伪造车次密钥。",
      errorCode: "missing_secret",
    };
  }

  const submitReq = await request12306<{
    status?: boolean;
    messages?: string[];
    data?: string;
    httpstatus?: number;
  }>(fetchImpl, jar, `${KYFW}/otn/leftTicket/submitOrderRequest`, {
    method: "POST",
    body: formBody({
      secretStr,
      train_date: input.trainDate,
      back_train_date: input.trainDate,
      tour_flag: "dc",
      purpose_codes: input.purposeCodes ?? "ADULT",
      query_from_station_name: input.fromStation,
      query_to_station_name: input.toStation,
      undefined: "",
    }),
    referer: `${KYFW}/otn/leftTicket/init?linktypeid=dc`,
  });

  if (!submitReq.ok) {
    if (submitReq.nonJson) {
      return {
        status: "needCaptcha",
        cookies: jar,
        challenge: {
          kind: "captcha",
          message: "提交下单触发验证码/风控，请在结账页完成验证后重试",
        },
        message: submitReq.error ?? "提交被拦截",
        resumeToken: encodeResumeToken({ step: "submit_captcha", cookies: jar }),
      };
    }
    return {
      status: "failed",
      cookies: jar,
      message: submitReq.error ?? "submitOrderRequest 失败",
    };
  }

  if (submitReq.data?.status === false) {
    const msg = submitReq.data.messages?.join(";") || "submitOrderRequest 拒绝";
    if (/未登录|登录|login/i.test(msg)) {
      return { status: "awaiting_login", cookies: jar, message: msg };
    }
    if (/验证码|风控/.test(msg)) {
      return {
        status: "needCaptcha",
        cookies: jar,
        challenge: { kind: "captcha", message: msg },
        message: msg,
      };
    }
    return { status: "failed", cookies: jar, message: msg };
  }

  // 3) initDc — HTML with tokens
  const initDc = await request12306<unknown>(fetchImpl, jar, `${KYFW}/otn/confirmPassenger/initDc`, {
    method: "POST",
    body: formBody({ _json_att: "" }),
    referer: `${KYFW}/otn/leftTicket/init?linktypeid=dc`,
  });
  // initDc often returns HTML even on success
  const initText = initDc.text || "";
  const tokens = parseInitDc(initText);
  if (!tokens.globalRepeatSubmitToken) {
    if (initDc.nonJson || initText.includes("login") || /验证码/.test(initText)) {
      return {
        status: "awaiting_login",
        cookies: jar,
        message: "initDc 未返回 token（可能需重新登录或通过验证码）",
      };
    }
    return {
      status: "failed",
      cookies: jar,
      message: "无法解析下单 token（12306 页面结构可能已变更）",
      errorCode: "init_dc_parse",
    };
  }

  const { passengerTicketStr, oldPassengerStr } = passengerTickets(
    input.seatType,
    input.passengers
  );

  // 4) checkOrderInfo
  const check = await request12306<{
    status?: boolean;
    data?: {
      submitStatus?: boolean;
      errMsg?: string;
      ifShowPassCode?: string;
      ifShowPassCodeTime?: string;
      isNeedExtraCode?: string;
    };
    messages?: string[];
  }>(fetchImpl, jar, `${KYFW}/otn/confirmPassenger/checkOrderInfo`, {
    method: "POST",
    body: formBody({
      cancel_flag: "2",
      bed_level_order_num: "000000000000000000000000000000",
      passengerTicketStr,
      oldPassengerStr,
      tour_flag: "dc",
      randCode: "",
      whatsSelect: "1",
      sessionId: "",
      sig: "",
      scene: "nc_login",
      _json_att: "",
      REPEAT_SUBMIT_TOKEN: tokens.globalRepeatSubmitToken,
    }),
    referer: `${KYFW}/otn/confirmPassenger/initDc`,
  });

  if (!check.ok || check.data?.status === false) {
    return {
      status: "failed",
      cookies: jar,
      message: check.data?.messages?.join(";") ?? check.error ?? "checkOrderInfo 失败",
    };
  }
  if (check.data?.data?.submitStatus === false) {
    const err = check.data.data.errMsg ?? "订单校验失败";
    if (/余票|无票|座位/.test(err)) {
      return { status: "failed", cookies: jar, message: err, errorCode: "seat_gone" };
    }
    return { status: "failed", cookies: jar, message: err };
  }
  if (check.data?.data?.ifShowPassCode === "Y") {
    return {
      status: "needCaptcha",
      cookies: jar,
      challenge: {
        kind: "captcha",
        message: "下单需验证码，请在结账页完成（不自动打码）",
      },
      message: "下单需验证码",
      resumeToken: encodeResumeToken({
        step: "order_captcha",
        cookies: jar,
        tokens,
        passengerTicketStr,
        oldPassengerStr,
        seatType: input.seatType,
      }),
    };
  }

  // 5) getQueueCount (best-effort)
  await request12306(fetchImpl, jar, `${KYFW}/otn/confirmPassenger/getQueueCount`, {
    method: "POST",
    body: formBody({
      train_date: new Date(`${input.trainDate}T00:00:00+08:00`).toString(),
      train_no: input.trainNo,
      stationTrainCode: tokens.stationTrainCode ?? input.trainNo,
      seatType: seatTypeCode(input.seatType),
      fromStationTelecode: tokens.fromStationTelecode ?? fromCode,
      toStationTelecode: tokens.toStationTelecode ?? toCode,
      leftTicket: tokens.leftTicketStr ?? "",
      purpose_codes: tokens.purposeCodes ?? "00",
      train_location: tokens.trainLocation ?? "",
      _json_att: "",
      REPEAT_SUBMIT_TOKEN: tokens.globalRepeatSubmitToken,
    }),
    referer: `${KYFW}/otn/confirmPassenger/initDc`,
  });

  if (input.dryRun || process.env.TRAIN_BOOKING_DRY_RUN === "1") {
    return {
      status: "dry_run_ok",
      cookies: jar,
      prepared: {
        trainNo: input.trainNo,
        trainDate: input.trainDate,
        from: input.fromStation,
        to: input.toStation,
        seatType: input.seatType,
        passengerCount: input.passengers.length,
        tokens: {
          hasRepeatToken: Boolean(tokens.globalRepeatSubmitToken),
          hasKeyCheck: Boolean(tokens.keyCheckIsChange),
        },
        dryRun: true,
      },
      message:
        "DRY RUN：已完成登录校验 + submitOrderRequest + initDc + checkOrderInfo，已在最终 confirm 前停止（不会产生真实待支付订单）。",
    };
  }

  // 6) confirmSingleForQueue
  const confirm = await request12306<{
    status?: boolean;
    data?: { submitStatus?: boolean; errMsg?: string };
    messages?: string[];
  }>(fetchImpl, jar, `${KYFW}/otn/confirmPassenger/confirmSingleForQueue`, {
    method: "POST",
    body: formBody({
      passengerTicketStr,
      oldPassengerStr,
      randCode: "",
      purpose_codes: tokens.purposeCodes ?? "00",
      key_check_isChange: tokens.keyCheckIsChange ?? "",
      leftTicketStr: tokens.leftTicketStr ?? "",
      train_location: tokens.trainLocation ?? "",
      choose_seats: "",
      seatDetailType: "000",
      whatsSelect: "1",
      roomType: "00",
      dwAll: "N",
      _json_att: "",
      REPEAT_SUBMIT_TOKEN: tokens.globalRepeatSubmitToken,
    }),
    referer: `${KYFW}/otn/confirmPassenger/initDc`,
  });

  if (!confirm.ok || confirm.data?.data?.submitStatus === false) {
    const err =
      confirm.data?.data?.errMsg ??
      confirm.data?.messages?.join(";") ??
      confirm.error ??
      "confirmSingleForQueue 失败";
    return { status: "failed", cookies: jar, message: err };
  }

  // 7) poll queryOrderWaitTime
  let orderId: string | undefined;
  let lastMsg = "";
  for (let i = 0; i < 10; i++) {
    const wait = await request12306<{
      data?: {
        queryOrderWaitTimeStatus?: boolean;
        waitTime?: number;
        waitCount?: number;
        orderId?: string | null;
        msg?: string;
      };
      messages?: string[];
    }>(
      fetchImpl,
      jar,
      `${KYFW}/otn/confirmPassenger/queryOrderWaitTime?random=${Date.now()}&tourFlag=dc&_json_att=&REPEAT_SUBMIT_TOKEN=${encodeURIComponent(tokens.globalRepeatSubmitToken)}`,
      {
        method: "GET",
        referer: `${KYFW}/otn/confirmPassenger/initDc`,
      }
    );
    lastMsg = wait.data?.data?.msg ?? wait.data?.messages?.join(";") ?? "";
    const oid = wait.data?.data?.orderId;
    if (oid) {
      orderId = oid;
      break;
    }
    const wt = wait.data?.data?.waitTime ?? -1;
    if (wt < 0 && !oid && i > 2) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!orderId) {
    // 候补 path hint
    if (/候补/.test(lastMsg)) {
      return {
        status: "候补中",
        cookies: jar,
        confirmation: {
          confirmed: true,
          source: "live_session",
          fields: { waitlist: true, message: lastMsg },
        },
        message: lastMsg || "已进入候补",
      };
    }
    return {
      status: "failed",
      cookies: jar,
      message: lastMsg || "排队未获得订单号（可能票已无/风控）",
      errorCode: "no_order_id",
    };
  }

  // 8) resultOrderForDcQueue / pay handoff info
  const result = await request12306<{
    data?: {
      submitStatus?: boolean;
      payOrderId?: string;
      orderId?: string;
    };
  }>(fetchImpl, jar, `${KYFW}/otn/confirmPassenger/resultOrderForDcQueue`, {
    method: "POST",
    body: formBody({
      orderSequence_no: orderId,
      _json_att: "",
      REPEAT_SUBMIT_TOKEN: tokens.globalRepeatSubmitToken,
    }),
    referer: `${KYFW}/otn/confirmPassenger/initDc`,
  });

  const payDeadline = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  return {
    status: "awaiting_payment",
    externalOrderId: orderId,
    currency: "CNY",
    payDeadline,
    paymentUrl: `${KYFW}/otn//payOrder/init?pre_pay_flag=0`,
    cookies: jar,
    confirmation: {
      confirmed: true,
      source: "live_session",
      fields: {
        externalOrderId: orderId,
        payDeadline,
        resultOrderOk: result.data?.data?.submitStatus === true,
        trainNo: input.trainNo,
        trainDate: input.trainDate,
        passengerCount: input.passengers.length,
      },
    },
    message: "下单成功，请在官方支付时限内完成支付（站内结账页手递）",
  };
}

export async function queryTrainOrderStatus(
  input: OrderStatusQuery,
  opts?: OrderClientOptions
): Promise<OrderStatusResult> {
  const fetchImpl = fetchOf(opts);
  const jar =
    typeof input.cookies === "string"
      ? parseSessionBlob(input.cookies)
      : { ...input.cookies };

  const session = await validateSession(jar, { fetchImpl });
  if (!session.ok) {
    return {
      status: "unknown",
      message: session.reason,
      cookies: jar,
      confirmation: { confirmed: false, source: "none" },
    };
  }

  // My orders — incomplete incomplete unfinished
  const res = await request12306<{
    data?: {
      orderDBList?: Array<{
        sequence_no?: string;
        order_date?: string;
        ticket_status_name?: string;
        ticket_total_price?: string | number;
      }>;
    };
    status?: boolean;
    messages?: string[];
  }>(fetchImpl, jar, `${KYFW}/otn/queryOrder/queryMyOrderNoComplete`, {
    method: "POST",
    body: formBody({ _json_att: "" }),
    referer: `${KYFW}/otn/view/train_order.html`,
  });

  if (!res.ok) {
    return {
      status: "unknown",
      externalOrderId: input.externalOrderId,
      message: res.error ?? "查询失败",
      cookies: jar,
      confirmation: { confirmed: false, source: "none" },
    };
  }

  const list = res.data?.data?.orderDBList ?? [];
  const match = input.externalOrderId
    ? list.find((o) => o.sequence_no === input.externalOrderId)
    : list[0];

  if (!match) {
    return {
      status: "unknown",
      externalOrderId: input.externalOrderId,
      message: list.length ? "未匹配到指定订单" : "无未完成订单",
      cookies: jar,
      confirmation: { confirmed: false, source: "none" },
    };
  }

  const statusName = match.ticket_status_name ?? "";
  let status: OrderStatusResult["status"] = "unknown";
  if (/待支付|未支付|支付/.test(statusName)) status = "awaiting_payment";
  else if (/已支付|已出票|改签/.test(statusName)) status = "paid";
  else if (/候补/.test(statusName)) status = "候补中";
  else if (/取消|作废/.test(statusName)) status = "cancelled";

  const amount =
    match.ticket_total_price != null ? Number(match.ticket_total_price) / 100 : undefined;

  return {
    status,
    externalOrderId: match.sequence_no,
    amount: Number.isFinite(amount) ? amount : undefined,
    message: statusName || "已查询到订单",
    cookies: jar,
    confirmation: {
      confirmed: status === "paid" || status === "awaiting_payment" || status === "候补中",
      source: "live_session",
      fields: {
        externalOrderId: match.sequence_no,
        ticketStatusName: statusName,
        orderDate: match.order_date,
      },
    },
  };
}

export function resumeFromToken(token: string): Record<string, unknown> | null {
  return decodeResumeToken(token);
}
