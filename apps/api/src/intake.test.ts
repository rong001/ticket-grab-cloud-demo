import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createRequestSchema,
  routeChannel,
  searchTickets,
} from "@ticket-grab/shared";

describe("api intake validation/routing smoke", () => {
  it("validates and routes train requests", async () => {
    const body = createRequestSchema.parse({
      channel: "train",
      fields: { from: "北京南", to: "上海虹桥", date: "2026-10-01", passengers: 2 },
    });
    assert.equal(routeChannel(body.channel), "train12306");
    const shortlist = await searchTickets(body.channel, body.fields as Record<string, unknown>, "fixture");
    assert.ok(shortlist.items.length > 0);
  });

  it("rejects underspecified flight", () => {
    assert.throws(() =>
      createRequestSchema.parse({
        channel: "flight",
        fields: { from: "SZX" },
      })
    );
  });
});
