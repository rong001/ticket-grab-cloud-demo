# Flight source roadmap — authorized inventory / fare integration

**Status (live):** `flightInventoryLive=false`, `flightFareMonitor=false`  
**Label:** 「实时可售票/票价监控不可用」  
**OpenSky ADS-B:** query demo / trajectory only — **never** bookable inventory or fare monitor.

Overall product remains **未通过** until an authorized inventory+fare source is live with `liveOk=true`.

---

## 1. Formal integration checklist

| # | Source | What it provides | Env vars (placeholders only) | Inventory? | Fare monitor? | Notes |
|---|--------|------------------|------------------------------|------------|---------------|-------|
| 1 | **Amadeus Self-Service** Flight Offers | Bookable offers + prices | `AMADEUS_CLIENT_ID`, `AMADEUS_CLIENT_SECRET`, `AMADEUS_ENV=test\|production` | Yes | Yes | Preferred. Use **test** sandbox first. |
| 2 | **Aviationstack** | Schedules / status | `FLIGHT_API_KEY` | Partial (status) | No (no reliable fares) | OK for schedule honesty; not fare watch. |
| 3 | **Airline official APIs** (e.g. NDC / partner) | Inventory + fare by contract | Airline-specific; map via `FLIGHT_PUBLIC_API_URL` adapter | Yes (if contract) | Yes (if contract) | Requires commercial agreement — do not scrape. |
| 4 | **Custom aggregator** | Whatever the URL returns | `FLIGHT_PUBLIC_API_URL` | If API returns bookable offers | If prices present | Must document response schema; no fake fill. |
| 5 | OpenSky Network | ADS-B departures | `FLIGHT_OPENSKY=0` to disable | **No** | **No** | Keep as optional telemetry only. |

**Do not** treat empty fixture, OpenSky 404, or ADS-B callsigns as「有票/可售」.

---

## 2. Credential-free test plan (sandbox keys as placeholders)

No production secrets are committed. Operators paste sandbox keys into `.env.production` on the host only.

### 2.1 Without any flight inventory key (current live)

1. `GET /api/health` → `flightInventoryLive=false`, `flightFareMonitor=false`, `flightLabelZh` contains「不可用」.
2. `GET /api/meta/data-sources` → flight `badge=unavailable|needs_keys`, `inventoryLive=false`.
3. `POST /api/public/search` `{channel:"flight",fields:{from:"SZX",to:"PVG",date:"2026-09-25"}}` → `liveOk=false`, `mode=fixture`, honest `notes` (e.g. opensky HTTP 404).
4. Web `/requests/new` flight search → red badge「实时可售票/票价监控不可用」, not green「实时」.
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
2. `GET /api/health` → `flightInventoryLive=true`, `flightFareMonitor=true`, `flightProvider=amadeus`.
3. `POST /api/public/search` same SZX→PVG → `liveOk=true`, `mode=live`, `items.length>0`, notes mention Amadeus.
4. Create watch → tick may emit `tickets_found` **only** when `liveOk=true` and availability is available/limited.
5. Cancel watch → BullMQ repeatable gone (see `CANCEL_REPEATABLE_PROOF.md`).

### 2.3 With Aviationstack only

```bash
FLIGHT_API_KEY=REPLACE_WITH_SANDBOX_KEY
```

Expect: `flightInventoryLive=true`, `flightFareMonitor=false`, label「实时(时刻)」 — do not claim fare watch.

### 2.4 Rollback

Unset inventory keys (or set empty), restart → honesty flags return to `false` /「不可用」. Leave OpenSky enabled or set `FLIGHT_OPENSKY=0`.

---

## 3. Code touchpoints

| Layer | File | Behavior |
|-------|------|----------|
| Shared flags | `packages/shared/src/adapters/dataSources.ts` | `inventoryLive` / `fareMonitor`; OpenSky ≠ inventory |
| Health | `apps/api/src/app.ts` `/health` | `flightInventoryLive`, `flightFareMonitor`, … |
| Meta | `apps/api/src/routes/meta.ts` | Top-level + per-channel honesty |
| Adapter | `packages/shared/src/adapters/flight.ts` | Amadeus → Aviationstack → public URL → OpenSky |
| Worker | `apps/worker/src/processor.ts` | No `tickets_found` when flight degraded / `liveOk=false` |
| UI | capabilities, requests/new, grabs, intake `capabilityNote` | 「实时可售票/票价监控不可用」 |

---

## 4. Acceptance labels (flight honesty item)

| Check | Pass criteria |
|-------|----------------|
| Health/meta honesty | `flightInventoryLive=false` without inventory keys |
| Public search | Surfaces `mode` + `liveOk=false`; UI not green「实时可售」 |
| Watch tick | No `tickets_found` / success-as-available on fixture/OpenSky-fail |
| Docs | This roadmap + WATCH_TICK acceptance: flight **诚实不可用** |
| Overall product | **未通过** until inventory liveOk proven |

SMTP / email remains **阻塞**. `TRAIN_REAL_SUBMIT=0` stays.
