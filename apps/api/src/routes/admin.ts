import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { hashPassword, requireAdmin } from "../lib/auth.js";
import { logActivity } from "../lib/activity.js";

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
  role: z.enum(["user", "admin"]).optional().default("user"),
});

const patchUserSchema = z.object({
  active: z.boolean().optional(),
  name: z.string().nullable().optional(),
  role: z.enum(["user", "admin"]).optional(),
  password: z.string().min(8).optional(),
});

export async function adminRoutes(app: FastifyInstance) {
  app.get("/admin/users", {
    schema: {
      tags: ["admin"],
      summary: "List users (admin)",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    await requireAdmin(request);
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        createdAt: true,
        lastLoginAt: true,
        _count: { select: { requests: true, orders: true } },
      },
    });
    return {
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        active: u.active,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        requestCount: u._count.requests,
        orderCount: u._count.orders,
      })),
    };
  });

  app.post("/admin/users", {
    schema: {
      tags: ["admin"],
      summary: "Create user (admin)",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const admin = await requireAdmin(request);
    const body = createUserSchema.parse(request.body);
    const email = body.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.code(409).send({ error: "Email already registered" });
    }
    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: body.name,
        role: body.role ?? "user",
        active: true,
      },
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
    await logActivity(admin.sub, admin.email, "admin_create_user", `Created user ${user.email}`, {
      userId: user.id,
      role: user.role,
    });
    return reply.code(201).send({ user });
  });

  app.patch("/admin/users/:id", {
    schema: {
      tags: ["admin"],
      summary: "Update user (admin)",
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const admin = await requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = patchUserSchema.parse(request.body ?? {});
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Not found" });

    const data: Record<string, unknown> = {};
    if (body.active !== undefined) data.active = body.active;
    if (body.name !== undefined) data.name = body.name;
    if (body.role !== undefined) data.role = body.role;
    if (body.password !== undefined) data.passwordHash = await hashPassword(body.password);

    if (!Object.keys(data).length) {
      return reply.code(400).send({ error: "No fields to update" });
    }

    const user = await prisma.user.update({
      where: { id },
      data,
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

    const parts: string[] = [];
    if (body.active !== undefined) parts.push(body.active ? "enabled" : "disabled");
    if (body.role !== undefined) parts.push(`role=${body.role}`);
    if (body.name !== undefined) parts.push("name updated");
    if (body.password !== undefined) parts.push("password reset");
    await logActivity(
      admin.sub,
      admin.email,
      "admin_update_user",
      `Updated ${user.email}: ${parts.join(", ")}`,
      { userId: user.id, changes: body }
    );

    return { user };
  });

  app.get("/admin/activity", {
    schema: {
      tags: ["admin"],
      summary: "Recent user activity (admin). Poll every ~3s with ?since=",
      security: [{ bearerAuth: [] }],
    },
  }, async (request) => {
    await requireAdmin(request);
    const q = request.query as { since?: string; limit?: string; userId?: string };
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const where: { createdAt?: { gt: Date }; userId?: string } = {};
    if (q.since) {
      const since = new Date(q.since);
      if (!Number.isNaN(since.getTime())) where.createdAt = { gt: since };
    }
    if (q.userId) where.userId = q.userId;

    const activities = await prisma.userActivity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return { activities };
  });
}
