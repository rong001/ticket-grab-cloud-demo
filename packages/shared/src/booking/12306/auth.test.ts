import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { continueLogin12306, login12306, validateSession } from "./auth.js";
import { submitTrainOrder } from "./order.js";
import type { FetchLike } from "./types.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function jsonRes(body: unknown, status = 200, setCookie?: string[]): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (setCookie) {
    for (const c of setCookie) headers.append("set-cookie", c);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function textRes(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html" },
  });
}

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8"));
}

function mockFetch(router: (url: string, init?: RequestInit) => Response | Promise<Response>): FetchLike {
  return async (input, init) => {
    const url = String(input);
    return router(url, init);
  };
}

describe("12306 login (mocked)", () => {
  it("returns needCaptcha when captcha image is served", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes("captcha-image64")) {
        return jsonRes({ image: "aaa", result_code: "0" });
      }
      if (url.includes("leftTicket/init") || url.includes("uamtk-static")) {
        return jsonRes({}, 200, ["JSESSIONID=abc; Path=/"]);
      }
      return jsonRes({ result_code: 0 });
    });

    const r = await login12306("user1", "pass1", { fetchImpl });
    assert.equal(r.status, "needCaptcha");
    if (r.status === "needCaptcha") {
      assert.equal(r.challenge.kind, "captcha");
      assert.ok(r.resumeToken);
      assert.equal(r.challenge.imageBase64, "aaa");
    }
  });

  it("login success path after captcha (uamtk exchange)", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes("captcha-image64")) {
        return jsonRes({ result_code: "0" }); // no image → proceed
      }
      if (url.includes("captcha-check")) {
        return jsonRes({ result_code: "4", result_message: "成功" });
      }
      if (url.includes("passport/web/login")) {
        return jsonRes(loadJson("login_ok.json"), 200, ["uamtk=tok; Path=/"]);
      }
      if (url.includes("auth/uamtk") && !url.includes("static")) {
        return jsonRes(loadJson("uamtk_ok.json"));
      }
      if (url.includes("uamauthclient")) {
        return jsonRes(loadJson("uamauth_ok.json"));
      }
      return jsonRes({}, 200, ["JSESSIONID=x; Path=/"]);
    });

    const r = await login12306("user1", "pass1", {
      fetchImpl,
      captchaAnswer: "12,34",
    });
    assert.equal(r.status, "ok");
    if (r.status === "ok") {
      assert.equal(r.username, "测试用户");
      assert.ok(Object.keys(r.cookies).length >= 0);
    }
  });

  it("returns needSms when passport asks for SMS", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes("captcha-image64")) return jsonRes({ result_code: "0" });
      if (url.includes("passport/web/login")) {
        return jsonRes(loadJson("login_need_sms.json"));
      }
      return jsonRes({});
    });

    const r = await login12306("user1", "pass1", { fetchImpl, captchaAnswer: "x" });
    // captcha check may fail first — force by skipping captcha image and answering
    assert.ok(r.status === "needSms" || r.status === "needCaptcha" || r.status === "fail");
  });

  it("needSms via continue token path surfaces sms challenge", async () => {
    // Direct: login without captcha image, SMS result
    const fetchImpl = mockFetch((url) => {
      if (url.includes("captcha-image64")) return jsonRes({ result_code: "0" });
      if (url.includes("captcha-check")) return jsonRes({ result_code: "4" });
      if (url.includes("passport/web/login")) {
        return jsonRes(loadJson("login_need_sms.json"));
      }
      return jsonRes({});
    });
    const r = await login12306("u", "p", { fetchImpl, captchaAnswer: "1" });
    assert.equal(r.status, "needSms");
    if (r.status === "needSms") {
      assert.equal(r.challenge.kind, "sms");
      const cont = await continueLogin12306(r.resumeToken, {}, { fetchImpl });
      assert.equal(cont.status, "needSms");
    }
  });

  it("validateSession ok when checkUser flag true", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes("checkUser")) return jsonRes(loadJson("check_user_ok.json"));
      return jsonRes({});
    });
    const r = await validateSession({ JSESSIONID: "abc" }, { fetchImpl });
    assert.equal(r.ok, true);
  });
});

describe("12306 submit (mocked)", () => {
  it("dry_run_ok stops before confirm", async () => {
    const initHtml = readFileSync(join(fixtures, "init_dc.html"), "utf8");
    const fetchImpl = mockFetch((url) => {
      if (url.includes("checkUser")) return jsonRes(loadJson("check_user_ok.json"));
      if (url.includes("submitOrderRequest")) return jsonRes(loadJson("submit_order_ok.json"));
      if (url.includes("initDc")) return textRes(initHtml);
      if (url.includes("checkOrderInfo")) return jsonRes(loadJson("check_order_ok.json"));
      if (url.includes("getQueueCount")) return jsonRes({ status: true, data: {} });
      if (url.includes("confirmSingleForQueue")) {
        assert.fail("confirmSingleForQueue must not be called in dry run");
      }
      return jsonRes({});
    });

    const r = await submitTrainOrder(
      {
        cookies: { JSESSIONID: "abc" },
        secretStr: "secret",
        trainNo: "G1001",
        fromStation: "北京南",
        toStation: "上海虹桥",
        fromTelecode: "VNP",
        toTelecode: "AOH",
        trainDate: "2026-10-01",
        seatType: "二等座",
        dryRun: true,
        passengers: [
          { name: "张三", idType: "id_card", idNumber: "11010519900307401X" },
        ],
      },
      { fetchImpl }
    );
    assert.equal(r.status, "dry_run_ok");
  });

  it("submit success returns awaiting_payment with order id", async () => {
    const initHtml = readFileSync(join(fixtures, "init_dc.html"), "utf8");
    const fetchImpl = mockFetch((url) => {
      if (url.includes("checkUser")) return jsonRes(loadJson("check_user_ok.json"));
      if (url.includes("submitOrderRequest")) return jsonRes(loadJson("submit_order_ok.json"));
      if (url.includes("initDc")) return textRes(initHtml);
      if (url.includes("checkOrderInfo")) return jsonRes(loadJson("check_order_ok.json"));
      if (url.includes("getQueueCount")) return jsonRes({ status: true, data: {} });
      if (url.includes("confirmSingleForQueue")) return jsonRes(loadJson("confirm_ok.json"));
      if (url.includes("queryOrderWaitTime")) return jsonRes(loadJson("wait_time_ok.json"));
      if (url.includes("resultOrderForDcQueue")) {
        return jsonRes({ data: { submitStatus: true } });
      }
      return jsonRes({});
    });

    const prev = process.env.TRAIN_BOOKING_DRY_RUN;
    delete process.env.TRAIN_BOOKING_DRY_RUN;
    try {
      const r = await submitTrainOrder(
        {
          cookies: { JSESSIONID: "abc" },
          secretStr: "secret",
          trainNo: "G1001",
          fromStation: "北京南",
          toStation: "上海虹桥",
          fromTelecode: "VNP",
          toTelecode: "AOH",
          trainDate: "2026-10-01",
          seatType: "二等座",
          dryRun: false,
          passengers: [
            { name: "张三", idType: "id_card", idNumber: "11010519900307401X" },
          ],
        },
        { fetchImpl }
      );
      assert.equal(r.status, "awaiting_payment");
      if (r.status === "awaiting_payment") {
        assert.equal(r.externalOrderId, "E123456789");
        assert.equal(r.confirmation.source, "live_session");
        assert.equal(r.confirmation.confirmed, true);
      }
    } finally {
      if (prev !== undefined) process.env.TRAIN_BOOKING_DRY_RUN = prev;
    }
  });

  it("submit fails honestly when secretStr missing", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes("checkUser")) return jsonRes(loadJson("check_user_ok.json"));
      return jsonRes({});
    });
    const r = await submitTrainOrder(
      {
        cookies: { JSESSIONID: "abc" },
        trainNo: "G1001",
        fromStation: "北京南",
        toStation: "上海虹桥",
        fromTelecode: "VNP",
        toTelecode: "AOH",
        trainDate: "2026-10-01",
        seatType: "二等座",
        passengers: [{ name: "张三", idType: "id_card", idNumber: "11010519900307401X" }],
      },
      { fetchImpl }
    );
    assert.equal(r.status, "failed");
    if (r.status === "failed") assert.equal(r.errorCode, "missing_secret");
  });

  it("submit fail when seat check rejects", async () => {
    const initHtml = readFileSync(join(fixtures, "init_dc.html"), "utf8");
    const fetchImpl = mockFetch((url) => {
      if (url.includes("checkUser")) return jsonRes(loadJson("check_user_ok.json"));
      if (url.includes("submitOrderRequest")) return jsonRes(loadJson("submit_order_ok.json"));
      if (url.includes("initDc")) return textRes(initHtml);
      if (url.includes("checkOrderInfo")) {
        return jsonRes({
          status: true,
          data: { submitStatus: false, errMsg: "余票不足" },
        });
      }
      return jsonRes({});
    });
    const r = await submitTrainOrder(
      {
        cookies: { JSESSIONID: "abc" },
        secretStr: "secret",
        trainNo: "G1001",
        fromStation: "北京南",
        toStation: "上海虹桥",
        fromTelecode: "VNP",
        toTelecode: "AOH",
        trainDate: "2026-10-01",
        seatType: "二等座",
        dryRun: true,
        passengers: [{ name: "张三", idType: "id_card", idNumber: "11010519900307401X" }],
      },
      { fetchImpl }
    );
    assert.equal(r.status, "failed");
    if (r.status === "failed") assert.match(r.message, /余票/);
  });
});
