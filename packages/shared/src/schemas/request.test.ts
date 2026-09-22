import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createRequestSchema,
  routeChannel,
  watchRequestSchema,
} from "./request.js";

describe("intake validation", () => {
  it("accepts valid train intake", () => {
    const parsed = createRequestSchema.parse({
      channel: "train",
      fields: { from: "深圳北", to: "汕尾", date: "2026-09-24", seatClass: "二等座" },
    });
    assert.equal(parsed.channel, "train");
    assert.equal(parsed.fields.from, "深圳北");
  });

  it("rejects train without date", () => {
    assert.throws(() =>
      createRequestSchema.parse({
        channel: "train",
        fields: { from: "A", to: "B" },
      })
    );
  });

  it("accepts show intake", () => {
    const parsed = createRequestSchema.parse({
      channel: "show",
      fields: { eventName: "周杰伦演唱会", city: "上海", quantity: 2 },
    });
    assert.equal(parsed.channel, "show");
  });

  it("accepts flight intake", () => {
    const parsed = createRequestSchema.parse({
      channel: "flight",
      fields: { from: "SZX", to: "SHA", date: "2026-09-24" },
    });
    assert.equal(parsed.channel, "flight");
  });

  it("rejects invalid channel", () => {
    assert.throws(() =>
      createRequestSchema.parse({
        channel: "bus",
        fields: {},
      })
    );
  });
});

describe("routing", () => {
  it("routes train → train12306", () => {
    assert.equal(routeChannel("train"), "train12306");
  });
  it("routes show → show", () => {
    assert.equal(routeChannel("show"), "show");
  });
  it("routes flight → flight", () => {
    assert.equal(routeChannel("flight"), "flight");
  });
});

describe("watch validation", () => {
  it("enforces ≥1 minute interval", () => {
    assert.throws(() => watchRequestSchema.parse({ intervalMinutes: 0 }));
    const ok = watchRequestSchema.parse({ intervalMinutes: 1 });
    assert.equal(ok.intervalMinutes, 1);
    const ok5 = watchRequestSchema.parse({ intervalMinutes: 5 });
    assert.equal(ok5.intervalMinutes, 5);
  });

  it("accepts 定时抢票 preferences", () => {
    const ok = watchRequestSchema.parse({
      intervalMinutes: 1,
      autoOrder: true,
      preferences: {
        preferredTrains: ["G102"],
        preferredSeats: ["二等座"],
        notify: true,
      },
    });
    assert.equal(ok.autoOrder, true);
    assert.deepEqual(ok.preferences?.preferredTrains, ["G102"]);
  });
});
