import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { ZodError } from "zod";
import { env } from "./env.js";
import { resolveBookingFlags } from "./lib/bookingFlags.js";
import { authRoutes } from "./routes/auth.js";
import { requestRoutes } from "./routes/requests.js";
import { travelerRoutes } from "./routes/travelers.js";
import { platformRoutes } from "./routes/platforms.js";
import { orderRoutes } from "./routes/orders.js";
import { metaRoutes } from "./routes/meta.js";
import { adminRoutes } from "./routes/admin.js";
import { intakeRoutes } from "./routes/intake.js";
import { prisma } from "./lib/prisma.js";
import { getRedis } from "./lib/queue.js";
import { rateLimit } from "./lib/rateLimit.js";

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordhash",
  "token",
  "authorization",
  "cookie",
  "cookies",
  "idnumber",
  "idnumberenc",
  "sessioncookie",
  "sessioncookieenc",
  "secret",
  "client_secret",
  "amadeus_client_secret",
  "sms",
  "smscode",
  "captchaanswer",
  "resumetoken",
]);

function redactValue(key: string, value: unknown): unknown {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (SENSITIVE_KEYS.has(k) || k.includes("password") || k.includes("secret") || k.includes("cookie")) {
    return "[REDACTED]";
  }
  if (k.includes("idnumber") && typeof value === "string" && value.length > 4) {
    return `****${value.slice(-4)}`;
  }
  return value;
}

function redactObject(input: unknown, depth = 0): unknown {
  if (depth > 5 || input == null) return input;
  if (Array.isArray(input)) return input.map((v) => redactObject(v, depth + 1));
  if (typeof input !== "object") return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === "object" && v !== null) out[k] = redactObject(v, depth + 1);
    else out[k] = redactValue(k, v);
  }
  return out;
}

export async function buildApp() {
  const app = Fastify({
    logger:
      env.nodeEnv === "test"
        ? false
        : {
            level: process.env.LOG_LEVEL ?? "info",
            redact: {
              paths: [
                "req.headers.authorization",
                "req.headers.cookie",
                "req.body.password",
                "req.body.idNumber",
                "req.body.sessionCookie",
                "req.body.sessionToken",
                "req.body.smsCode",
                "req.body.captchaAnswer",
                "req.body.resumeToken",
                "req.body.client_secret",
              ],
              censor: "[REDACTED]",
            },
            serializers: {
              req(req) {
                return {
                  method: req.method,
                  url: req.url,
                  hostname: req.hostname,
                  remoteAddress: req.ip,
                };
              },
            },
          },
  });

  await app.register(cors, { origin: env.corsOrigin, credentials: true });

  // Fastify 5 rejects empty bodies with Content-Type: application/json (common on DELETE).
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      if (!body || (typeof body === "string" && body.trim() === "")) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  await app.register(jwt, { secret: env.jwtSecret });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Ticket Grab Cloud API",
        description:
          "In-system assistive ticket ops: search → watch → travelers → book/候补 → pay handoff. Legal assistive only — no scalping / captcha farms.",
        version: "1.2.0",
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
  });

  // Access log without leaking bodies containing secrets
  app.addHook("onResponse", async (request, reply) => {
    if (request.url.startsWith("/health")) return;
    const bodyPreview =
      request.body && typeof request.body === "object"
        ? redactObject(request.body)
        : undefined;
    request.log.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
        ...(env.nodeEnv === "development" && bodyPreview ? { body: bodyPreview } : {}),
      },
      "request"
    );
  });

  app.setErrorHandler((err, _request, reply) => {
    // Fastify runs route-schema validation before the handler. Without an
    // explicit mapping these errors fall through to the generic 500 response.
    const fastifyValidation = err as { code?: string; validation?: unknown };
    if (fastifyValidation.code === "FST_ERR_VALIDATION" && Array.isArray(fastifyValidation.validation)) {
      return reply.code(400).send({ error: "Validation failed", validation: fastifyValidation.validation });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", details: err.flatten() });
    }
    if ((err as { statusCode?: number }).statusCode === 401) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    if ((err as { statusCode?: number }).statusCode === 403) {
      return reply.code(403).send({ error: err instanceof Error ? err.message : "Forbidden" });
    }
    if ((err as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send({ error: "Too many requests, please retry later" });
    }
    const msg = err instanceof Error ? err.message : "Internal server error";
    if (msg.startsWith("非法订单状态流转")) {
      return reply.code(400).send({ error: msg });
    }
    app.log.error(err);
    return reply.code(500).send({ error: "Internal server error" });
  });

  app.get("/health", async () => {
    const flags = resolveBookingFlags();
    return {
      ok: true,
      providerMode: flags.providerMode,
      bookingStub: flags.bookingStub,
      trainBookingDryRun: flags.trainBookingDryRun,
      trainLiveQuery: flags.trainLiveQuery,
      trainRealSubmit: flags.trainRealSubmit,
      // Deprecated: now equals trainRealSubmit&&!bookingStub (was !bookingStub — misleading).
      realTrainSubmit: flags.realTrainSubmit,
      // Flight honesty: configured ≠ last fetch. OpenSky 429 → scheduleLive false.
      flightInventoryLive: flags.flightInventoryLive,
      flightScheduleConfigured: flags.flightScheduleConfigured,
      flightScheduleLive: flags.flightScheduleLive,
      flightFareMonitor: flags.flightFareMonitor,
      flightProvider: flags.flightProvider,
      flightLabelZh: flags.flightLabelZh,
      flightNotes: flags.flightNotes,
      flightScheduleFetchAt: flags.flightScheduleFetchAt,
    };
  });

  app.get("/health/ready", async (_request, reply) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.postgres = { ok: true };
    } catch (err) {
      checks.postgres = {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }

    try {
      const pong = await getRedis().ping();
      checks.redis = { ok: pong === "PONG" || pong === "pong", detail: String(pong) };
    } catch (err) {
      checks.redis = {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }

    const ready = Object.values(checks).every((c) => c.ok);
    return reply.code(ready ? 200 : 503).send({
      ok: ready,
      ready,
      checks,
      providerMode: env.providerMode,
    });
  });

  // Rate limits: auth (stricter), search, submit
  app.addHook("onRoute", (routeOptions) => {
    const path = routeOptions.url ?? routeOptions.path ?? "";
    const method = routeOptions.method;
    const methods = Array.isArray(method) ? method : [method];

    if (
      (path === "/auth/login" || path === "/auth/register") &&
      methods.some((m) => String(m).toUpperCase() === "POST")
    ) {
      const prev = routeOptions.onRequest;
      const hooks = [
        rateLimit({ name: "auth", max: 20, windowMs: 60_000 }),
        ...(Array.isArray(prev) ? prev : prev ? [prev] : []),
      ];
      routeOptions.onRequest = hooks;
    }

    if (path === "/requests/:id/search" && methods.some((m) => String(m).toUpperCase() === "POST")) {
      const prev = routeOptions.onRequest;
      routeOptions.onRequest = [
        rateLimit({ name: "search", max: 30, windowMs: 60_000 }),
        ...(Array.isArray(prev) ? prev : prev ? [prev] : []),
      ];
    }

    if (path === "/public/search" && methods.some((m) => String(m).toUpperCase() === "POST")) {
      const prev = routeOptions.onRequest;
      routeOptions.onRequest = [
        rateLimit({ name: "public-search", max: 10, windowMs: 60_000 }),
        ...(Array.isArray(prev) ? prev : prev ? [prev] : []),
      ];
    }

    if (path === "/intake/turn" && methods.some((m) => String(m).toUpperCase() === "POST")) {
      const prev = routeOptions.onRequest;
      routeOptions.onRequest = [
        rateLimit({ name: "intake-turn", max: 60, windowMs: 60_000 }),
        ...(Array.isArray(prev) ? prev : prev ? [prev] : []),
      ];
    }

    if (path === "/orders/:id/submit" && methods.some((m) => String(m).toUpperCase() === "POST")) {
      const prev = routeOptions.onRequest;
      routeOptions.onRequest = [
        rateLimit({ name: "submit", max: 10, windowMs: 60_000 }),
        ...(Array.isArray(prev) ? prev : prev ? [prev] : []),
      ];
    }
  });

  await app.register(authRoutes);
  await app.register(adminRoutes);
  await app.register(intakeRoutes);
  await app.register(requestRoutes);
  await app.register(travelerRoutes);
  await app.register(platformRoutes);
  await app.register(orderRoutes);
  await app.register(metaRoutes);

  return app;
}
