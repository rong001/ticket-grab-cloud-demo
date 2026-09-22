# Flight source roadmap — authorized inventory / fare integration

**Status (live):** `flightInventoryLive=false`, `flightFareMonitor=false`  
**Schedule (config vs live):**  
- `flightScheduleConfigured` / `scheduleConfigured` = OpenSky enabled or Aviationstack/Amadeus key present (**config only**).  
- `flightScheduleLive` / `scheduleLive` = **last successful** realtime schedule/ADS-B fetch in this process (429/404/fail → `false`).  
Health/meta must **not** claim `scheduleLive=true` from config alone. Public search exposes both; UI never greens「实时」from `scheduleConfigured` alone.  
**Label:** 「实时可售票/票价监控不可用」; on fetch fail with source configured:「时刻源已配置·最近拉取失败」  
**OpenSky ADS-B:** query demo / trajectory only — **never** bookable inventory, fare monitor, `tickets_found`, or UI「可抢」.

Overall product remains **未通过** until an authorized inventory+fare source is live with inventory `liveOk=true`.

---

## 1. Formal integration checklist

| # | Source | What it provides | Env vars (placeholders only) | Inventory? | Schedule configured? | Fare monitor? | Notes |
|---|--------|------------------|------------------------------|------------|----------------------|---------------|-------|
| 1 | **Amadeus Self-Service** Flight Offers | Bookable offers + prices | `AMADEUS_CLIENT_ID`, `AMADEUS_CLIENT_SECRET`, `AMADEUS_ENV=test\|production` | **Yes** → `inventoryLive` | Yes → `scheduleConfigured` | **Yes** | Preferred. Use **test** sandbox first. `scheduleLive` only after successful fetch. |
| 2 | **Aviationstack** | Schedules / status | `FLIGHT_API_KEY` | **No** | **Yes** → `scheduleConfigured` | **No** | Timetable honesty only; cannot prove future sellable inventory/fares. |
| 3 | **Airline official APIs** (e.g. NDC / partner) | Inventory + fare by contract | Airline-specific; map via `FLIGHT_PUBLIC_API_URL` adapter | Yes (if contract) | Yes | Yes (if contract) | Requires commercial agreement — do not scrape. |
| 4 | **Custom aggregator** | Whatever the URL returns | `FLIGHT_PUBLIC_API_URL` | If API returns bookable offers | If schedules present | If prices present | Must document response schema; no fake fill. |
| 5 | OpenSky Network | ADS-B departures | `FLIGHT_OPENSKY=0` to disable | **No** | Config may set `scheduleConfigured` | **No** | Telemetry only; 404/429/fail → search `scheduleLive=false`; health must not keep claiming live. |

**Do not** treat empty fixture, OpenSky 404/429, ADS-B callsigns, or Aviationstack timetable rows as「有票/可售/可抢」.

---

## 2. Credential-free test plan (sandbox keys as placeholders)

No production secrets are committed. Operators paste sandbox keys into `.env.production` on the host only.

### 2.1 Without any flight inventory key (current live)

1. `GET /api/health` → `flightInventoryLive=false`, `flightFareMonitor=false`, `flightLabelZh` contains「不可用」. `flightScheduleConfigured` may be `true` if OpenSky is left enabled; **`flightScheduleLive=false` until a successful probe/search** (health does not claim live success from config).
2. `GET /api/meta/data-sources` → flight `badge=unavailable|needs_keys`, `inventoryLive=false`, `scheduleConfigured` may true, `scheduleLive` only if last fetch ok.
3. `POST /api/public/search` `{channel:"flight",fields:{from:"SZX",to:"PVG",date:"2026-09-25"}}` → `liveOk=false`, `inventoryLive=false`, `scheduleConfigured=true` (if OpenSky on), `scheduleLive=false` on OpenSky 429/404/miss, honest `notes`, `items=[]` (no fake fares).
4. Web `/requests/new` flight search → badge「时刻源已配置·最近拉取失败」or「实时可售票/票价监控不可用」, not green「实时可售」/「可抢」.
5. Watch tick on flight → status `failed` / degraded, event `watch_failed`, **zero** `tickets_found`.
6. UI still offers 查询 / 官方跳转演示 copy.

### 2.2 With Amadeus **test** sandbox (placeholders)

```bash
# .env.production (host only — never commit real values)
AMADEUS_CLIENT_ID=REPLACE_WITH_TEST_ID
AMADEUS_CLIENT_SECRET=REPLACE_WITH_TEST_SECRET
AMADEUS_ENV=test
```

Verify:

1. Rebuild/restart `api` + `worker`.
2. `GET /api/health` → `flightInventoryLive=true`, `flightFareMonitor=true`, `flightScheduleConfigured=true`, `flightProvider=amadeus`. `flightScheduleLive` true only after a successful search/probe in that process.
3. `POST /api/public/search` same SZX→PVG → `liveOk=true`, `inventoryLive=true`, `scheduleLive=true`, `mode=live`, `items.length>0` with prices, notes mention Amadeus.
4. Create watch → tick may emit `tickets_found` **only** when inventory `liveOk=true` and availability is available/limited from Amadeus/flight_public.
5. Cancel watch → BullMQ repeatable gone (see `CANCEL_REPEATABLE_SELFTEST.sh` / `READONLY_QUEUE_EVIDENCE.md`).

### 2.3 With Aviationstack only

```bash
FLIGHT_API_KEY=REPLACE_WITH_SANDBOX_KEY
# Do NOT set AMADEUS_* 
```

Expect:

- `flightScheduleConfigured=true`
- `flightScheduleLive` true only after a successful timetable fetch (not from key presence alone)
- `flightInventoryLive=false`
- `flightFareMonitor=false`
- Label remains「实时可售票/票价监控不可用」(or schedule note without claiming fares)
- Public search may return timetable rows with `availability=unknown`, `meta.scheduleOnly=true`, **no** `tickets_found` / UI「可抢」
- **Never** claim fare watch or sellable inventory from Aviationstack alone

### 2.4 Rollback

Unset inventory keys (or set empty), restart → honesty flags return to `false` /「不可用」. Leave OpenSky enabled or set `FLIGHT_OPENSKY=0`.

---

## 3. Code touchpoints

| Layer | File | Behavior |
|-------|------|----------|
| Shared flags | `packages/shared/src/adapters/dataSources.ts` | `inventoryLive` / `scheduleConfigured` / `scheduleLive` (last fetch) / `fareMonitor`; `recordFlightScheduleFetch` |
| Health | `apps/api/src/app.ts` `/health` | `flightInventoryLive`, `flightScheduleConfigured`, `flightScheduleLive`, `flightFareMonitor`, … |
| Meta | `apps/api/src/routes/meta.ts` | Top-level + per-channel; public search exposes `scheduleConfigured` + `scheduleLive` |
| Adapter | `packages/shared/src/adapters/flight.ts` | Records last schedule fetch; Amadeus → Aviationstack → public URL → OpenSky |
| Worker | `apps/worker/src/processor.ts` | No `tickets_found` for opensky/aviationstack/fixture/`liveOk=false` |
| UI | capabilities, requests/new, grabs, intake | 「时刻源已配置·最近拉取失败」vs「实时可售」; scheduleConfigured ≠ 实时 |

---

## 4. Acceptance labels (flight honesty item)

| Check | Pass criteria |
|-------|----------------|
| Health/meta honesty | `flightInventoryLive=false` without Amadeus/public inventory URL; health does not claim `scheduleLive=true` from OpenSky config alone |
| Aviationstack alone | `scheduleConfigured` may true; `scheduleLive` only after successful fetch — never `inventoryLive` |
| Public search | Surfaces `liveOk` (inventory) + `scheduleConfigured` + `scheduleLive`; UI not green「实时可售/可抢」on scheduleConfigured alone |
| OpenSky 429/404 | `scheduleLive=false`, `inventoryLive=false`, no `tickets_found`/可抢 |
| Watch tick | No `tickets_found` / success-as-available on fixture/OpenSky/Aviationstack |
| Docs | This roadmap + self-serve cancel: `CANCEL_REPEATABLE_SELFTEST.sh` |
| Overall product | **未通过** until inventory liveOk proven |

SMTP / email remains **阻塞**. `TRAIN_REAL_SUBMIT=0` stays.
