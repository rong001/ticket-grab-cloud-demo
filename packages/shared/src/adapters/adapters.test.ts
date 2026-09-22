import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { searchTickets } from "./index.js";
import { parse12306LeftTicket, parseStationRecords, listStationsByCity, loadStationRecords, stationLoadStatus } from "./train12306.js";
import { CURATED_SHOW_VENUES } from "./show.js";
import {
  performanceToItems,
  extractPerformanceId,
  mapShowAvailability,
  sessionsToItems,
  saleStatusLabel,
  resolveCityId,
  uniqueTicketTiers,
  suggestShowWatch,
} from "./show.js";
import { LiveProviderError } from "./liveMode.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");

describe("fixture search smoke", () => {
  it("train12306 returns shortlist", async () => {
    const result = await searchTickets(
      "train",
      { from: "深圳北", to: "汕尾", date: "2026-09-24" },
      "fixture"
    );
    assert.equal(result.channel, "train");
    assert.equal(result.provider, "train12306");
    assert.equal(result.mode, "fixture");
    assert.equal(result.liveOk, false);
    assert.ok(result.items.length >= 1);
    assert.ok(result.items[0].title.includes("深圳北"));
  });

  it("show returns shortlist", async () => {
    const result = await searchTickets(
      "show",
      { eventName: "测试演唱会", city: "北京" },
      "fixture"
    );
    assert.equal(result.channel, "show");
    assert.equal(result.liveOk, false);
    assert.ok(result.items.some((i) => i.availability === "available"));
  });

  it("flight returns shortlist", async () => {
    const result = await searchTickets(
      "flight",
      { from: "SZX", to: "PVG", date: "2026-09-24" },
      "fixture"
    );
    assert.equal(result.channel, "flight");
    assert.equal(result.liveOk, false);
    assert.ok(result.items.every((i) => typeof i.price === "number"));
  });
});

describe("recorded live payload parsing", () => {
  it("parses 12306 left-ticket sample into trains", () => {
    const raw = JSON.parse(readFileSync(join(fixtures, "12306_left_ticket_sample.json"), "utf8"));
    const items = parse12306LeftTicket(raw, {
      from: "深圳北",
      to: "广州南",
      date: "2026-09-27",
    });
    assert.ok(items.length >= 1);
    assert.match(items[0].title, /[GCD]\d+/);
    assert.equal(items[0].channel, "train");
    assert.ok(
      items[0].meta?.source === "kyfw.12306.cn" ||
        items[0].meta?.source === "12306" ||
        typeof items[0].meta?.trainNo === "string"
    );
  });

  it("parses gewara/dianping performance detail", () => {
    const raw = JSON.parse(readFileSync(join(fixtures, "gewara_performance_498506.json"), "utf8"));
    const items = performanceToItems(raw.data, {
      eventName: "安溥",
      performanceId: 498506,
      city: "上海",
    });
    assert.equal(items.length, 1);
    assert.match(items[0].title, /安溥/);
    assert.ok(items[0].subtitle && items[0].subtitle.length > 0);
    assert.equal(Number(items[0].meta?.performanceId), 498506);
  });

  it("extractPerformanceId reads detailUrl and #id", () => {
    assert.equal(
      extractPerformanceId({ eventName: "x", detailUrl: "https://www.gewara.com/detail/498506" }),
      "498506"
    );
    assert.equal(extractPerformanceId({ eventName: "安溥 #498506" }), "498506");
    assert.equal(extractPerformanceId({ eventName: "安溥", performanceId: 42 }), "42");
  });

  it("mapShowAvailability covers known statuses", () => {
    assert.equal(mapShowAvailability(1), "available");
    assert.ok(["limited", "available", "sold_out", "unknown", "waitlist"].includes(mapShowAvailability(3, 3)));
    assert.ok(["sold_out", "unknown", "limited"].includes(mapShowAvailability(0)));
    assert.equal(mapShowAvailability(1, 1, true), "available");
    assert.equal(mapShowAvailability(1, 1, false), "waitlist");
  });

  it("parses gewara/dianping shows into multiple sessions", () => {
    const detail = JSON.parse(readFileSync(join(fixtures, "gewara_performance_498506.json"), "utf8"));
    const shows = JSON.parse(readFileSync(join(fixtures, "gewara_shows_498506.json"), "utf8"));
    const tickets = JSON.parse(readFileSync(join(fixtures, "gewara_tickets_498506.json"), "utf8"));
    const items = sessionsToItems(detail.data, shows.data, {
      eventName: "安溥",
      performanceId: 498506,
      city: "上海",
    }, tickets.data);
    assert.ok(items.length >= 2, `expected >=2 sessions, got ${items.length}`);
    assert.ok(items.every((i) => i.channel === "show"));
    assert.ok(items.every((i) => i.meta?.showId != null));
    assert.match(String(items[0].meta?.sessionName ?? ""), /2026-11-1[45]/);
    assert.equal(items[0].meta?.sourceLabel, "实时(猫眼/格瓦拉/点评场次)");
    assert.ok(Array.isArray(items[0].meta?.ticketPrices));
    assert.ok((items[0].meta?.ticketPrices as number[]).includes(480));
  });

  it("saleStatusLabel and resolveCityId helpers", () => {
    assert.equal(saleStatusLabel({ hasInventory: true }), "在售");
    assert.equal(saleStatusLabel({ stockOut: true, stockOutRegister: 1 }), "缺货登记");
    assert.equal(saleStatusLabel({ ticketStatus: 3, saleLabel: 3 }), "即将开售");
    assert.equal(resolveCityId("上海"), "1");
    assert.equal(resolveCityId("北京"), "2");
  });

  it("fixture show returns multiple sessions", async () => {
    const result = await searchTickets(
      "show",
      { eventName: "测试演唱会", city: "北京", date: "2026-10-18" },
      "fixture"
    );
    assert.ok(result.items.length >= 2);
    const showIds = new Set(result.items.map((i) => i.meta?.showId));
    assert.ok(showIds.size >= 2, "fixture should expose multiple 场次");
  });
});


  it("expands ticket tiers per session when API returns classes", () => {
    const detail = JSON.parse(readFileSync(join(fixtures, "gewara_performance_498506.json"), "utf8"));
    const shows = JSON.parse(readFileSync(join(fixtures, "gewara_shows_498506.json"), "utf8"));
    const tickets = JSON.parse(readFileSync(join(fixtures, "gewara_tickets_498506.json"), "utf8"));
    const items = sessionsToItems(detail.data, shows.data, {
      eventName: "安溥",
      performanceId: 498506,
      city: "上海",
    }, tickets.data);
    assert.ok(items.length > shows.data.length, "tiers should multiply sessions");
    assert.ok(items.some((i) => i.meta?.tier != null || i.meta?.ticketClassId != null));
    const tiers = uniqueTicketTiers(tickets.data);
    assert.ok(tiers.length >= 4);
    assert.equal(tiers[0]!.ticketPrice, 480);
  });

  it("suggestShowWatch aligns to onSaleTime and uses aggressive interval", () => {
    const soon = Date.now() + 30 * 60_000;
    const sug = suggestShowWatch([
      { availability: "limited", meta: { onSaleTime: soon } },
    ]);
    assert.equal(sug.intervalMinutes, 1);
    assert.ok(sug.startsAt instanceof Date);
    assert.ok(sug.reason.includes("开售"));
    const idle = suggestShowWatch([{ availability: "sold_out", meta: {} }]);
    assert.equal(idle.intervalMinutes, 5);
  });

describe("STRICT_LIVE", () => {
  it("throws when live fails under STRICT_LIVE=1", async () => {
    const prev = process.env.STRICT_LIVE;
    const prevUrl = process.env.FLIGHT_PUBLIC_API_URL;
    const prevKey = process.env.FLIGHT_API_KEY;
    const prevAid = process.env.AMADEUS_CLIENT_ID;
    const prevAsec = process.env.AMADEUS_CLIENT_SECRET;
    const prevOsky = process.env.FLIGHT_OPENSKY;
    process.env.STRICT_LIVE = "1";
    delete process.env.FLIGHT_PUBLIC_API_URL;
    delete process.env.FLIGHT_API_KEY;
    delete process.env.AMADEUS_CLIENT_ID;
    delete process.env.AMADEUS_CLIENT_SECRET;
    process.env.FLIGHT_OPENSKY = "0"; // disable keyless fallback for this unit test
    try {
      await assert.rejects(
        () => searchTickets("flight", { from: "SZX", to: "PVG", date: "2026-09-24" }, "live"),
        (err: unknown) => err instanceof LiveProviderError
      );
    } finally {
      if (prev === undefined) delete process.env.STRICT_LIVE;
      else process.env.STRICT_LIVE = prev;
      if (prevUrl === undefined) delete process.env.FLIGHT_PUBLIC_API_URL;
      else process.env.FLIGHT_PUBLIC_API_URL = prevUrl;
      if (prevKey === undefined) delete process.env.FLIGHT_API_KEY;
      else process.env.FLIGHT_API_KEY = prevKey;
      if (prevAid === undefined) delete process.env.AMADEUS_CLIENT_ID;
      else process.env.AMADEUS_CLIENT_ID = prevAid;
      if (prevAsec === undefined) delete process.env.AMADEUS_CLIENT_SECRET;
      else process.env.AMADEUS_CLIENT_SECRET = prevAsec;
      if (prevOsky === undefined) delete process.env.FLIGHT_OPENSKY;
      else process.env.FLIGHT_OPENSKY = prevOsky;
    }
  });
});

describe("12306 station index city → all stations", () => {
  it("parses station_name snippet with city fields", () => {
    const raw = readFileSync(join(fixtures, "station_name_snippet.js"), "utf8");
    const rows = parseStationRecords(raw);
    assert.ok(rows.length >= 5);
    const sz = rows.filter((r) => r.cityName === "深圳");
    const names = sz.map((r) => r.name);
    assert.ok(names.includes("深圳北"));
    assert.ok(names.includes("福田"));
    assert.equal(sz.find((r) => r.name === "深圳北")?.telecode, "IOQ");
  });

  it("listStationsByCity returns complete city set from loaded index", async () => {
    const prev = process.env.TRAIN_STATION_JS_PATH;
    process.env.TRAIN_STATION_JS_PATH = join(fixtures, "station_name_snippet.js");
    try {
      const records = await loadStationRecords(true);
      assert.ok(records.length >= 5);
      const sz = await listStationsByCity({ city: "深圳" });
      const names = sz.map((r) => r.name);
      assert.ok(names.includes("深圳北"));
      assert.ok(names.includes("福田"));
      assert.ok(names.length >= 2, `expected multiple Shenzhen stations, got ${names.join(",")}`);
    } finally {
      if (prev === undefined) delete process.env.TRAIN_STATION_JS_PATH;
      else process.env.TRAIN_STATION_JS_PATH = prev;
    }
  });
});


describe("venue curated fallback + station cache status", () => {
  it("CURATED_SHOW_VENUES has major cities", () => {
    assert.ok((CURATED_SHOW_VENUES["深圳"] ?? []).length >= 3);
    assert.ok((CURATED_SHOW_VENUES["上海"] ?? []).length >= 3);
  });

  it("stationLoadStatus exposes cache fields after load", async () => {
    const prev = process.env.TRAIN_STATION_JS_PATH;
    process.env.TRAIN_STATION_JS_PATH = join(fixtures, "station_name_snippet.js");
    try {
      await loadStationRecords(true);
      const st = stationLoadStatus();
      assert.ok(st.count >= 5);
      assert.ok(st.loadedAt);
      assert.ok(st.cacheMs >= 60_000);
      assert.equal(st.stale, false);
    } finally {
      if (prev === undefined) delete process.env.TRAIN_STATION_JS_PATH;
      else process.env.TRAIN_STATION_JS_PATH = prev;
    }
  });
});

describe("flight honesty flags (schedule vs inventory)", () => {
  const keys = [
    "AMADEUS_CLIENT_ID",
    "AMADEUS_CLIENT_SECRET",
    "FLIGHT_API_KEY",
    "FLIGHT_PUBLIC_API_URL",
    "FLIGHT_OPENSKY",
    "PROVIDER_MODE",
  ] as const;

  function snapshotEnv() {
    const prev: Record<string, string | undefined> = {};
    for (const k of keys) prev[k] = process.env[k];
    return prev;
  }
  function restoreEnv(prev: Record<string, string | undefined>) {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k]!;
    }
  }

  it("OpenSky 404 / ADS-B fail → inventoryLive=false, no tickets_found semantics", async () => {
    const prev = snapshotEnv();
    process.env.PROVIDER_MODE = "live";
    delete process.env.AMADEUS_CLIENT_ID;
    delete process.env.AMADEUS_CLIENT_SECRET;
    delete process.env.FLIGHT_API_KEY;
    delete process.env.FLIGHT_PUBLIC_API_URL;
    process.env.FLIGHT_OPENSKY = "1";
    try {
      const { describeFlightHonesty, describeDataSources } = await import("./dataSources.js");
      const honesty = describeFlightHonesty({ providerMode: "live" });
      assert.equal(honesty.flightInventoryLive, false);
      assert.equal(honesty.flightFareMonitor, false);
      assert.equal(honesty.flightScheduleLive, true); // ADS-B configured
      assert.match(honesty.flightLabelZh, /不可用/);
      const flight = describeDataSources({ providerMode: "live" }).find((c) => c.channel === "flight")!;
      assert.equal(flight.badge, "unavailable");
      assert.equal(flight.inventoryLive, false);

      // Force OpenSky fail via absurd airport / disabled path in search
      process.env.FLIGHT_OPENSKY = "0"; // force fail path for search
      const result = await searchTickets(
        "flight",
        { from: "SZX", to: "PVG", date: "2026-09-25" },
        "live"
      );
      assert.equal(result.liveOk, false);
      assert.equal(result.items.length, 0);
      assert.ok(!result.items.some((i) => i.availability === "available"));
    } finally {
      restoreEnv(prev);
    }
  });

  it("schedule-only Aviationstack mock → scheduleLive may be true, inventoryLive=false", async () => {
    const prev = snapshotEnv();
    process.env.PROVIDER_MODE = "live";
    delete process.env.AMADEUS_CLIENT_ID;
    delete process.env.AMADEUS_CLIENT_SECRET;
    delete process.env.FLIGHT_PUBLIC_API_URL;
    process.env.FLIGHT_API_KEY = "test-schedule-only-key";
    process.env.FLIGHT_OPENSKY = "0";
    try {
      const { describeFlightHonesty, isFlightInventoryProvider } = await import("./dataSources.js");
      const honesty = describeFlightHonesty({ providerMode: "live" });
      assert.equal(honesty.flightInventoryLive, false);
      assert.equal(honesty.flightScheduleLive, true);
      assert.equal(honesty.flightFareMonitor, false);
      assert.equal(honesty.flightProvider, "aviationstack");
      assert.match(honesty.flightLabelZh, /不可用/);
      assert.equal(isFlightInventoryProvider("aviationstack"), false);
      assert.equal(isFlightInventoryProvider("opensky"), false);
      assert.equal(isFlightInventoryProvider("amadeus"), true);

      // Mock Aviationstack HTTP with undici-style global fetch override
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("aviationstack.com")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  flight: { iata: "CA1801", number: "1801" },
                  departure: { scheduled: "2026-09-25T08:00:00+08:00" },
                  arrival: { scheduled: "2026-09-25T10:30:00+08:00" },
                  airline: { name: "Air China", iata: "CA" },
                  flight_status: "scheduled",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("not found", { status: 404 });
      }) as typeof fetch;
      try {
        const result = await searchTickets(
          "flight",
          { from: "SZX", to: "PVG", date: "2026-09-25" },
          "live"
        );
        assert.equal(result.provider, "aviationstack");
        assert.equal(result.liveOk, true);
        assert.ok(result.items.length >= 1);
        assert.ok(
          result.items.every(
            (i) =>
              i.availability !== "available" &&
              i.availability !== "limited" &&
              i.meta?.scheduleOnly === true
          ),
          "schedule-only must not emit available/limited (tickets_found / 可抢)"
        );
        assert.ok(result.notes && /时刻|Aviationstack|无可靠票价|schedule/i.test(result.notes));
      } finally {
        globalThis.fetch = originalFetch;
      }
    } finally {
      restoreEnv(prev);
    }
  });

  it("formal inventory source missing → inventoryLive=false, clear unavailable label", async () => {
    const prev = snapshotEnv();
    process.env.PROVIDER_MODE = "live";
    delete process.env.AMADEUS_CLIENT_ID;
    delete process.env.AMADEUS_CLIENT_SECRET;
    delete process.env.FLIGHT_API_KEY;
    delete process.env.FLIGHT_PUBLIC_API_URL;
    process.env.FLIGHT_OPENSKY = "0";
    try {
      const { describeFlightHonesty } = await import("./dataSources.js");
      const honesty = describeFlightHonesty({ providerMode: "live" });
      assert.equal(honesty.flightInventoryLive, false);
      assert.equal(honesty.flightScheduleLive, false);
      assert.equal(honesty.flightFareMonitor, false);
      assert.match(honesty.flightLabelZh, /不可用/);
      const flight = (await import("./dataSources.js")).describeDataSources({
        providerMode: "live",
      }).find((c) => c.channel === "flight")!;
      assert.ok(flight.badge === "needs_keys" || flight.badge === "unavailable");
    } finally {
      restoreEnv(prev);
    }
  });
});
