import type { FastifyInstance, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export type JwtUser = { sub: string; email: string; role?: string };

export async function authenticate(request: FastifyRequest): Promise<JwtUser> {
  const payload = await request.jwtVerify<JwtUser>();
  return payload;
}

/** Require JWT with role=admin (re-checks DB so demotions take effect). */
export async function requireAdmin(request: FastifyRequest): Promise<JwtUser> {
  const payload = await authenticate(request);
  const row = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, role: true, active: true },
  });
  if (!row || !row.active || row.role !== "admin") {
    const err = new Error("Forbidden");
    (err as { statusCode?: number }).statusCode = 403;
    throw err;
  }
  return { sub: row.id, email: row.email, role: "admin" };
}

export function registerAuth(app: FastifyInstance, secret: string, expiresIn: string) {
  // @fastify/jwt is registered in app.ts
  void secret;
  void expiresIn;
}
