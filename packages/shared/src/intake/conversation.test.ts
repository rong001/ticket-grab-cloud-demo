import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createEmptySession,
  processTurn,
  toRequestPayload,
} from "./conversation.js";

describe("conversational intake", () => {
  it("asks channel first then collects train fields one-by-one", () => {
    let s = createEmptySession();
    let r = processTurn(s, "我想买火车票");
    assert.equal(r.session.fields.channel, "train");
    assert.equal(r.readyForConfirm, false);
    assert.ok(r.reply.includes("出发"));

    r = processTurn(r.session, "北京南到上海虹桥");
    assert.equal(r.session.fields.from, "北京南");
    assert.equal(r.session.fields.to, "上海虹桥");

    r = processTurn(r.session, "2026-10-01");
    assert.equal(r.session.fields.date, "2026-10-01");

    r = processTurn(r.session, "上午");
    assert.equal(r.session.fields.timeWindow, "06:00-12:00");

    r = processTurn(r.session, "二等座");
    assert.equal(r.session.fields.seatClass, "二等座");

    r = processTurn(r.session, "2人");
    assert.equal(r.session.fields.passengers, 2);

    r = processTurn(r.session, "现在");
    assert.equal(r.readyForConfirm, true);
    assert.ok(r.confirmation);
    const payload = toRequestPayload(r.session.fields);
    assert.equal(payload.channel, "train");
    assert.equal(payload.fields.from, "北京南");
  });

  it("handles show channel", () => {
    let s = createEmptySession();
    let r = processTurn(s, "演出");
    assert.equal(r.session.fields.channel, "show");
    r = processTurn(r.session, "周杰伦演唱会");
    assert.ok(r.session.fields.eventName);
  });
});
