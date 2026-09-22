import type { FastifyInstance, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export type JwtUser = { sub: string; email: string };

export async function authenticate(request: FastifyRequest): Promise<JwtUser> {
  const payload = await request.jwtVerify<JwtUser>();
  return payload;
}

/** Admin gate for /admin/* routes — loads role from DB (JWT has no role claim). */
export async function requireAdmin(
  request: FastifyRequest
): Promise<JwtUser & { role: string }> {
  const user = await authenticate(request);
  const row = await prisma.user.findUnique({
    where: { id: user.sub },
    select: { role: true, active: true },
  });
  if (!row || row.active === false || row.role !== "admin") {
    const err = new Error("Forbidden") as Error & { statusCode: number };
    err.statusCode = 403;
    throw err;
  }
  return { ...user, role: row.role };
}

export function registerAuth(app: FastifyInstance, secret: string, expiresIn: string) {
  // @fastify/jwt is registered in app.ts
  void secret;
  void expiresIn;
}
