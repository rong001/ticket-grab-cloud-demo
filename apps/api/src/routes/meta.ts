import type { FastifyInstance } from "fastify";
import {
  createRequestSchema,
  describeDataSources,
  listStationsByCity,
  listTrainCities,
  loadStationIndex,
  loadStationRecords,
  searchTickets,
  searchVenuesByCity,
  stationLoadStatus,
  type Channel,
} from "@ticket-grab/shared";
import { env } from "../env.js";
import { authenticate } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

export async function metaRoutes(app: FastifyInstance) {
  app.get("/meta/data-sources", {
    schema: {
      tags: ["meta"],
      summary: "Which channels are live vs fixture right now (for UI 实时数据 badge)",
    },
  }, async () => {
    const sources = describeDataSources({
      providerMode: env.providerMode,
      bookingStub:
        process.env.BOOKING_STUB === "0"
          ? false
          : env.providerMode === "fixture" || process.env.BOOKING_STUB === "1",
    });
    const flight = sources.find((c) => c.channel === "flight");
    return {
      providerMode: env.providerMode,
      queriedAt: new Date().toISOString(),
      channels: sources,
      strictLive: process.env.STRICT_LIVE === "1" || process.env.STRICT_LIVE === "true",
      // Top-level honesty aliases for UI / ops (also on each channel row).
      flightInventoryLive: flight?.inventoryLive === true,
      flightFareMonitor: flight?.fareMonitor === true,
      flightLabelZh: flight?.labelZh ?? "实时可售票/票价监控不可用",
      flightNotes: flight?.notes ?? null,
    };
  });

  app.get("/meta/cities", {
    schema: {
      tags: ["meta"],
      summary: "Train cities derived from 12306 station_name.js index",
      querystring: {
        type: "object",
        properties: {
          q: { type: "string" },
          limit: { type: "integer" },
        },
      },
    },
  }, async (request) => {
    const { q = "", limit = 80 } = request.query as { q?: string; limit?: number };
    await loadStationRecords();
    const items = await listTrainCities(String(q), Number(limit) || 80);
    const status = stationLoadStatus();
    return {
      count: items.length,
      items: items.map((c) => ({
        value: c.cityName,
        label: `${c.cityName}（${c.stationCount}站）`,
        cityName: c.cityName,
        cityCode: c.cityCode,
        stationCount: c.stationCount,
        category: "城市",
      })),
      source: status.count > 50 ? "12306" : "builtin",
      indexSize: status.count,
      cache: {
        loadedAt: status.loadedAt,
        cacheMs: status.cacheMs,
        stale: status.stale,
        error: status.error,
      },
    };
  });

  app.get("/meta/stations", {
    schema: {
      tags: ["meta"],
      summary: "Search 12306 station index, or list ALL stations in a city (?city= / ?cityCode=)",
      querystring: {
        type: "object",
        properties: {
          q: { type: "string" },
          city: { type: "string" },
          cityCode: { type: "string" },
          limit: { type: "integer" },
        },
      },
    },
  }, async (request) => {
    const {
      q = "",
      city = "",
      cityCode = "",
      limit = 30,
    } = request.query as { q?: string; city?: string; cityCode?: string; limit?: number };

    const cityQ = String(city).trim();
    const codeQ = String(cityCode).trim();

    // City mode: return ALL stations in that city (complete list, not curated popular).
    if (cityQ || codeQ) {
      const rows = await listStationsByCity({ city: cityQ || undefined, cityCode: codeQ || undefined });
      const query = String(q).trim();
      const filtered = query
        ? rows.filter(
            (r) =>
              r.name.includes(query) ||
              r.telecode.toLowerCase().includes(query.toLowerCase()) ||
              r.pinyin.toLowerCase().includes(query.toLowerCase())
          )
        : rows;
      // Cap high for full city lists (深圳 has many stations); still guard DoS.
      const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
      const slice = filtered.slice(0, lim);
      const status = stationLoadStatus();
      return {
        count: slice.length,
        totalInCity: rows.length,
        city: cityQ || undefined,
        cityCode: codeQ || rows[0]?.cityCode || undefined,
        items: slice.map((r) => ({
          value: r.name,
          label: `${r.name} (${r.telecode})`,
          telecode: r.telecode,
          cityName: r.cityName,
          cityCode: r.cityCode,
          category: r.cityName || "12306",
        })),
        source: status.count > 50 ? "12306" : "builtin",
        indexSize: status.count,
        complete: slice.length === filtered.length,
        cache: {
          loadedAt: status.loadedAt,
          cacheMs: status.cacheMs,
          stale: status.stale,
          error: status.error,
        },
        error: status.error && status.count <= 50 ? status.error : undefined,
      };
    }

    const query = String(q).trim();
    const lim = Math.min(Math.max(Number(limit) || 30, 1), 80);
    const index = await loadStationIndex();
    const items: { value: string; label: string; telecode: string; category: string }[] = [];
    const ql = query.toLowerCase();
    const qu = query.toUpperCase();
    for (const [name, code] of index) {
      if (
        !query ||
        name.includes(query) ||
        name.toLowerCase().includes(ql) ||
        code === qu ||
        code.toLowerCase().startsWith(ql)
      ) {
        items.push({
          value: name,
          label: `${name} (${code})`,
          telecode: code,
          category: "12306",
        });
        if (items.length >= lim) break;
      }
    }
    const status = stationLoadStatus();
    return {
      count: items.length,
      items,
      source: status.count > 50 ? "12306" : "builtin",
      indexSize: status.count,
    };
  });

  app.get("/meta/venues", {
    schema: {
      tags: ["meta"],
      summary: "Venues for a city derived from live Dianping/Gewara public search",
      querystring: {
        type: "object",
        properties: {
          city: { type: "string" },
          q: { type: "string" },
          limit: { type: "integer" },
        },
        required: ["city"],
      },
    },
  }, async (request, reply) => {
    const { city = "", q = "", limit = 40 } = request.query as {
      city?: string;
      q?: string;
      limit?: number;
    };
    const cityName = String(city).trim();
    if (!cityName) {
      return reply.code(400).send({ error: "city query required" });
    }
    const result = await searchVenuesByCity(cityName, {
      keyword: String(q).trim() || undefined,
      limit: Number(limit) || 40,
    });
    return {
      count: result.items.length,
      venueCount: result.items.length,
      liveCount: result.liveCount,
      curatedCount: result.curatedCount,
      sparse: result.sparse,
      city: cityName,
      items: result.items.map((v) => ({
        value: v.value,
        label: v.label,
        city: v.city,
        category: v.category,
        performanceCount: v.performanceCount,
        source: v.source,
      })),
      source: result.source,
      liveOk: result.ok,
      error: result.error,
      queriedAt: new Date().toISOString(),
    };
  });

  app.get("/meta/notifications/summary", {
    schema: {
      tags: ["meta"],
      summary: "Recent alert count for header badge",
      security: [{ bearerAuth: [] }],
    },
  }, async (request) => {
    const user = await authenticate(request);
    const since = new Date(Date.now() - 48 * 3600_000);
    const requestIds = (
      await prisma.ticketRequest.findMany({
        where: { userId: user.sub },
        select: { id: true },
      })
    ).map((r) => r.id);
    if (!requestIds.length) return { unread: 0, since: since.toISOString() };
    const unread = await prisma.notificationEvent.count({
      where: {
        requestId: { in: requestIds },
        createdAt: { gte: since },
        type: { in: ["watch_alert", "watch_auto_order", "tickets_found", "watch_started", "watch_check"] },
      },
    });
    return { unread, since: since.toISOString() };
  });

  /** Guest / public ticket search — no auth, no request row created. Tightly rate-limited. */
  app.post("/public/search", {
    schema: {
      tags: ["meta", "public"],
      summary: "Public search (no login). Returns shortlist + liveOk + notes + queriedAt. Not a sales license.",
      body: {
        type: "object",
        required: ["channel", "fields"],
        properties: {
          channel: { type: "string", enum: ["train", "show", "flight"] },
          fields: { type: "object" },
        },
      },
    },
  }, async (request, reply) => {
    const body = createRequestSchema.parse(request.body);
    const result = await searchTickets(
      body.channel as Channel,
      body.fields as Record<string, unknown>,
      env.providerMode
    );
    return {
      channel: result.channel,
      provider: result.provider,
      mode: result.mode,
      items: result.items,
      liveOk: result.liveOk === true,
      notes: result.notes ?? null,
      queriedAt: result.queriedAt,
      disclaimer:
        "Public left-ticket / catalog query only. providerMode=live is not an authorized auto-buy or third-party sales license. Pay on official sites.",
    };
  });


}
