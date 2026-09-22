#!/usr/bin/env node
/**
 * Live/API smoke: create 2–3 watches → list → pause A → B armed → cancel A → B intact.
 * Synthetic accounts only. TRAIN_REAL_SUBMIT stays off. Never prints secrets/full IDs.
 */
import { createHash, randomBytes } from "crypto";

const BASE = (process.env.API_BASE || "https://159.75.71.192:18444/api").replace(/\/$/, "");
const fp = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 12);

async function req(method, path, { token, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const email = `conc_${Date.now()}_${randomBytes(3).toString("hex")}@example.com`;
const password = `Cg${randomBytes(8).toString("hex")}Aa1!`;

const out = { base: BASE, steps: [], emailFp: fp(email) };

const reg = await req("POST", "/auth/register", {
  body: { email, password, name: "Concurrent E2E" },
});
assert(reg.status === 200 && reg.json.token, `register failed: ${reg.status}`);
const token = reg.json.token;
out.steps.push({ step: "register", ok: true, emailFp: fp(email), tokenFp: fp(token) });

async function makeWatch(channel, fields, intervalMinutes) {
  const created = await req("POST", "/requests", {
    token,
    body: { channel, fields, notifyOnly: true },
  });
  assert(created.status === 201, `create ${channel}: ${created.status} ${JSON.stringify(created.json)}`);
  const requestId = created.json.id;
  const watch = await req("POST", `/requests/${requestId}/watch`, {
    token,
    body: { intervalMinutes },
  });
  assert(watch.status === 201, `watch ${channel}: ${watch.status} ${JSON.stringify(watch.json)}`);
  return {
    channel,
    requestId,
    watchId: watch.json.id,
    status: watch.json.status,
  };
}

const watches = [];
watches.push(
  await makeWatch(
    "train",
    { from: "深圳北", to: "汕尾", date: "2026-10-01", passengers: 1 },
    15
  )
);
watches.push(
  await makeWatch(
    "show",
    { eventName: "演唱会", city: "上海", date: "2026-10-15", quantity: 1 },
    20
  )
);
watches.push(
  await makeWatch(
    "flight",
    { from: "SHA", to: "PEK", date: "2026-10-20", passengers: 1 },
    30
  )
);
out.steps.push({
  step: "create_3",
  ok: true,
  channels: watches.map((w) => w.channel),
  watchFp: watches.map((w) => fp(w.watchId)),
});

const list1 = await req("GET", "/grabs", { token });
assert(list1.status === 200, `list: ${list1.status}`);
assert((list1.json.items?.length ?? 0) >= 3, "list < 3");
assert(list1.json.quota?.maxActive === 10, "quota.maxActive");
for (const it of list1.json.items.slice(0, 3)) {
  assert(it.request?.channel, "channel");
  assert(it.status, "status");
  assert("nextRunAt" in it, "nextRunAt");
  assert(it.dataSourceHint?.labelZh, "dataSourceHint");
}
out.steps.push({
  step: "list",
  ok: true,
  count: list1.json.items.length,
  quota: list1.json.quota,
  sample: list1.json.items.slice(0, 3).map((i) => ({
    channel: i.request.channel,
    status: i.status,
    hasNextRunAt: i.nextRunAt != null,
    dataSource: i.dataSourceHint?.labelZh,
    travelers: i.travelers?.length ?? i.travelerIds?.length ?? 0,
    armed: i.repeatableArmed,
    watchFp: fp(i.id),
  })),
});

const A = watches[0];
const B = watches[1];

const pause = await req("POST", `/requests/${A.requestId}/watch/${A.watchId}/pause`, {
  token,
  body: {},
});
assert(pause.status === 200 && pause.json.status === "paused", `pause: ${pause.status}`);
assert(pause.json.repeatableArmed === false, "A still armed after pause");

const list2 = await req("GET", "/grabs", { token });
const itemB = list2.json.items.find((i) => i.id === B.watchId);
assert(itemB, "B missing after pause A");
assert(itemB.status !== "paused" && itemB.status !== "cancelled", `B status ${itemB.status}`);
assert(itemB.repeatableArmed === true, "B not armed after pause A");
out.steps.push({
  step: "pause_A_B_armed",
  ok: true,
  A: { status: "paused", armed: false, fp: fp(A.watchId) },
  B: { status: itemB.status, armed: itemB.repeatableArmed, fp: fp(B.watchId) },
});

const cancel = await req("POST", `/requests/${A.requestId}/watch/${A.watchId}/cancel`, {
  token,
  body: {},
});
assert(cancel.status === 200 && cancel.json.status === "cancelled", `cancel: ${cancel.status}`);
assert(cancel.json.repeatableArmed === false, "A armed after cancel");

const list3 = await req("GET", "/grabs?status=all", { token });
const itemA3 = list3.json.items.find((i) => i.id === A.watchId);
const itemB3 = list3.json.items.find((i) => i.id === B.watchId);
assert(itemA3?.status === "cancelled", "A not cancelled");
assert(itemA3?.repeatableArmed === false, "A still armed");
assert(itemB3 && itemB3.status !== "cancelled", "B cancelled wrongly");
assert(itemB3.repeatableArmed === true, "B disarmed after cancel A");
out.steps.push({
  step: "cancel_A_B_intact",
  ok: true,
  A: { status: itemA3.status, armed: itemA3.repeatableArmed },
  B: { status: itemB3.status, armed: itemB3.repeatableArmed },
});

// cleanup B + flight
for (const w of watches.slice(1)) {
  await req("POST", `/requests/${w.requestId}/watch/${w.watchId}/cancel`, { token, body: {} });
}

const health = await req("GET", "/health");
out.health = {
  trainRealSubmit: health.json.trainRealSubmit,
  bookingStub: health.json.bookingStub,
  providerMode: health.json.providerMode,
};
out.ok = out.steps.every((s) => s.ok);

console.log(JSON.stringify(out, null, 2));
if (!out.ok) process.exit(1);
