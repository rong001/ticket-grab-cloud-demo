# REAL_TRAIN_SUBMIT_AUDIT — ToC honesty (train submit vs monitor/notify)

**Date:** 2026-09-22  
**Scope:** `/workspace/ticket-grab-cloud` + live `https://159.75.71.192:18444`  
**Passwords:** not handled / not published.  
**Overall product:** still **待验收** (third party cannot independently restart; email not configured).  
**P1e:** still **通过** (unchanged by this audit).

---

## 1. Flag meanings (with source)

| Field / env | Meaning | Source |
|-------------|---------|--------|
| `providerMode` | `PROVIDER_MODE` — search adapters live vs fixture | `apps/api/src/env.ts` (`providerMode`) |
| `bookingStub` | Stub/fake booking confirmations. `BOOKING_STUB=0` forces false even if fixture search | `apps/api/src/lib/bookingFlags.ts` |
| `trainBookingDryRun` | `TRAIN_BOOKING_DRY_RUN=1` — stop before final 12306 confirm | same + `packages/shared/src/booking/12306/order.ts` dry-run branch |
| `trainLiveQuery` | `providerMode === "live"` — public left-ticket / catalog query only | `bookingFlags.ts` |
| `trainRealSubmit` | **NEW honest flag.** True only when `TRAIN_REAL_SUBMIT=1` (legacy alias `TRAIN_SUBMIT_ENABLED=1`). Default **false** | `bookingFlags.ts`, `/health` in `apps/api/src/app.ts` |
| `realTrainSubmit` | **Deprecated.** Historically `!bookingStub` (misleading). Now aliases `trainRealSubmit && !bookingStub` | was `app.ts` health; fixed via `resolveBookingFlags()` |

### Historical bug (user-confirmed)

Before this fix, health did:

```ts
realTrainSubmit: !bookingStub  // apps/api/src/app.ts (pre-fix)
```

So live with `BOOKING_STUB=0` reported `realTrainSubmit=true` even though docs/UI said monitor + notify + official redirect only.

---

## 2. Call graph — when does 12306 order/seat-hold/submit run?

```
POST /orders/:id/submit          apps/api/src/routes/orders.ts
  → authenticate (401 if no/invalid token)
  → ownership: findFirst({ id, userId }) → 404 if other user's order
  → GATE: train channel && !stub && !TRAIN_REAL_SUBMIT → 403 train_submit_disabled
  → bookingSubmit(...)           @ticket-grab/shared booking/index.ts
    → trainBookingAdapter.submitOrder   packages/shared/src/booking/train.ts
      → GATE: TRAIN_REAL_SUBMIT≠1 → failed / train_submit_disabled (no OTN calls)
      → submitTrainOrder                packages/shared/src/booking/12306/order.ts
        → /otn/leftTicket/submitOrderRequest
        → /otn/confirmPassenger/initDc
        → /otn/confirmPassenger/checkOrderInfo
        → (dry-run stop if TRAIN_BOOKING_DRY_RUN=1)
        → GATE: TRAIN_REAL_SUBMIT≠1 → fail before confirm
        → /otn/confirmPassenger/confirmSingleForQueue   ← REAL submit
        → queryOrderWaitTime
```

**Intake / watch do NOT call this path:**

- `POST /intake/confirm` creates request + watch with `autoOrder: false`, `notifyOnly: true`  
  (`apps/api/src/routes/intake.ts` ~169, ~185).
- Worker `maybeAutoOrder` only creates an `awaiting_login` draft order — never calls `submitOrder` / `confirmSingleForQueue`  
  (`apps/worker/src/processor.ts` ~59–194, status `"awaiting_login"`).

---

## 3. Can intake confirm or watch auto-submit without official 12306?

| Path | Auto-submit 12306? | Evidence |
|------|--------------------|----------|
| Intake confirm | **No** | `autoOrder: false` in intake.ts |
| Watch `autoOrder=true` | **No submit** — only draft `awaiting_login` | processor.ts `maybeAutoOrder` |
| `POST /orders/:id/submit` | Only if `TRAIN_REAL_SUBMIT=1` + linked session + explicit user POST | orders.ts gate + train.ts + order.ts |

---

## 4. Live env keys (values for booleans only; no secrets)

From `/home/ubuntu/ticket-grab-cloud/.env.production` on live:

Keys present: `NODE_ENV`, `POSTGRES_*`, `JWT_*`, `ENCRYPTION_KEY`, `CORS_ORIGIN`, `WEB_BASE_URL`, `NEXT_PUBLIC_API_URL`, `PROVIDER_MODE`, `BOOKING_STUB`, `TRAIN_BOOKING_DRY_RUN`, `TRAIN_REAL_SUBMIT` (added), `STRICT_LIVE`, `FLIGHT_OPENSKY`, `LOG_LEVEL`, `RATE_LIMIT_REDIS`, `API_*`, `ALLOW_PUBLIC_REGISTER`, …

Booking-related values after fix:

- `PROVIDER_MODE=live`
- `BOOKING_STUB=0`
- `TRAIN_BOOKING_DRY_RUN=0`
- `TRAIN_REAL_SUBMIT=0` ← **default OFF**

---

## 5. Before / after health JSON

**Before (misleading):**

```json
{"ok":true,"providerMode":"live","bookingStub":false,"trainBookingDryRun":false,"realTrainSubmit":true}
```

**After (honest; deploy evidence filled below):**

```json
{"ok":true,"providerMode":"live","bookingStub":false,"trainBookingDryRun":false,"trainLiveQuery":true,"trainRealSubmit":false,"realTrainSubmit":false}
```

---

## 6. Gate probes (filled after deploy)

| Probe | Expected | Result |
|-------|----------|--------|
| `POST /orders/:id/submit` no Authorization | 401 | 401 `{"error":"Unauthorized"}` ✓ |
| `POST /orders/<other-user-id>/submit` with valid token | 404 (ownership hide) or 403 | 404 `{"error":"Not found"}` (ownership hide; not cross-user leak) ✓ |
| `POST /orders/:id/submit` own train order, `TRAIN_REAL_SUBMIT=0` | 403 `train_submit_disabled` | 403 `train_submit_disabled` / `trainRealSubmit:false` ✓ |
| Intake / grep: confirm path never references `confirmSingleForQueue` | no match | `rg confirmSingleForQueue|submitTrainOrder intake.ts` → NO_MATCH ✓ |

---

## 7. TLS (`curl -k` removed)

- `TOC_E2E_COMMANDS.sh` now uses `curl -sS` (verify TLS), not `-k` / `-sk`.
- Live cert: Let's Encrypt IP SAN for `159.75.71.192` — stock CA should verify.
- Evidence: `curl https://159.75.71.192:18444/api/health` succeeds **without** `-k` (see deploy section).

---

## 8. Acceptance labels

- **P1e:** 通过 (unchanged)
- **整体产品:** 仍待独立验收
- **This audit item:** pass when health/docs honest and no ungated 12306 submit — **target: PASS after deploy**

## 9. Public commit SHA

`(filled after public push)`


---

## Deploy evidence (2026-09-22)

### TLS probe log
```
curl -sS https://159.75.71.192:18444/api/health
→ http=200 ssl_verify_result=0
cert: Let's Encrypt YE2; SAN critical IP Address:159.75.71.192
(no curl -k required on stock CA store)
```

### Gate probe log
```
POST /orders/.../submit (no Auth) → 401 Unauthorized
POST /orders/<other-user>/submit → 404 Not found
POST /orders/<own-train>/submit with TRAIN_REAL_SUBMIT=0 → 403 train_submit_disabled
intake.ts: no confirmSingleForQueue / submitTrainOrder references
```

### Grep: submit Order URLs are gated
```
packages/shared/src/booking/12306/order.ts
  submitOrderRequest / initDc / checkOrderInfo / confirmSingleForQueue
  confirmSingleForQueue preceded by TRAIN_REAL_SUBMIT gate (default off)
apps/api/src/routes/orders.ts POST /orders/:id/submit → 403 when disabled
```
