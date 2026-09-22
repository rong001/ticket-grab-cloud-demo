# Flight source roadmap — authorized inventory / fare integration

**Status (live):** `flightInventoryLive=false`, `flightFareMonitor=false`  
**Schedule (config):** `flightScheduleLive` may be `true` when OpenSky/Aviationstack is configured — **schedule/ADS-B only**, never sellable inventory.  
**Label:** 「实时可售票/票价监控不可用」  
**OpenSky ADS-B:** query demo / trajectory only — **never** bookable inventory, fare monitor, `tickets_found`, or UI「可抢」.

Overall product remains **未通过** until an authorized inventory+fare source is live with inventory `liveOk=true`.

---

## 1. Formal integration checklist

| # | Source | What it provides | Env vars (placeholders only) | Inventory? | Schedule? | Fare monitor? | Notes |
|---|--------|------------------|------------------------------|------------|-----------|---------------|-------|
| 1 | **Amadeus Self-Service** Flight Offers | Bookable offers + prices | `AMADEUS_CLIENT_ID`, `AMADEUS_CLIENT_SECRET`, `AMADEUS_ENV=test\|production` | **Yes** → `inventoryLive` | Yes | **Yes** | Preferred. Use **test** sandbox first. |
| 2 | **Aviationstack** | Schedules / status | `FLIGHT_API_KEY` | **No** | **Yes** → `scheduleLive` only | **No** | Timetable honesty only; cannot prove future sellable inventory/fares. |
| 3 | **Airline official APIs** (e.g. NDC / partner) | Inventory + fare by contract | Airline-specific; map via `FLIGHT_PUBLIC_API_URL` adapter | Yes (if contract) | Yes | Yes (if contract) | Requires commercial agreement — do not scrape. |
| 4 | **Custom aggregator** | Whatever the URL returns | `FLIGHT_PUBLIC_API_URL` | If API returns bookable offers | If schedules present | If prices present | Must document response schema; no fake fill. |
| 5 | OpenSky Network | ADS-B departures | `FLIGHT_OPENSKY=0` to disable | **No** | Config may set `scheduleLive` | **No** | Telemetry only; 404/fail → search `scheduleLive=false` / degraded. |

**Do not** treat empty fixture, OpenSky 404, ADS-B callsigns, or Aviationstack timetable rows as「有票/可售/可抢」.

---

## 2. Credential-free test plan (sandbox keys as placeholders)

No production secrets are committed. Operators paste sandbox keys into `.env.production` on the host only.

### 2.1 Without any flight inventory key (current live)

1. `GET /api/health` → `flightInventoryLive=false`, `flightFareMonitor=false`, `flightLabelZh` contains「不可用」. `flightScheduleLive` may be `true` if OpenSky is left enabled (ADS-B config only).
2. `GET /api/meta/data-sources` → flight `badge=unavailable|needs_keys`, `inventoryLive=false`.
3. `POST /api/public/search` `{channel:"flight",fields:{from:"SZX",to:"PVG",date:"2026-09-25"}}` → `liveOk=false`, `inventoryLive=false`, `scheduleLive=false` on OpenSky miss, honest `notes`, `items=[]` (no fake fares).
4. Web `/requests/new` flight search → red badge「实时可售票/票价监控不可用」, not green「实时可售」/「可抢」.
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
2. `GET /api/health` → `flightInventoryLive=true`, `flightFareMonitor=true`, `flightScheduleLive=true`, `flightProvider=amadeus`.
3. `POST /api/public/search` same SZX→PVG → `liveOk=true`, `inventoryLive=true`, `mode=live`, `items.length>0` with prices, notes mention Amadeus.
4. Create watch → tick may emit `tickets_found` **only** when inventory `liveOk=true` and availability is available/limited from Amadeus/flight_public.
5. Cancel watch → BullMQ repeatable gone (see `CANCEL_REPEATABLE_SELFTEST.sh` / `READONLY_QUEUE_EVIDENCE.md`).

### 2.3 With Aviationstack only

```bash
FLIGHT_API_KEY=REPLACE_WITH_SANDBOX_KEY
# Do NOT set AMADEUS_* 
```

Expect:

- `flightScheduleLive=true`
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
| Shared flags | `packages/shared/src/adapters/dataSources.ts` | `inventoryLive` / `scheduleLive` / `fareMonitor`; Aviationstack → schedule only; OpenSky ≠ inventory |
| Health | `apps/api/src/app.ts` `/health` | `flightInventoryLive`, `flightScheduleLive`, `flightFareMonitor`, … |
| Meta | `apps/api/src/routes/meta.ts` | Top-level + per-channel honesty; public search inventory vs schedule |
| Adapter | `packages/shared/src/adapters/flight.ts` | Amadeus (inventory) → Aviationstack (schedule) → public URL → OpenSky |
| Worker | `apps/worker/src/processor.ts` | No `tickets_found` for opensky/aviationstack/fixture/`liveOk=false` |
| UI | capabilities, requests/new, grabs, intake | 「实时可售票/票价监控不可用」; schedule ≠ 可抢 |

---

## 4. Acceptance labels (flight honesty item)

| Check | Pass criteria |
|-------|----------------|
| Health/meta honesty | `flightInventoryLive=false` without Amadeus/public inventory URL |
| Aviationstack alone | `scheduleLive` only — never `inventoryLive` |
| Public search | Surfaces `liveOk` (inventory) + `scheduleLive`; UI not green「实时可售/可抢」 on schedule/OpenSky |
| Watch tick | No `tickets_found` / success-as-available on fixture/OpenSky/Aviationstack |
| Docs | This roadmap + self-serve cancel: `CANCEL_REPEATABLE_SELFTEST.sh` |
| Overall product | **未通过** until inventory liveOk proven |

SMTP / email remains **阻塞**. `TRAIN_REAL_SUBMIT=0` stays.
