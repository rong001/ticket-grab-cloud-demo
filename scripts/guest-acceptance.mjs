#!/usr/bin/env node
/**
 * Guest ToC acceptance: public search without token + self-register + login.
 *
 *   API_BASE=http://127.0.0.1:3001 node scripts/guest-acceptance.mjs
 *   API_BASE=https://api.example.com node scripts/guest-acceptance.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API = (process.env.API_BASE || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const lines = [];
const results = [];

function log(ok, name, detail = "") {
  results.push({ ok, name, detail });
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`;
  lines.push(line);
  console.log(line);
}

async function req(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const t0 = Date.now();
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, ms: Date.now() - t0 };
}

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const date = tomorrowISO();
const email = `guest_${Date.now()}_${randomBytes(3).toString("hex")}@example.com`;
const password = "GuestPass123!";

console.log(`API_BASE=${API}`);
console.log(`date=${date} email=${email}`);

let r;
try {
  r = await req("/public/search", {
    method: "POST",
    body: {
      channel: "train",
      fields: { from: "北京南", to: "上海虹桥", date, passengers: 1 },
    },
  });
} catch (e) {
  log(false, "public_search_network", String(e));
  r = { status: 0, data: {}, ms: 0 };
}

const items = Array.isArray(r.data?.items) ? r.data.items : [];
const noAuthRequired = r.status !== 401 && r.status !== 403;
log(
  r.status === 200 && noAuthRequired,
  "public_search_no_token",
  `status=${r.status} ms=${r.ms} liveOk=${r.data?.liveOk} count=${items.length} sample=${JSON.stringify(
    items.slice(0, 2).map((i) => i.title || i.id)
  )}`
);
log(noAuthRequired, "assert_no_login_required_for_public_search", `status=${r.status}`);

r = await req("/auth/register", {
  method: "POST",
  body: { email, password, name: "Guest Accept" },
});
log(r.status === 200 && !!r.data?.token, "register_fresh_email", `status=${r.status} err=${r.data?.error || r.data?.message || ""}`);

r = await req("/auth/login", {
  method: "POST",
  body: { email, password },
});
log(r.status === 200 && !!r.data?.token, "login_after_register", `status=${r.status}`);

const md = `# Guest acceptance

- API: \`${API}\`
- When: ${new Date().toISOString()}
- Date queried: \`${date}\` 北京南 → 上海虹桥

## Results

| Check | Result | Detail |
| --- | --- | --- |
${results.map((x) => `| ${x.name} | ${x.ok ? "PASS" : "FAIL"} | ${String(x.detail).replace(/\|/g, "/")} |`).join("\n")}

## Curl (prod verify)

\`\`\`bash
API=https://YOUR_API_HOST
DATE=$(date -u -d '+1 day' +%F 2>/dev/null || date -u -v+1d +%F)

# Public search — must NOT return 401
curl -sS -X POST "$API/public/search" \\
  -H 'content-type: application/json' \\
  -d "{\\"channel\\":\\"train\\",\\"fields\\":{\\"from\\":\\"北京南\\",\\"to\\":\\"上海虹桥\\",\\"date\\":\\"$DATE\\",\\"passengers\\":1}}" | head -c 800; echo

EMAIL="guest_$(date +%s)@example.com"
curl -sS -X POST "$API/auth/register" -H 'content-type: application/json' \\
  -d "{\\"email\\":\\"$EMAIL\\",\\"password\\":\\"GuestPass123!\\",\\"name\\":\\"Guest\\"}"; echo
curl -sS -X POST "$API/auth/login" -H 'content-type: application/json' \\
  -d "{\\"email\\":\\"$EMAIL\\",\\"password\\":\\"GuestPass123!\\"}"; echo
\`\`\`

## Log

\`\`\`
${lines.join("\n")}
\`\`\`
`;

writeFileSync(join(__dirname, "..", "GUEST_ACCEPTANCE.md"), md);
console.log("Wrote GUEST_ACCEPTANCE.md");
process.exit(results.every((x) => x.ok) ? 0 : 1);
