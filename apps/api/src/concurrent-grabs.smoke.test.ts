import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.js";
import { prisma } from "./lib/prisma.js";
import {
  closeQueueConnections,
  hasWatchRepeatable,
  removeWatchRepeatable,
} from "./lib/queue.js";
import { MAX_ACTIVE_WATCHES_PER_USER } from "./lib/watchLimits.js";

/**
 * concurrent-grab-management:
 * create 2–3 watches → list → pause A → B still armed → cancel A → B intact
 * + soft limit 400 when over max.
 */
describe("concurrent-grab-management", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token = "";
  const email = `concurrent-grabs-${Date.now()}@example.com`;
  const requestIds: string[] = [];
  const watchIds: string[] = [];

  before(async () => {
    process.env.PROVIDER_MODE = "fixture";
    process.env.BOOKING_STUB = "1";
    process.env.ALLOW_PUBLIC_REGISTER = "1";
    process.env.ENCRYPTION_KEY =
      process.env.ENCRYPTION_KEY || "test-encryption-key-concurrent";
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    try {
      for (const wid of watchIds) {
        const job = await prisma.watchJob.findUnique({ where: { id: wid } });
        if (job) {
          await removeWatchRepeatable({
            id: job.id,
            intervalMinutes: job.intervalMinutes,
            endsAt: job.endsAt,
            bullJobId: job.bullJobId,
          }).catch(() => undefined);
        }
      }
      for (const rid of requestIds) {
        await prisma.watchJob.deleteMany({ where: { requestId: rid } });
        await prisma.notificationEvent.deleteMany({ where: { requestId: rid } });
        await prisma.shortlistSnapshot.deleteMany({ where: { requestId: rid } });
        await prisma.ticketRequest.deleteMany({ where: { id: rid } });
      }
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        await prisma.userActivity.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
      }
    } catch {
      /* ignore */
    }
    await app.close();
    await closeQueueConnections();
    await prisma.$disconnect();
  });

  function auth() {
    return { authorization: `Bearer ${token}` };
  }

  async function createRequest(channel: string, fields: Record<string, unknown>) {
    const res = await app.inject({
      method: "POST",
      url: "/requests",
      headers: auth(),
      payload: { channel, fields, notifyOnly: true },
    });
    assert.equal(res.statusCode, 201, res.body);
    const id = res.json().id as string;
    requestIds.push(id);
    return id;
  }

  async function startWatch(requestId: string, intervalMinutes = 15) {
    const res = await app.inject({
      method: "POST",
      url: `/requests/${requestId}/watch`,
      headers: auth(),
      payload: { intervalMinutes },
    });
    assert.equal(res.statusCode, 201, res.body);
    const id = res.json().id as string;
    watchIds.push(id);
    return { id, body: res.json() };
  }

  it("register", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password: "password123", name: "Concurrent Grabs" },
    });
    assert.equal(reg.statusCode, 200, reg.body);
    token = reg.json().token;
  });

  it("creates 3 concurrent watches (train+show+flight)", async () => {
    const trainReq = await createRequest("train", {
      from: "深圳北",
      to: "汕尾",
      date: "2026-10-01",
      passengers: 1,
    });
    const showReq = await createRequest("show", {
      eventName: "演唱会",
      city: "上海",
      date: "2026-10-15",
      quantity: 1,
    });
    const flightReq = await createRequest("flight", {
      from: "SHA",
      to: "PEK",
      date: "2026-10-20",
      passengers: 1,
    });

    const a = await startWatch(trainReq, 15);
    const b = await startWatch(showReq, 20);
    const c = await startWatch(flightReq, 30);
    assert.ok(a.id && b.id && c.id);
    assert.notEqual(a.id, b.id);
  });

  it("GET /grabs lists all with channel, status, nextRunAt, dataSourceHint, quota", async () => {
    const res = await app.inject({ method: "GET", url: "/grabs", headers: auth() });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.ok(Array.isArray(body.items));
    assert.ok(body.items.length >= 3, `expected ≥3 items, got ${body.items.length}`);
    assert.equal(body.quota.maxActive, MAX_ACTIVE_WATCHES_PER_USER);
    assert.ok(body.quota.activeCount >= 3);
    assert.ok(typeof body.quota.remaining === "number");

    const channels = new Set(body.items.map((i: { request: { channel: string } }) => i.request.channel));
    assert.ok(channels.has("train"));
    assert.ok(channels.has("show"));
    assert.ok(channels.has("flight"));

    for (const item of body.items.slice(0, 3)) {
      assert.ok(item.status, "status");
      assert.ok("nextRunAt" in item);
      assert.ok(item.dataSourceHint, "dataSourceHint");
      assert.ok(item.dataSourceHint.labelZh);
      assert.ok(typeof item.repeatableArmed === "boolean");
    }
  });

  it("pause A does not disarm B", async () => {
    const list = await app.inject({ method: "GET", url: "/grabs", headers: auth() });
    const items = list.json().items as {
      id: string;
      request: { id: string; channel: string };
      status: string;
    }[];
    const train = items.find((i) => i.request.channel === "train")!;
    const show = items.find((i) => i.request.channel === "show")!;
    assert.ok(train && show);

    const pause = await app.inject({
      method: "POST",
      url: `/requests/${train.request.id}/watch/${train.id}/pause`,
      headers: auth(),
      payload: {},
    });
    assert.equal(pause.statusCode, 200, pause.body);
    assert.equal(pause.json().status, "paused");
    assert.equal(pause.json().repeatableArmed, false);

    // B still armed
    const showArmed = await hasWatchRepeatable(show.id);
    assert.equal(showArmed, true, "show watch should remain armed after pausing train");

    const after = await app.inject({ method: "GET", url: "/grabs", headers: auth() });
    const afterItems = after.json().items as {
      id: string;
      status: string;
      request: { channel: string };
      repeatableArmed?: boolean;
    }[];
    const trainAfter = afterItems.find((i) => i.id === train.id)!;
    const showAfter = afterItems.find((i) => i.id === show.id)!;
    assert.equal(trainAfter.status, "paused");
    assert.ok(showAfter.status !== "paused" && showAfter.status !== "cancelled");
    assert.equal(showAfter.repeatableArmed, true);
  });

  it("cancel A clears only A; B intact", async () => {
    const list = await app.inject({ method: "GET", url: "/grabs", headers: auth() });
    const items = list.json().items as {
      id: string;
      request: { id: string; channel: string };
    }[];
    const train = items.find((i) => i.request.channel === "train")!;
    const show = items.find((i) => i.request.channel === "show")!;

    const cancel = await app.inject({
      method: "POST",
      url: `/requests/${train.request.id}/watch/${train.id}/cancel`,
      headers: auth(),
      payload: {},
    });
    assert.equal(cancel.statusCode, 200, cancel.body);
    assert.equal(cancel.json().status, "cancelled");
    assert.equal(cancel.json().repeatableArmed, false);

    const showArmed = await hasWatchRepeatable(show.id);
    assert.equal(showArmed, true);

    const after = await app.inject({
      method: "GET",
      url: "/grabs?status=all",
      headers: auth(),
    });
    const afterItems = after.json().items as {
      id: string;
      status: string;
      repeatableArmed?: boolean;
    }[];
    const trainAfter = afterItems.find((i) => i.id === train.id)!;
    const showAfter = afterItems.find((i) => i.id === show.id)!;
    assert.equal(trainAfter.status, "cancelled");
    assert.equal(trainAfter.repeatableArmed, false);
    assert.notEqual(showAfter.status, "cancelled");
    assert.equal(showAfter.repeatableArmed, true);
  });

  it("soft limit returns clear 400 when at max", async () => {
    // Fill up to max (we already have show+flight + maybe others; pad with train watches)
    const list = await app.inject({ method: "GET", url: "/grabs", headers: auth() });
    let active = list.json().quota.activeCount as number;
    const padReq = await createRequest("train", {
      from: "北京南",
      to: "上海虹桥",
      date: "2026-11-01",
      passengers: 1,
    });
    while (active < MAX_ACTIVE_WATCHES_PER_USER) {
      await startWatch(padReq, 60);
      active += 1;
    }
    const over = await app.inject({
      method: "POST",
      url: `/requests/${padReq}/watch`,
      headers: auth(),
      payload: { intervalMinutes: 60 },
    });
    assert.equal(over.statusCode, 400, over.body);
    const body = over.json();
    assert.equal(body.code, "ACTIVE_WATCH_LIMIT");
    assert.match(String(body.message), /最多同时进行/);
    assert.equal(body.maxActive, MAX_ACTIVE_WATCHES_PER_USER);
  });
});
