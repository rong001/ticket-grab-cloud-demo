import type { FastifyInstance } from "fastify";
import {
  continueLogin12306,
  linkCompleteSchema,
  linkStartSchema,
  list12306Passengers,
  login12306,
  platformKindSchema,
  serialize12306Cookies,
  train12306ContinueSchema,
  train12306LoginSchema,
  validate12306Session,
} from "@ticket-grab/shared";
import { prisma } from "../lib/prisma.js";
import { authenticate } from "../lib/auth.js";
import { logActivity } from "../lib/activity.js";
import { decryptSensitive, encryptSensitive } from "../lib/crypto.js";
import { fromPrismaPlatform, toPrismaPlatform } from "../lib/platformMap.js";

function publicCred(row: {
  id: string;
  platform: string;
  sessionStatus: string;
  vaultRef: string | null;
  sessionCookieEnc: string | null;
  lastVerifiedAt: Date | null;
  displayName: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    platform: fromPrismaPlatform(row.platform),
    sessionStatus: row.sessionStatus,
    hasSessionBlob: Boolean(row.sessionCookieEnc),
    hasVaultRef: Boolean(row.vaultRef),
    lastVerifiedAt: row.lastVerifiedAt,
    displayName: row.displayName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function bookingMode() {
  // BOOKING_STUB=0 forces real train path even if PROVIDER_MODE=fixture.
  let stub = process.env.PROVIDER_MODE === "fixture" || process.env.BOOKING_STUB === "1";
  if (process.env.BOOKING_STUB === "0") stub = false;
  const dryRun = process.env.TRAIN_BOOKING_DRY_RUN === "1";
  return {
    bookingStub: stub,
    trainBookingDryRun: dryRun,
    realTrainSubmit: !stub,
  };
}

async function save12306Cookies(
  userId: string,
  cookies: Record<string, string>,
  displayName?: string | null
) {
  const platform = toPrismaPlatform("12306");
  return prisma.platformCredential.upsert({
    where: { userId_platform: { userId, platform } },
    create: {
      userId,
      platform,
      sessionStatus: "linked",
      sessionCookieEnc: encryptSensitive(serialize12306Cookies(cookies)),
      lastVerifiedAt: new Date(),
      displayName: displayName ?? undefined,
    },
    update: {
      sessionStatus: "linked",
      sessionCookieEnc: encryptSensitive(serialize12306Cookies(cookies)),
      lastVerifiedAt: new Date(),
      displayName: displayName ?? undefined,
    },
  });
}

async function mark12306NeedsLogin(userId: string, displayName?: string | null) {
  const platform = toPrismaPlatform("12306");
  return prisma.platformCredential.upsert({
    where: { userId_platform: { userId, platform } },
    create: {
      userId,
      platform,
      sessionStatus: "needs_browser_login",
      displayName: displayName ?? undefined,
    },
    update: {
      sessionStatus: "needs_browser_login",
      displayName: displayName ?? undefined,
    },
  });
}

function loginResponse(result: Awaited<ReturnType<typeof login12306>>, cred?: unknown) {
  if (result.status === "ok") {
    return {
      status: "ok" as const,
      message: result.message,
      username: result.username,
      credential: cred,
      bookingMode: bookingMode(),
    };
  }
  if (result.status === "fail") {
    return {
      status: "fail" as const,
      message: result.message,
      error: result.message,
      errorCode: result.errorCode,
      bookingMode: bookingMode(),
    };
  }
  return {
    status: result.status,
    message: result.message,
    challenge: result.challenge,
    resumeToken: result.resumeToken,
    credential: cred,
    bookingMode: bookingMode(),
  };
}

export async function platformRoutes(app: FastifyInstance) {
  app.get("/platforms", {
    schema: {
      tags: ["platforms"],
      summary: "List platform link status for current user",
      security: [{ bearerAuth: [] }],
    },
  }, async (request) => {
    const user = await authenticate(request);
    const rows = await prisma.platformCredential.findMany({ where: { userId: user.sub } });
    const kinds = platformKindSchema.options;
    return kinds.map((platform) => {
      const row = rows.find((r) => fromPrismaPlatform(r.platform) === platform);
      if (!row) {
        return {
          platform,
          sessionStatus: "unlinked",
          hasSessionBlob: false,
          hasVaultRef: false,
          lastVerifiedAt: null,
          displayName: null,
        };
      }
      return publicCred(row);
    });
  });

  app.post("/platforms/link/start", {
    schema: {
      tags: ["platforms"],
      summary: "Start platform link — marks needs_browser_login and returns in-app handoff path",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const body = linkStartSchema.parse(request.body);
    const platform = toPrismaPlatform(body.platform);
    const row = await prisma.platformCredential.upsert({
      where: { userId_platform: { userId: user.sub, platform } },
      create: {
        userId: user.sub,
        platform,
        sessionStatus: "needs_browser_login",
        displayName: body.displayName,
      },
      update: {
        sessionStatus: "needs_browser_login",
        displayName: body.displayName ?? undefined,
      },
    });
    const platformSteps: Record<string, string[]> = {
      "12306": [
        "在站内「账号绑定」或结账页使用 12306 用户名/密码登录（官方接口）",
        "如需验证码/短信，按站内步骤完成（不自动打码）",
        "成功后会话 cookie 加密保存；切勿把密码写入日志或第三方",
      ],
      damai: [
        "在站内「账号绑定」或结账页打开大麦登录手递面板",
        "完成大麦官方登录后回传 session token（加密保存）",
        "切勿把密码明文发给本 API",
      ],
      maoyan: [
        "在站内「账号绑定」或结账页打开猫眼登录手递面板",
        "完成猫眼官方登录后回传 session token（加密保存）",
        "切勿把密码明文发给本 API",
      ],
      airline: [
        "在站内「账号绑定」或结账页打开航司/OTA 登录手递面板",
        "完成官方登录后回传 session token（加密保存）",
        "切勿把密码明文发给本 API",
      ],
    };
    return reply.code(201).send({
      credential: publicCred(row),
      nextSteps: platformSteps[body.platform] ?? platformSteps["12306"],
      handoffPath: `/accounts?platform=${body.platform}&link=1`,
      platform: body.platform,
      bookingMode: bookingMode(),
    });
  });

  app.post("/platforms/link/complete", {
    schema: {
      tags: ["platforms"],
      summary: "Complete link: store encrypted session token OR mark needs_browser_login",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const body = linkCompleteSchema.parse(request.body);
    const platform = toPrismaPlatform(body.platform);

    if (body.needsBrowserLogin && !body.sessionToken && !body.vaultRef) {
      const row = await prisma.platformCredential.upsert({
        where: { userId_platform: { userId: user.sub, platform } },
        create: {
          userId: user.sub,
          platform,
          sessionStatus: "needs_browser_login",
          displayName: body.displayName,
        },
        update: {
          sessionStatus: "needs_browser_login",
          displayName: body.displayName ?? undefined,
        },
      });
      return publicCred(row);
    }

    if (!body.sessionToken && !body.vaultRef) {
      return reply.code(400).send({
        error: "Provide sessionToken and/or vaultRef, or needsBrowserLogin=true",
      });
    }

    const row = await prisma.platformCredential.upsert({
      where: { userId_platform: { userId: user.sub, platform } },
      create: {
        userId: user.sub,
        platform,
        sessionStatus: "linked",
        sessionCookieEnc: body.sessionToken ? encryptSensitive(body.sessionToken) : null,
        vaultRef: body.vaultRef ?? null,
        lastVerifiedAt: new Date(),
        displayName: body.displayName,
      },
      update: {
        sessionStatus: "linked",
        sessionCookieEnc: body.sessionToken ? encryptSensitive(body.sessionToken) : undefined,
        vaultRef: body.vaultRef ?? undefined,
        lastVerifiedAt: new Date(),
        displayName: body.displayName ?? undefined,
      },
    });
    await logActivity(user.sub, user.email, "platform_bind", `Linked platform ${body.platform}`, {
      platform: body.platform,
    });
    return publicCred(row);
  });

  /**
   * Real 12306 login with user's own username/password against official passport APIs.
   * NEVER log username/password. On success encrypts cookies into PlatformCredential.
   */
  app.post("/platforms/12306/login", {
    schema: {
      tags: ["platforms"],
      summary: "Login to 12306 with user credentials (assistive; official endpoints)",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const body = train12306LoginSchema.parse(request.body);
    // Do not log body.password / body.username
    const result = await login12306(body.username, body.password, {
      captchaAnswer: body.captchaAnswer,
    });

    if (result.status === "ok") {
      const row = await save12306Cookies(
        user.sub,
        result.cookies,
        body.displayName ?? result.username ?? body.username
      );
      await logActivity(user.sub, user.email, "platform_bind", "Linked platform 12306 (login)", {
        platform: "12306",
      });
      return loginResponse(result, publicCred(row));
    }

    if (result.status === "needCaptcha" || result.status === "needSms" || result.status === "needFace") {
      const row = await mark12306NeedsLogin(user.sub, body.displayName ?? body.username);
      return reply.code(202).send(loginResponse(result, publicCred(row)));
    }

    await mark12306NeedsLogin(user.sub, body.displayName ?? body.username);
    return reply.code(400).send(loginResponse(result));
  });

  app.post("/platforms/12306/captcha", {
    schema: {
      tags: ["platforms"],
      summary: "Continue 12306 login after captcha answer",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const body = train12306ContinueSchema.parse(request.body);
    if (!body.captchaAnswer) {
      return reply.code(400).send({ error: "captchaAnswer required" });
    }
    const result = await continueLogin12306(body.resumeToken, {
      captchaAnswer: body.captchaAnswer,
    });
    if (result.status === "ok") {
      const row = await save12306Cookies(
        user.sub,
        result.cookies,
        body.displayName ?? result.username
      );
      return loginResponse(result, publicCred(row));
    }
    if (result.status === "needCaptcha" || result.status === "needSms" || result.status === "needFace") {
      const row = await mark12306NeedsLogin(user.sub, body.displayName);
      return reply.code(202).send(loginResponse(result, publicCred(row)));
    }
    return reply.code(400).send(loginResponse(result));
  });

  app.post("/platforms/12306/sms", {
    schema: {
      tags: ["platforms"],
      summary: "Continue 12306 login after SMS code",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const body = train12306ContinueSchema.parse(request.body);
    if (!body.smsCode) {
      return reply.code(400).send({ error: "smsCode required" });
    }
    const result = await continueLogin12306(body.resumeToken, {
      smsCode: body.smsCode,
      captchaAnswer: body.captchaAnswer,
    });
    if (result.status === "ok") {
      const row = await save12306Cookies(
        user.sub,
        result.cookies,
        body.displayName ?? result.username
      );
      return loginResponse(result, publicCred(row));
    }
    if (result.status === "needCaptcha" || result.status === "needSms" || result.status === "needFace") {
      const row = await mark12306NeedsLogin(user.sub, body.displayName);
      return reply.code(202).send(loginResponse(result, publicCred(row)));
    }
    return reply.code(400).send(loginResponse(result));
  });

  app.post("/platforms/12306/validate", {
    schema: {
      tags: ["platforms"],
      summary: "Validate stored 12306 session against checkUser",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const platform = toPrismaPlatform("12306");
    const row = await prisma.platformCredential.findUnique({
      where: { userId_platform: { userId: user.sub, platform } },
    });
    if (!row?.sessionCookieEnc) {
      return reply.code(400).send({ ok: false, reason: "未绑定 12306 会话" });
    }
    let cookies: string;
    try {
      cookies = decryptSensitive(row.sessionCookieEnc);
    } catch {
      return reply.code(400).send({ ok: false, reason: "会话解密失败" });
    }
    const result = await validate12306Session(cookies);
    if (result.ok) {
      const updated = await save12306Cookies(user.sub, result.cookies, row.displayName);
      return { ok: true, credential: publicCred(updated), bookingMode: bookingMode() };
    }
    await prisma.platformCredential.update({
      where: { id: row.id },
      data: { sessionStatus: "expired" },
    });
    return { ok: false, reason: result.reason, bookingMode: bookingMode() };
  });

  app.get("/platforms/12306/passengers", {
    schema: {
      tags: ["platforms"],
      summary: "List 12306 passengers for linked session (official getPassengerDTOs)",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const platform = toPrismaPlatform("12306");
    const row = await prisma.platformCredential.findUnique({
      where: { userId_platform: { userId: user.sub, platform } },
    });
    if (!row?.sessionCookieEnc) {
      return reply.code(400).send({ error: "未绑定 12306 会话" });
    }
    let cookies: string;
    try {
      cookies = decryptSensitive(row.sessionCookieEnc);
    } catch {
      return reply.code(400).send({ error: "会话解密失败" });
    }
    const result = await list12306Passengers(cookies);
    if (result.ok) {
      await save12306Cookies(user.sub, result.cookies, row.displayName);
    }
    // Never return full id numbers to client list — strip idNumber
    return {
      ok: result.ok,
      message: result.message,
      passengers: result.passengers.map(({ idNumber: _omit, ...rest }) => rest),
      bookingMode: bookingMode(),
    };
  });

  app.get("/platforms/:platform/status", {
    schema: { tags: ["platforms"], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const { platform: raw } = request.params as { platform: string };
    const parsed = platformKindSchema.safeParse(raw);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid platform" });
    const platform = toPrismaPlatform(parsed.data);
    const row = await prisma.platformCredential.findUnique({
      where: { userId_platform: { userId: user.sub, platform } },
    });
    if (!row) {
      return { platform: parsed.data, sessionStatus: "unlinked", hasSessionBlob: false, bookingMode: bookingMode() };
    }
    return { ...publicCred(row), bookingMode: bookingMode() };
  });

  app.delete("/platforms/:platform", {
    schema: { tags: ["platforms"], summary: "Unlink platform", security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const { platform: raw } = request.params as { platform: string };
    const parsed = platformKindSchema.safeParse(raw);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid platform" });
    const platform = toPrismaPlatform(parsed.data);
    await prisma.platformCredential.deleteMany({
      where: { userId: user.sub, platform },
    });
    return { ok: true, platform: fromPrismaPlatform(platform) };
  });
}
