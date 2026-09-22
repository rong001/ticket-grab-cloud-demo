#!/usr/bin/env node
/**
 * Upsert an admin user. Reads ADMIN_EMAIL + ADMIN_PASSWORD (required), ADMIN_NAME optional.
 *
 *   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='...' node scripts/seed-admin.mjs
 *
 * Uses DATABASE_URL from env (or loads .env if present).
 */
import { createRequire } from "module";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// Load .env lightly if vars missing
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvFile(resolve(root, ".env"));

const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || "";
const name = process.env.ADMIN_NAME || "Admin";

if (!email || !password) {
  console.error("ADMIN_EMAIL and ADMIN_PASSWORD are required");
  process.exit(1);
}
if (password.length < 8) {
  console.error("ADMIN_PASSWORD must be at least 8 characters");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const apiRequire = createRequire(resolve(root, "apps/api/package.json"));
const { PrismaClient } = apiRequire("@prisma/client");
const bcrypt = apiRequire("bcryptjs");

const prisma = new PrismaClient();

const passwordHash = await bcrypt.hash(password, 10);
const user = await prisma.user.upsert({
  where: { email },
  create: {
    email,
    passwordHash,
    name,
    role: "admin",
    active: true,
  },
  update: {
    passwordHash,
    name,
    role: "admin",
    active: true,
  },
  select: { id: true, email: true, name: true, role: true, active: true },
});

console.log("Admin upserted:", user);
await prisma.$disconnect();
