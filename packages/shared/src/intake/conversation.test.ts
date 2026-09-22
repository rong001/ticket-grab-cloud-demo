import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createEmptySession,
  processTurn,
  toRequestPayload,
  isValidStationToken,
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
    assert.equal(r.session.fields.date, undefined);
    assert.ok(/日期|YYYY-MM-DD|确切/.test(r.reply), `expected date ask, got: ${r.reply}`);
  });

  it("asks missing show fields one-by-one without creating", () => {
    let s = createEmptySession();
    let r = processTurn(s, "周杰伦演唱会上海");
    assert.equal(r.session.fields.channel, "show");
    assert.equal(r.readyForConfirm, false);
    assert.ok(
      r.missing === "venue" ||
        r.missing === "date" ||
        r.missing === "eventName" ||
        r.missing === "tier" ||
        r.missing === "passengers" ||
        r.missing === "grabStartAt"
    );
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
});

describe("P1 Chinese intake parsing", () => {
  it("does not glue YYYY-MM-DD onto stations; parses 两张", () => {
    const r = processTurn(
      createEmptySession(),
      "2026-09-29北京南到上海虹桥，08:00-10:00，二等座，两张"
    );
    assert.equal(r.session.fields.channel, "train");
    assert.equal(r.session.fields.from, "北京南");
    assert.equal(r.session.fields.to, "上海虹桥");
    assert.equal(r.session.fields.date, "2026-09-29");
    assert.equal(r.session.fields.timeWindow, "08:00-10:00");
    assert.equal(r.session.fields.seatClass, "二等座");
    assert.equal(r.session.fields.passengers, 2);
    assert.notEqual(r.missing, "passengers");
    assert.notEqual(r.session.fields.from, "2026-09");
  });

  it("parses spaced synonym with 两人", () => {
    const r = processTurn(
      createEmptySession(),
      "2026-09-29 北京南到上海虹桥 08:00-10:00 二等座 两人"
    );
    assert.equal(r.session.fields.from, "北京南");
    assert.equal(r.session.fields.to, "上海虹桥");
    assert.equal(r.session.fields.passengers, 2);
    assert.equal(r.session.fields.date, "2026-09-29");
  });

  it("parses 9月29日 + arrow + 二等 + 两张票", () => {
    const r = processTurn(
      createEmptySession(),
      "9月29日北京南→上海虹桥，上午8点到10点，二等，两张票"
    );
    assert.equal(r.session.fields.from, "北京南");
    assert.equal(r.session.fields.to, "上海虹桥");
    assert.equal(r.session.fields.passengers, 2);
    assert.equal(r.session.fields.seatClass, "二等座");
    assert.ok(r.session.fields.date?.endsWith("-09-29"));
    assert.equal(r.session.fields.timeWindow, "08:00-10:00");
    assert.equal(r.session.fields.grabStartAt, undefined);
    assert.equal(r.readyForConfirm, false);
    assert.equal(r.confirmation, undefined);
    assert.equal(r.missing, "grabStartAt");
  });

  it("parses date after stations + 2张", () => {
    const r = processTurn(
      createEmptySession(),
      "北京南到上海虹桥 2026-09-29 二等座 2张"
    );
    assert.equal(r.session.fields.from, "北京南");
    assert.equal(r.session.fields.to, "上海虹桥");
    assert.equal(r.session.fields.date, "2026-09-29");
    assert.equal(r.session.fields.passengers, 2);
  });

  it("rejects fake stations — no confirmation card", () => {
    const r = processTurn(
      createEmptySession(),
      "2026-09-29假车站到另一个假站，二等座，两张"
    );
    assert.equal(r.session.fields.channel, "train");
    assert.equal(r.session.fields.from, undefined);
    assert.equal(r.session.fields.to, undefined);
    assert.equal(r.readyForConfirm, false);
    assert.equal(r.confirmation, undefined);
    assert.ok(r.missing === "from" || r.missing === "to");
  });

  it("rejects digit-only / date-looking from/to tokens", () => {
    assert.equal(isValidStationToken("2026-09"), false);
    assert.equal(isValidStationToken("29北京南到上海虹桥"), false);
    assert.equal(isValidStationToken("12345"), false);
    assert.equal(isValidStationToken("北京南"), true);
    assert.equal(isValidStationToken("上海虹桥"), true);
  });

  it("parses Chinese numerals 三张 / 一个人 / 2位", () => {
    let r = processTurn(createEmptySession(), "北京南到上海虹桥 三张 二等座");
    assert.equal(r.session.fields.passengers, 3);
    r = processTurn(createEmptySession(), "北京南到广州南 一个人 二等座");
    assert.equal(r.session.fields.passengers, 1);
    r = processTurn(createEmptySession(), "深圳北到广州南 2位 一等座");
    assert.equal(r.session.fields.passengers, 2);
  });

  it("partial route keeps asking; no confirm", () => {
    const r = processTurn(createEmptySession(), "只要北京南出发，二等座，两张");
    assert.equal(r.readyForConfirm, false);
    assert.ok(!r.confirmation);
  });
});

describe("P1b grabStartAt vs travel timeWindow", () => {
  const fixedNow = new Date("2026-09-22T04:00:00.000Z"); // Asia/Shanghai 12:00

  it("failing sentence: timeWindow set, grabStartAt missing, ready=false", () => {
    const r = processTurn(
      createEmptySession(),
      "9月29日北京南→上海虹桥，上午8点到10点，二等，两张票",
      fixedNow
    );
    assert.equal(r.session.fields.timeWindow, "08:00-10:00");
    assert.equal(r.session.fields.grabStartAt, undefined);
    assert.equal(r.readyForConfirm, false);
    assert.equal(r.confirmation, undefined);
    assert.equal(r.missing, "grabStartAt");
    assert.ok(/盯票|抢票|开抢/.test(r.reply), r.reply);
  });

  it("上午8点到10点 alone is timeWindow, not grabStartAt", () => {
    let s = createEmptySession();
    let r = processTurn(s, "火车", fixedNow);
    r = processTurn(r.session, "北京南到上海虹桥", fixedNow);
    r = processTurn(r.session, "2026-09-29", fixedNow);
    r = processTurn(r.session, "上午8点到10点", fixedNow);
    assert.equal(r.session.fields.timeWindow, "08:00-10:00");
    assert.equal(r.session.fields.grabStartAt, undefined);
    assert.notEqual(r.missing, "grabStartAt"); // still need seat/pax before grab
  });

  it("明天8点开抢 sets future grabStartAt", () => {
    const r = processTurn(
      createEmptySession(),
      "北京南到上海虹桥 2026-09-29 08:00-10:00 二等座 两张 明天8点开抢",
      fixedNow
    );
    assert.ok(r.session.fields.grabStartAt, "grabStartAt should be set");
    const g = new Date(r.session.fields.grabStartAt!);
    assert.ok(g.getTime() > fixedNow.getTime(), `expected future, got ${r.session.fields.grabStartAt}`);
    // 2026-09-23 08:00 +08:00 = 2026-09-23T00:00:00.000Z
    assert.equal(r.session.fields.grabStartAt, "2026-09-23T00:00:00.000Z");
  });

  it("9月29日8点出发 is travel, not grabStartAt", () => {
    const r = processTurn(
      createEmptySession(),
      "9月29日8点出发 北京南到上海虹桥 二等座 两张票",
      fixedNow
    );
    assert.ok(r.session.fields.date?.endsWith("-09-29"));
    assert.equal(r.session.fields.grabStartAt, undefined);
    assert.equal(r.readyForConfirm, false);
    // timeWindow should capture departure clock or daypart; at least not grab
    assert.ok(
      r.session.fields.timeWindow === "08:00" ||
        r.session.fields.timeWindow === "06:00-12:00" ||
        r.missing === "timeWindow" ||
        r.missing === "grabStartAt" ||
        r.missing === "seatClass" ||
        r.missing === "passengers" ||
        r.missing === "from" ||
        r.missing === "to"
    );
    assert.ok(!r.confirmation);
  });

  it("bare 8点 with time window present must not invent grabStartAt", () => {
    const r = processTurn(
      createEmptySession(),
      "2026-09-29北京南到上海虹桥，上午8点到10点，二等座，两张",
      fixedNow
    );
    assert.equal(r.session.fields.timeWindow, "08:00-10:00");
    assert.equal(r.session.fields.grabStartAt, undefined);
    assert.equal(r.readyForConfirm, false);
  });

  it("现在 sets grabStartAt ≈ now when other fields complete", () => {
    let r = processTurn(
      createEmptySession(),
      "2026-09-29北京南到上海虹桥，08:00-10:00，二等座，两张",
      fixedNow
    );
    assert.equal(r.missing, "grabStartAt");
    r = processTurn(r.session, "现在", fixedNow);
    assert.ok(r.session.fields.grabStartAt);
    assert.equal(r.readyForConfirm, true);
  });

  it("立刻开抢 in free-form sets grabStartAt", () => {
    const r = processTurn(
      createEmptySession(),
      "北京南到上海虹桥 2026-09-29 08:00-10:00 二等座 2人 立刻开抢",
      fixedNow
    );
    assert.ok(r.session.fields.grabStartAt);
    assert.equal(r.readyForConfirm, true);
  });

  it("past grabStartAt short answer is rejected — ask again", () => {
    let r = processTurn(
      createEmptySession(),
      "2026-09-29北京南到上海虹桥，08:00-10:00，二等座，两张",
      fixedNow
    );
    assert.equal(r.missing, "grabStartAt");
    // 今天 08:00 Shanghai while now is 12:00 Shanghai → past
    r = processTurn(r.session, "今天8点", fixedNow);
    assert.equal(r.session.fields.grabStartAt, undefined);
    assert.equal(r.readyForConfirm, false);
    assert.equal(r.missing, "grabStartAt");
  });
});

describe("full station index + small HSR stops", () => {
  const fixedNow = new Date("2026-09-22T04:00:00.000Z");

  for (const station of ["嘉兴南", "虎门", "韶关东", "龙岩"] as const) {
    it(`accepts small station ${station} through to confirm`, () => {
      let r = processTurn(createEmptySession(), "火车", fixedNow);
      r = processTurn(r.session, `${station}到深圳北`, fixedNow);
      assert.equal(r.session.fields.from, station);
      assert.equal(r.session.fields.to, "深圳北");
      r = processTurn(r.session, "2026-12-01", fixedNow);
      r = processTurn(r.session, "不限", fixedNow);
      r = processTurn(r.session, "二等座", fixedNow);
      r = processTurn(r.session, "1人", fixedNow);
      r = processTurn(r.session, "2026-11-01 09:00", fixedNow);
      assert.equal(r.readyForConfirm, true);
      assert.ok(r.confirmation);
      assert.equal(r.session.fields.from, station);
    });
  }

  it("rejects nonsense stations — no confirm", () => {
    const r = processTurn(
      createEmptySession(),
      "假车站到另一个假站 2026-12-01 二等座 1人 现在",
      fixedNow
    );
    assert.equal(r.readyForConfirm, false);
    assert.equal(r.confirmation, undefined);
    assert.ok(!r.session.fields.from || !isValidStationToken(r.session.fields.from));
  });
});

describe("show multi-turn full path", () => {
  const fixedNow = new Date("2026-09-22T04:00:00.000Z");
  it("asks venue→date→tier→pax→grabStart; confirm only when complete", () => {
    let r = processTurn(createEmptySession(), "演出", fixedNow);
    assert.equal(r.session.fields.channel, "show");
    r = processTurn(r.session, "周杰伦嘉年华演唱会", fixedNow);
    assert.ok(r.session.fields.eventName);
    assert.equal(r.readyForConfirm, false);
    r = processTurn(r.session, "梅赛德斯-奔驰文化中心", fixedNow);
    assert.equal(r.session.fields.venue, "梅赛德斯-奔驰文化中心");
    r = processTurn(r.session, "2026-12-31", fixedNow);
    assert.equal(r.missing, "tier");
    r = processTurn(r.session, "内场680", fixedNow);
    assert.ok(r.session.fields.tier);
    r = processTurn(r.session, "2人", fixedNow);
    assert.equal(r.missing, "grabStartAt");
    assert.ok(/开售|开抢|盯票|大麦|猫眼/.test(r.reply), r.reply);
    r = processTurn(r.session, "2026-11-15 10:00", fixedNow);
    assert.equal(r.readyForConfirm, true);
    assert.ok(r.confirmation);
    assert.ok(/大麦|猫眼|官方/.test(r.confirmation!.capabilityNote));
    assert.ok(!/自动抢购|自动购票|无人值守/.test(r.confirmation!.capabilityNote) || /不含|不做/.test(r.confirmation!.capabilityNote));
  });

  it("missing venue → no confirm", () => {
    let r = processTurn(createEmptySession(), "周杰伦演唱会", fixedNow);
    assert.equal(r.readyForConfirm, false);
    assert.ok(r.missing === "venue" || r.missing === "date" || r.missing === "eventName");
  });
});

describe("flight multi-turn + airport disambiguation", () => {
  const fixedNow = new Date("2026-09-22T04:00:00.000Z");

  it("city 北京 → ask PEK/PKX; no confirm until resolved", () => {
    let r = processTurn(createEmptySession(), "机票", fixedNow);
    r = processTurn(r.session, "北京到上海", fixedNow);
    assert.equal(r.readyForConfirm, false);
    assert.ok(
      r.missing === "from" || r.missing === "to",
      `expected from/to missing, got ${r.missing}`
    );
    assert.ok(/机场|PEK|PKX|首都|大兴/.test(r.reply), r.reply);
    r = processTurn(r.session, "PKX", fixedNow);
    assert.ok(r.session.fields.from?.includes("PKX") || r.session.fields.from?.includes("大兴"));
  });

  it("SZX to PVG concrete path reaches confirm", () => {
    let r = processTurn(createEmptySession(), "机票", fixedNow);
    r = processTurn(r.session, "SZX到PVG", fixedNow);
    assert.ok(r.session.fields.from?.includes("SZX"));
    assert.ok(r.session.fields.to?.includes("PVG"));
    r = processTurn(r.session, "2026-12-01", fixedNow);
    r = processTurn(r.session, "不限", fixedNow);
    r = processTurn(r.session, "经济舱", fixedNow);
    r = processTurn(r.session, "1人", fixedNow);
    r = processTurn(r.session, "2026-11-01 09:00", fixedNow);
    assert.equal(r.readyForConfirm, true);
    assert.ok(r.confirmation);
    assert.ok(/航司|OTA|官方/.test(r.confirmation!.capabilityNote));
  });

  it("past grabStartAt rejected on flight", () => {
    let r = processTurn(createEmptySession(), "机票 SZX到PVG 2026-12-01 不限 经济舱 1人", fixedNow);
    assert.equal(r.missing, "grabStartAt");
    r = processTurn(r.session, "今天8点", fixedNow);
    assert.equal(r.session.fields.grabStartAt, undefined);
    assert.equal(r.readyForConfirm, false);
    assert.equal(r.missing, "grabStartAt");
  });
});
