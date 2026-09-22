import type { FastifyInstance } from "fastify";
import { loginSchema, registerSchema } from "@ticket-grab/shared";
import { prisma } from "../lib/prisma.js";
import { authenticate, hashPassword, verifyPassword } from "../lib/auth.js";
import { logActivity } from "../lib/activity.js";
import { env } from "../env.js";

function publicUser(user: {
  id: string;
  email: string;
  name: string | null;
  role: string;
  active: boolean;
  createdAt?: Date;
  lastLoginAt?: Date | null;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    active: user.active,
    ...(user.createdAt ? { createdAt: user.createdAt } : {}),
    ...(user.lastLoginAt !== undefined ? { lastLoginAt: user.lastLoginAt } : {}),
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/register", {
    schema: {
      tags: ["auth"],
      summary: "Register with email + password (public by default; set ALLOW_PUBLIC_REGISTER=0 to disable)",
      body: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 8 },
          name: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    if (!env.allowPublicRegister) {
      return reply.code(403).send({
        error: "Public registration disabled. Ask an admin to create your account.",
      });
    }
    const body = registerSchema.parse(request.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (existing) {
      return reply.code(409).send({ error: "Email already registered" });
    }
    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: {
        email: body.email.toLowerCase(),
        passwordHash,
        name: body.name,
        role: "user",
        active: true,
      },
    });
    const token = await reply.jwtSign(
      { sub: user.id, email: user.email, role: user.role },
      { expiresIn: env.jwtExpiresIn }
    );
    await logActivity(user.id, user.email, "register", "Public self-register");
    return { token, user: publicUser(user) };
  });

  app.post("/auth/login", {
    schema: {
      tags: ["auth"],
      summary: "Login with email + password",
      body: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string" },
          password: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }
    if (!user.active) {
      return reply.code(403).send({ error: "Account disabled. Contact an admin." });
    }
    const now = new Date();
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: now },
    });
    const token = await reply.jwtSign(
      { sub: user.id, email: user.email, role: user.role },
      { expiresIn: env.jwtExpiresIn }
    );
    await logActivity(user.id, user.email, "login", "Logged in");
    return {
      token,
      user: publicUser({ ...user, lastLoginAt: now }),
    };
  });

  app.get("/auth/me", {
    schema: {
      tags: ["auth"],
      summary: "Current user (session persist check)",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const row = await prisma.user.findUnique({
      where: { id: user.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });
    if (!row || !row.active) return reply.code(401).send({ error: "Unauthorized" });
    return { user: publicUser(row) };
  });

  app.post("/auth/logout", {
    schema: {
      tags: ["auth"],
      summary: "Client logout acknowledgement (JWT cleared client-side)",
      security: [{ bearerAuth: [] }],
    },
  }, async (request) => {
    try {
      const user = await authenticate(request);
      await logActivity(user.sub, user.email, "logout", "Logged out");
    } catch {
      /* allow logout even with expired/missing token */
    }
    return { ok: true };
  });
}
