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

  it("asks exact stations for city-only 北京/上海", () => {
    let s = createEmptySession();
    let r = processTurn(s, "下周北京到上海高铁，二等座");
    assert.equal(r.session.fields.channel, "train");
    assert.equal(r.readyForConfirm, false);
    assert.ok(
      /确切出发站|多个车站|北京南/.test(r.reply),
      `expected station disambiguation, got: ${r.reply}`
    );
    assert.equal(r.session.fields.from, undefined);
    assert.equal(r.session.fields.fromCity, "北京");
  });

  it("asks exact date when only weekday given", () => {
    let s = createEmptySession();
    let r = processTurn(s, "周五晚上广州南到深圳北");
    assert.equal(r.session.fields.channel, "train");
    assert.equal(r.session.fields.from, "广州南");
    assert.equal(r.session.fields.to, "深圳北");
    assert.equal(r.readyForConfirm, false);
    // date should remain unset (weekday ambiguous)
    assert.equal(r.session.fields.date, undefined);
    assert.ok(/日期|YYYY-MM-DD|确切/.test(r.reply), `expected date ask, got: ${r.reply}`);
  });

  it("asks missing show fields one-by-one without creating", () => {
    let s = createEmptySession();
    let r = processTurn(s, "周杰伦演唱会上海");
    assert.equal(r.session.fields.channel, "show");
    assert.equal(r.readyForConfirm, false);
    assert.ok(r.missing === "venue" || r.missing === "date" || r.missing === "eventName" || r.missing === "tier" || r.missing === "passengers" || r.missing === "grabStartAt");
  });

  it("asks 票档 for show after date (does not treat YYYY-MM-DD as tier)", () => {
    let s = createEmptySession();
    let r = processTurn(s, "周杰伦演唱会上海");
    assert.equal(r.session.fields.channel, "show");
    r = processTurn(r.session, "未知"); // venue
    r = processTurn(r.session, "2026-12-31"); // date
    assert.equal(r.session.fields.date, "2026-12-31");
    assert.equal(r.session.fields.tier, undefined);
    assert.equal(r.session.fields.grabStartAt, undefined);
    assert.equal(r.missing, "tier");
    assert.ok(/票档/.test(r.reply), r.reply);
    assert.equal(r.readyForConfirm, false);
  });
