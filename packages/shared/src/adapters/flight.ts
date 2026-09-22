import type { FlightFields, ShortlistItem, ShortlistResult } from "../types.js";
import type { AdapterSearchInput, TicketAdapter } from "./types.js";
import {
  fetchJson,
  finalizeSearchResult,
  resolveProviderMode,
  type LiveAttempt,
} from "./liveMode.js";
import { recordFlightScheduleFetch } from "./dataSources.js";

function fixtureItems(fields: FlightFields): ShortlistItem[] {
  const date = fields.date;
  return [
    {
      id: `CA1801-${date}`,
      channel: "flight",
      title: `CA1801 ${fields.from} → ${fields.to}`,
      subtitle: `${date} 07:40–10:05 · 经济舱`,
      datetime: `${date}T07:40:00+08:00`,
      price: 860,
      currency: "CNY",
      availability: "available",
      meta: { flightNo: "CA1801", cabin: fields.cabin ?? "economy", stops: 0 },
    },
    {
      id: `MU5102-${date}`,
      channel: "flight",
      title: `MU5102 ${fields.from} → ${fields.to}`,
      subtitle: `${date} 12:15–14:40 · 经济舱`,
      datetime: `${date}T12:15:00+08:00`,
      price: 920,
      currency: "CNY",
      availability: "limited",
      meta: { flightNo: "MU5102", cabin: "economy", remaining: 4 },
    },
    {
      id: `CZ3531-${date}`,
      channel: "flight",
      title: `CZ3531 ${fields.from} → ${fields.to}`,
      subtitle: `${date} 18:55–21:20 · 公务舱`,
      datetime: `${date}T18:55:00+08:00`,
      price: 2850,
      currency: "CNY",
      availability: "available",
      meta: { flightNo: "CZ3531", cabin: "business" },
    },
  ];
}

/** Common IATA → ICAO for OpenSky (which uses ICAO airport idents). */
const IATA_TO_ICAO: Record<string, string> = {
  PEK: "ZBAA",
  PKX: "ZBAD",
  PVG: "ZSPD",
  SHA: "ZSSS",
  SZX: "ZGSZ",
  CAN: "ZGGG",
  CTU: "ZUUU",
  TFU: "ZUTF",
  HGH: "ZSHC",
  XIY: "ZLXY",
  CKG: "ZUCK",
  KMG: "ZPPP",
  WUH: "ZHHH",
  CSX: "ZGHA",
  NKG: "ZSNJ",
  XMN: "ZSAM",
  TAO: "ZSQD",
  DLC: "ZYTL",
  SYX: "ZJSY",
  HAK: "ZJHK",
  TSN: "ZBTJ",
  SHE: "ZYTX",
  URC: "ZWWW",
  LHW: "ZLLL",
  NGB: "ZSNB",
  FOC: "ZSFZ",
  SIA: "ZLXY",
  BJS: "ZBAA",
  CGO: "ZHCC",
  HFE: "ZSOF",
  NNG: "ZGNN",
  KWE: "ZUGY",
  JHG: "ZPJH",
  LAX: "KLAX",
  SFO: "KSFO",
  JFK: "KJFK",
  NRT: "RJAA",
  HND: "RJTT",
  ICN: "RKSI",
  SIN: "WSSS",
  BKK: "VTBS",
  HKG: "VHHH",
  TPE: "RCTP",
  FRA: "EDDF",
  LHR: "EGLL",
  CDG: "LFPG",
};

function toIata(code: string): string {
  const c = code.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(c)) return c;
  // If user typed a Chinese city, leave as-is (Amadeus needs IATA)
  return c;
}

function toIcao(code: string): string | null {
  const c = code.trim().toUpperCase();
  if (/^[A-Z]{4}$/.test(c)) return c;
  if (/^[A-Z]{3}$/.test(c)) return IATA_TO_ICAO[c] ?? null;
  return null;
}

function hhmm(isoOrTs: string | number | undefined): string {
  if (isoOrTs == null) return "--:--";
  if (typeof isoOrTs === "number") {
    const d = new Date(isoOrTs * 1000);
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  }
  const m = String(isoOrTs).match(/T(\d{2}:\d{2})/);
  return m ? m[1]! : String(isoOrTs).slice(0, 16);
}

async function liveAmadeus(fields: FlightFields): Promise<LiveAttempt<ShortlistItem[]>> {
  const clientId = process.env.AMADEUS_CLIENT_ID;
  const clientSecret = process.env.AMADEUS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { ok: false, error: "AMADEUS_CLIENT_ID/SECRET not set" };
  }
  const host =
    process.env.AMADEUS_HOSTNAME ??
    (process.env.AMADEUS_ENV === "production" ? "api.amadeus.com" : "test.api.amadeus.com");

  try {
    const tokenRes = await fetch(`https://${host}/v1/security/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string; error_description?: string };
    if (!tokenRes.ok || !tokenJson.access_token) {
      return {
        ok: false,
        error: `Amadeus token failed: ${tokenJson.error_description ?? tokenJson.error ?? tokenRes.status}`,
      };
    }

    const origin = toIata(fields.from);
    const dest = toIata(fields.to);
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(dest)) {
      return {
        ok: false,
        error: `Amadeus needs IATA airport codes (e.g. SZX, PVG). Got from=${fields.from} to=${fields.to}`,
      };
    }

    const url = new URL(`https://${host}/v2/shopping/flight-offers`);
    url.searchParams.set("originLocationCode", origin);
    url.searchParams.set("destinationLocationCode", dest);
    url.searchParams.set("departureDate", fields.date);
    url.searchParams.set("adults", String(fields.passengers ?? 1));
    url.searchParams.set("max", "15");
    url.searchParams.set("currencyCode", "CNY");
    if (fields.cabin) {
      const map: Record<string, string> = {
        economy: "ECONOMY",
        business: "BUSINESS",
        first: "FIRST",
        premium_economy: "PREMIUM_ECONOMY",
      };
      url.searchParams.set("travelClass", map[fields.cabin] ?? fields.cabin.toUpperCase());
    }

    const offerRes = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      signal: AbortSignal.timeout(12_000),
    });
    const offerJson = (await offerRes.json()) as {
      data?: Array<{
        id: string;
        price?: { total?: string; currency?: string };
        itineraries?: Array<{
          duration?: string;
          segments?: Array<{
            carrierCode?: string;
            number?: string;
            departure?: { iataCode?: string; at?: string };
            arrival?: { iataCode?: string; at?: string };
            numberOfStops?: number;
          }>;
        }>;
        travelerPricings?: Array<{ fareDetailsBySegment?: Array<{ cabin?: string }> }>;
      }>;
      errors?: Array<{ detail?: string; title?: string }>;
    };

    if (!offerRes.ok) {
      const err = offerJson.errors?.[0];
      return { ok: false, error: `Amadeus offers HTTP ${offerRes.status}: ${err?.detail ?? err?.title ?? ""}` };
    }
    const data = offerJson.data ?? [];
    if (!data.length) return { ok: false, error: "Amadeus returned 0 offers" };

    const items: ShortlistItem[] = data.map((offer) => {
      const seg = offer.itineraries?.[0]?.segments?.[0];
      const lastSeg = offer.itineraries?.[0]?.segments?.slice(-1)[0];
      const flightNo = `${seg?.carrierCode ?? ""}${seg?.number ?? ""}`;
      const cabin =
        offer.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.cabin?.toLowerCase() ??
        fields.cabin ??
        "economy";
      const dep = seg?.departure?.at;
      const arr = lastSeg?.arrival?.at;
      const price = offer.price?.total ? Number(offer.price.total) : undefined;
      return {
        id: `amadeus-${offer.id}`,
        channel: "flight",
        title: `${flightNo || offer.id} ${origin} → ${dest}`,
        subtitle: `${fields.date} ${hhmm(dep)}–${hhmm(arr)} · ${cabin}`,
        datetime: dep,
        price: Number.isFinite(price) ? price : undefined,
        currency: offer.price?.currency ?? "CNY",
        availability: "available",
        meta: {
          source: "amadeus",
          flightNo,
          cabin,
          stops: seg?.numberOfStops ?? (offer.itineraries?.[0]?.segments?.length ?? 1) - 1,
          offerId: offer.id,
        },
      };
    });
    return { ok: true, data: items };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function liveAviationstack(fields: FlightFields): Promise<LiveAttempt<ShortlistItem[]>> {
  const key = process.env.FLIGHT_API_KEY;
  if (!key) return { ok: false, error: "FLIGHT_API_KEY not set" };

  const origin = toIata(fields.from);
  const dest = toIata(fields.to);
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(dest)) {
    return {
      ok: false,
      error: `Aviationstack needs IATA codes. Got from=${fields.from} to=${fields.to}`,
    };
  }

  try {
    const url = new URL("http://api.aviationstack.com/v1/flights");
    url.searchParams.set("access_key", key);
    url.searchParams.set("dep_iata", origin);
    url.searchParams.set("arr_iata", dest);
    url.searchParams.set("flight_date", fields.date);
    url.searchParams.set("limit", "20");

    const res = await fetchJson<{
      data?: Array<{
        flight?: { iata?: string; number?: string };
        departure?: { scheduled?: string; airport?: string };
        arrival?: { scheduled?: string; airport?: string };
        airline?: { name?: string; iata?: string };
        flight_status?: string;
      }>;
      error?: { message?: string; code?: string };
    }>(url.toString(), { timeoutMs: 10_000 });

    if (!res.ok) {
      return { ok: false, error: res.error ?? `Aviationstack HTTP ${res.status}` };
    }
    if (res.data?.error?.message) {
      return { ok: false, error: `Aviationstack: ${res.data.error.message}` };
    }
    const rows = res.data?.data ?? [];
    if (!rows.length) return { ok: false, error: "Aviationstack returned 0 flights" };

    // Schedule/status only — never mark available/limited (no fares / sellable seats).
    const items: ShortlistItem[] = rows.map((row, idx) => {
      const flightNo = row.flight?.iata ?? `${row.airline?.iata ?? ""}${row.flight?.number ?? idx}`;
      const dep = row.departure?.scheduled;
      const arr = row.arrival?.scheduled;
      const status = (row.flight_status ?? "").toLowerCase();
      const availability =
        status === "cancelled" ? "sold_out" : "unknown";
      return {
        id: `avs-${flightNo}-${fields.date}-${idx}`,
        channel: "flight",
        title: `${flightNo} ${origin} → ${dest}`,
        subtitle: `${fields.date} ${hhmm(dep)}–${hhmm(arr)} · ${row.airline?.name ?? "Airline"} · 时刻表(无票价)`,
        datetime: dep,
        availability,
        meta: {
          source: "aviationstack",
          flightNo,
          status: row.flight_status,
          cabin: fields.cabin ?? "economy",
          scheduleOnly: true,
          noPrice: true,
          inventoryHonest: false,
        },
      };
    });
    return { ok: true, data: items };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function livePublicUrl(fields: FlightFields): Promise<LiveAttempt<ShortlistItem[]>> {
  const base = process.env.FLIGHT_PUBLIC_API_URL;
  if (!base) return { ok: false, error: "FLIGHT_PUBLIC_API_URL not set" };
  try {
    const url = new URL("/flights/search", base);
    url.searchParams.set("from", fields.from);
    url.searchParams.set("to", fields.to);
    url.searchParams.set("date", fields.date);
    const res = await fetchJson<{ items?: ShortlistItem[] }>(url.toString(), { timeoutMs: 8000 });
    if (!res.ok || !res.data?.items?.length) {
      return { ok: false, error: res.error ?? `FLIGHT_PUBLIC_API_URL empty/HTTP ${res.status}` };
    }
    return { ok: true, data: res.data.items };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Keyless ADS-B departure list — honest: no fares, best-effort matching. */
async function liveOpenSky(fields: FlightFields): Promise<LiveAttempt<ShortlistItem[]>> {
  if (process.env.FLIGHT_OPENSKY === "0") {
    return { ok: false, error: "OpenSky disabled (FLIGHT_OPENSKY=0)" };
  }
  const depIcao = toIcao(fields.from);
  const arrIcao = toIcao(fields.to);
  if (!depIcao) {
    return {
      ok: false,
      error: `OpenSky needs IATA/ICAO for origin (got ${fields.from}). Map missing — use Amadeus/Aviationstack or extend IATA_TO_ICAO.`,
    };
  }

  try {
    // OpenSky wants unix seconds; clamp window to ≤2h for anonymous access friendliness
    const day = new Date(`${fields.date}T00:00:00Z`);
    if (Number.isNaN(day.getTime())) {
      return { ok: false, error: `Invalid date ${fields.date}` };
    }
    // Use a midday 2h window on that UTC day to stay within anonymous rate limits
    const begin = Math.floor(day.getTime() / 1000) + 4 * 3600;
    const end = begin + 2 * 3600;
    const url = `https://opensky-network.org/api/flights/departure?airport=${encodeURIComponent(depIcao)}&begin=${begin}&end=${end}`;
    const res = await fetchJson<
      Array<{
        callsign?: string | null;
        estDepartureAirport?: string | null;
        estArrivalAirport?: string | null;
        firstSeen?: number;
        lastSeen?: number;
      }>
    >(url, { timeoutMs: 10_000 });

    if (!res.ok) {
      return { ok: false, error: res.error ?? `OpenSky HTTP ${res.status}` };
    }
    let rows = Array.isArray(res.data) ? res.data : [];
    if (arrIcao) {
      const filtered = rows.filter(
        (r) => (r.estArrivalAirport ?? "").toUpperCase() === arrIcao
      );
      if (filtered.length) rows = filtered;
    }
    if (!rows.length) {
      return {
        ok: false,
        error: `OpenSky: no departures from ${depIcao} in sample window (anonymous API is sparse; prefer Amadeus).`,
      };
    }

    const destLabel = toIata(fields.to);
    const originLabel = toIata(fields.from);
    const items: ShortlistItem[] = rows.slice(0, 15).map((r, idx) => {
      const callsign = (r.callsign ?? "").trim() || `OSKY${idx}`;
      return {
        id: `opensky-${callsign}-${r.firstSeen ?? idx}`,
        channel: "flight",
        title: `${callsign} ${originLabel} → ${destLabel}`,
        subtitle: `${fields.date} ${hhmm(r.firstSeen)} · OpenSky（无票价·演示级）`,
        datetime: r.firstSeen ? new Date(r.firstSeen * 1000).toISOString() : undefined,
        availability: "unknown",
        meta: {
          source: "opensky",
          flightNo: callsign,
          estArrivalAirport: r.estArrivalAirport,
          cabin: fields.cabin ?? "economy",
          noPrice: true,
        },
      };
    });
    return { ok: true, data: items };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function liveSearch(fields: FlightFields): Promise<LiveAttempt<ShortlistItem[]>> {
  const errors: string[] = [];

  // Prefer keyed providers for booking-quality data
  if (process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET) {
    const r = await liveAmadeus(fields);
    if (r.ok) return r;
    errors.push(`amadeus: ${r.error}`);
  }
  if (process.env.FLIGHT_API_KEY) {
    const r = await liveAviationstack(fields);
    if (r.ok) return r;
    errors.push(`aviationstack: ${r.error}`);
  }
  if (process.env.FLIGHT_PUBLIC_API_URL) {
    const r = await livePublicUrl(fields);
    if (r.ok) return r;
    errors.push(`public_url: ${r.error}`);
  }

  // Keyless fallback
  const os = await liveOpenSky(fields);
  if (os.ok) return os;
  errors.push(`opensky: ${os.error}`);

  return {
    ok: false,
    error:
      errors.length > 0
        ? errors.join(" | ")
        : "No flight inventory provider configured. Set AMADEUS_CLIENT_ID+SECRET (Flight Offers) for inventoryLive; FLIGHT_API_KEY is schedule-only.",
  };
}


/** Inventory/fare keys only — schedule-only Aviationstack must not unlock fake-price fixtures. */
function flightInventoryOrPublicConfigured(): boolean {
  if (process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET) return true;
  if (process.env.FLIGHT_PUBLIC_API_URL) return true;
  return false;
}

export const flightAdapter: TicketAdapter = {
  id: "flight",
  channel: "flight",
  async search(input: AdapterSearchInput): Promise<ShortlistResult> {
    const mode = resolveProviderMode(input.mode);
    const fields = input.fields as unknown as FlightFields;
    const live =
      mode === "live" ? await liveSearch(fields) : { ok: false as const, error: "fixture mode" };

    let provider = "flight";
    if (live.ok && live.data?.[0]?.meta?.source != null) {
      provider = String(live.data[0].meta!.source);
    }

    const result = finalizeSearchResult({
      channel: "flight",
      provider,
      requestedMode: mode,
      live,
      fixtureItems: flightInventoryOrPublicConfigured() || mode !== "live"
        ? fixtureItems(fields)
        : [],
      fixtureNotes:
        mode === "live" && !flightInventoryOrPublicConfigured()
          ? "未配置机票可售库存 API（AMADEUS_CLIENT_ID/SECRET 或 FLIGHT_PUBLIC_API_URL）。Aviationstack/OpenSky 仅时刻/ADS-B，不算可售。不会展示虚假票价。"
          : "Fixture mode — sample flight shortlist (演示数据，非实时票价).",
    });

    // Schedule-only / ADS-B providers — never present as bookable inventory or 「可抢」.
    const scheduleOnly =
      provider === "opensky" || provider === "aviationstack";
    if (result.liveOk && scheduleOnly) {
      if (provider === "opensky") {
        result.notes =
          "OpenSky ADS-B 公开离港（无票价、无余票）。非航司可售库存；配置 Amadeus Flight Offers 后可获得可订报价。flightScheduleConfigured 表示 ADS-B 已配置；flightScheduleLive 仅在最近一次拉取成功时为 true，不等于 inventoryLive。";
      } else {
        result.notes =
          "Aviationstack 时刻/状态（无可靠票价、无可售座位证明）。flightScheduleConfigured 可 true；flightScheduleLive 仅最近一次时刻拉取成功时为 true；flightInventoryLive 仍为 false；不会作为「可抢/有票」成功。";
      }
      for (const item of result.items) {
        if (item.availability === "available" || item.availability === "limited") {
          item.availability = "unknown";
        }
        item.meta = {
          ...(item.meta ?? {}),
          scheduleOnly: true,
          noPrice: true,
          inventoryHonest: false,
        };
      }
    }
    if (mode === "live") {
      // Schedule/ADS-B honesty: last fetch outcome (429/404 → false). Config alone never sets live.
      const scheduleProviderOk =
        result.liveOk === true &&
        (provider === "opensky" ||
          provider === "aviationstack" ||
          provider === "amadeus" ||
          provider === "flight_public");
      recordFlightScheduleFetch(scheduleProviderOk);
    }
    if (!result.liveOk && mode === "live") {
      const reason = live.error ?? "live fetch failed";
      result.notes = `实时源暂不可用：${reason}`;
    }
    return result;
  },
};
