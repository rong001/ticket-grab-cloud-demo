# Ticket Grab Cloud — Real Usability Test Report

**Date:** 2026-09-20  
**Environment:** Linux box without Docker; PostgreSQL 17 + Redis 8 installed via apt and started manually.  
**Scope:** Legal assistive public search/watch only (no booking automation, no auth-wall / captcha bypass).

## Summary

| Feature | Result | Data source in live probe | Notes |
|---------|--------|---------------------------|-------|
| Train adapter (live) | **PASS** | **live** (12306 `leftTicket/queryG`) | Cookie warm-up required; returns real train numbers/times |
| Show adapter (live) | **PASS** | **live** (Dianping myshow / Gewara public JSON) | Detail `performanceId=498506` → 安溥演唱会 |
| Flight adapter (live) | **PASS*** | **fixture** (explicit fail) | No keyless public schedule API; `liveOk=false` + clear notes; `STRICT_LIVE=1` throws |
| liveOk / STRICT_LIVE | **PASS** | — | Callers can tell live vs demo; strict mode fails loudly |
| Unit tests | **PASS** | fixture + recorded payloads | 17 shared + 2 API tests |
| API E2E (fixture) | **PASS** | fixture | register → login → create → search ×3 → watch → NotificationEvent |

\*Flight “PASS” means honest failure semantics in live mode, not live inventory.

## 1. Adapter live probes (manual)

### Train — LIVE

```
PROVIDER_MODE=live  from=深圳北 to=广州南 date=2026-09-27
mode=live  liveOk=true  items=40
sample: G1102 深圳北 → 广州南 | 2026-09-27 06:08–06:37 · 二等座
```

- Source: public `https://kyfw.12306.cn/otn/leftTicket/queryG` after `init` cookie warm-up (`JSESSIONID` / `BIGipServerotn`).
- Station names resolved via public `station_name.js` (with builtin fallback).
- Assistive only — if captcha/IP HTML interstitial appears, adapter reports `LIVE FAILED` (does not pretend fixture is live).

### Show — LIVE

```
PROVIDER_MODE=live  performanceId=498506 (gewara.com/detail/498506)
mode=live  liveOk=true  items=1
sample: 安溥 2026 to ebb 潮水箴言演唱会-上海站
        上海 · 梅赛德斯-奔驰文化中心 · 2026.11.14 / 11.15 · ¥480-1180
```

- Source: public `https://m.dianping.com/myshow/ajax/performance/{id};poi=false?sellChannel=7` (same backend Gewara PC uses).
- Also supports keyword list search and `detailUrl` / `#id` extraction.
- No login; public JSON only.

### Flight — LIVE FAILED (honest)

```
mode=fixture  liveOk=false
notes: LIVE FAILED — fell back to fixture. Reason: No keyless public flight schedule API configured...
STRICT_LIVE=1 → throws LiveProviderError
```

- Blocker: Amadeus / Aviationstack need API keys; OpenSky TLS failed from this host; Google Flights / Ctrip HTML not a reliable assistive JSON source.
- Callers must set `FLIGHT_PUBLIC_API_URL` to a JSON `{items: ShortlistItem[]}` endpoint for true live flight data.

## 2. Critical behavior: liveOk + STRICT_LIVE

| Mode | Live OK | Result |
|------|---------|--------|
| `fixture` | `liveOk=false` | Fixture items + fixture notes |
| `live` success | `liveOk=true`, `mode=live` | Real items |
| `live` failure | `liveOk=false`, `mode=fixture` | Fixture items + notes starting with `LIVE FAILED —` |
| `live` + `STRICT_LIVE=1` failure | throws `LiveProviderError` | No silent fallback |

## 3. Full API path E2E (fixture mode, no Docker)

Stack on this machine:

- PostgreSQL 17 (`ticket` / `ticket_grab` on `127.0.0.1:5432`)
- Redis 8 (`127.0.0.1:6379`)
- `apps/api` + `apps/worker` via `pnpm start` (compiled `dist/`)

Flow exercised:

1. `POST /auth/register` → JWT  
2. `POST /auth/login` → JWT  
3. `POST /requests` for train / show / flight  
4. `POST /requests/:id/search` → shortlist snapshots (`mode=fixture`, `liveOk=false`)  
5. `POST /requests/:id/watch` (`intervalMinutes=5`)  
6. Worker processed immediate job → `NotificationEvent` types observed: `watch_started`, `watch_check`, `search_completed`

**Result: PASS**

## 4. Unit tests

```
pnpm --filter @ticket-grab/shared test   # 17 pass (smoke + recorded HTML/JSON parse + STRICT_LIVE)
pnpm --filter @ticket-grab/api test      # 2 pass
```

Recorded fixtures under `packages/shared/src/adapters/fixtures/` (12306 sample, Gewara performance 498506).

## 5. What is real vs demo (for the user)

| Channel | In `PROVIDER_MODE=live` today | How you can tell |
|---------|-------------------------------|------------------|
| Train | Real 12306 left-ticket shortlist (when not blocked) | `mode:"live"` + `liveOk:true` + real G/C/D numbers |
| Show | Real Dianping/Gewara public performance JSON | `mode:"live"` + `liveOk:true` + real event title/venue/price |
| Flight | Demo fixture unless `FLIGHT_PUBLIC_API_URL` set | `liveOk:false` and notes contain `LIVE FAILED` |

## 6. Code changes (ready to commit)

- `packages/shared/src/adapters/liveMode.ts` — shared live/fixture finalize, `liveOk`, `STRICT_LIVE`
- `packages/shared/src/adapters/train12306.ts` — live 12306 query + station index + cookie warm-up
- `packages/shared/src/adapters/show.ts` — live Dianping myshow detail/search parsers
- `packages/shared/src/adapters/flight.ts` — honest live failure / optional public API URL
- `packages/shared/src/types.ts` / schemas — `liveOk`, show `performanceId` / `detailUrl`
- Fixtures + expanded unit tests
- `.env.example` — documents `STRICT_LIVE` and optional live URLs

No Docker required for local E2E if Postgres + Redis are installed via apt (as on this box).

## 7. Remaining blockers

1. **Flight live inventory** needs a keyless JSON source or a user-supplied `FLIGHT_PUBLIC_API_URL`.  
2. **12306** may intermittently return HTML captcha pages from some IPs — adapter already surfaces this as live failure.  
3. SMTP / Mailhog not required for NotificationEvent persistence; email send may no-op without SMTP.

---

## 8. In-system ops coverage (2026-09-20)

**Goal:** Customer completes ticket ops inside this product UI/API without being told “请自行打开12306 App”. Official login/pay = in-product handoff page.

### Checklist

| Capability | Status | How to verify |
|------------|--------|---------------|
| Prisma `Traveler` / `PlatformCredential` / `Order` | **DONE** | `schema.prisma` + migration `20260920000000_in_system_ops` |
| Traveler CRUD API (ID encrypted, hint only in list) | **DONE** | `POST/GET/PATCH/DELETE /travelers` |
| Platform link start/complete/status | **DONE** | `POST /platforms/link/start`, `link/complete`, `GET /platforms` |
| Create order from shortlist + travelers | **DONE** | `POST /requests/:id/orders` |
| Submit → session-aware status machine | **DONE** | No session → `awaiting_login`; stub+session → `awaiting_payment` with `STUB-*` id |
| Payment handoff stays in-product | **DONE** | `POST /orders/:id/payment-handoff` → `/checkout/:orderId?step=pay` |
| NotificationEvent order kinds | **DONE** | `order_created`, `order_submitted`, `order_payment_handoff`, `order_paid` |
| Booking adapters honest (no fake paid) | **DONE** | Unit tests: linked without stub ≠ paid; stub confirmation required for mark-paid |
| Web nav: 查票 / 盯票 / 乘车人 / 订单 / 账号绑定 | **DONE** | `apps/web` layout + pages |
| 下单 wizard on shortlist | **DONE** | Request detail 「下单」→ travelers → checkout |
| Checkout page under our domain | **DONE** | `/checkout/[orderId]` login + pay steps |
| Unit: order transitions + traveler validation | **DONE** | `packages/shared` `order.test.ts` |
| API smoke fixture path | **DONE** | `apps/api` `orders.smoke.test.ts` |



### Show / flight in-system parity (2026-09-20)

| Capability | Status | How to verify |
|------------|--------|---------------|
| Show booking stub: prepare / submit / query | **DONE** | `packages/shared` show adapter; sold_out → `候补中` + `STUB-SHOW-*` |
| Flight booking stub: prepare / submit / query | **DONE** | flight adapter; linked+stub → `awaiting_payment` + `STUB-FLT-*` + cabin fields |
| Show session: damai **or** maoyan | **DONE** | `platformsForChannel` + `loadSession` prefers linked blob; `preferredPlatform` on create |
| `GET /orders?channel=` filter | **DONE** | API smoke + 订单页筛选按钮 |
| Shortlist 下单 wizard: 票档 / 舱位 | **DONE** | Request detail shows tier/cabin; 观演人/乘机人 labels |
| Checkout copy by channel | **DONE** | `/checkout/[orderId]` 大麦/猫眼 vs 航司/OTA vs 12306 |
| Platform bind damai/maoyan/airline | **DONE** | `/accounts` per-platform handoff steps equal to 12306 |
| API smoke show available + waitlist + flight | **DONE** | `orders.smoke.test.ts` |
| Unit: show 候补 / flight cabin | **DONE** | `order.test.ts` |

#### Click-path (equal to train)

**演出：** 乘车人 → 账号绑定(大麦/猫眼) → 查票(演出) → 下单(票档+观演人) → 结账登录手递 → 提交 → 有票支付 / 售罄候补中 → 订单筛选「演出」

**机票：** 乘车人 → 账号绑定(航司) → 查票(机票) → 下单(舱位+乘机人) → 结账登录手递 → 提交 → 支付手递 → 订单筛选「机票」


### Remaining blockers

1. **Real 12306 order submit** — **implemented (assistive)** in `packages/shared/src/booking/12306/`: login + captcha/SMS continuation + passenger list + submit-until-captcha/confirm with `TRAIN_BOOKING_DRY_RUN`. Human still required for captcha/SMS/face and official payment. Never marks `paid` without live confirmation fields.
2. **Real Damai/Maoyan/airline submit & pay callbacks** — same; handoff UI is in place, live APIs are not.
3. **Production WebView** for official login is stubbed as token paste / demo session in UI.
4. **ENCRYPTION_KEY** must be set in production; without it blobs use `plain:` prefix (dev only).
