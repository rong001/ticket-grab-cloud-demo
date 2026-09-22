# ACCEPTANCE — Flight passenger watch → order parity

**Deliverable:** `flight-pax-watch-order-parity`  
**Overall product status:** **未通过**  
**Live:** https://159.75.71.192:18444/  
**UI:** https://159.75.71.192:18444/travelers · https://159.75.71.192:18444/grabs · https://159.75.71.192:18444/orders/{id}

## What this round delivers

1. Flight watches accept `travelerIds` with the same ownership / authorized-consent / count rules as train (`passengers` ↔ traveler count)
2. Explicit `POST /api/grabs/:id/create-order` for **channel=flight** → **draft only**, with traveler summaries; schedule-only shortlist items allowed for UX continuity but clearly flagged `scheduleOnly` / not sellable
3. Flight submit path stays honest: when `BOOKING_STUB≠1`, `POST /orders/:id/submit` returns **403** `FLIGHT_INVENTORY_UNAVAILABLE` (alias `FLIGHT_AUTO_BUY_UNAVAILABLE`) — **never** marks paid; OpenSky/Aviationstack schedule is **not** sellable inventory
4. UI: `/travelers` includes **乘机人**; `/grabs` + TimedGrabPanel button **「用已选乘机人创建草稿订单」**; health/meta keep `flightInventoryLive=false` without fare API keys
5. Smoke: `apps/api/src/flight-pax-watch-order.smoke.test.ts` (keyless)

**No** fake Amadeus keys, no fixture fares as live inventory, no enabling `TRAIN_REAL_SUBMIT`, no overall PASS claim, no commerce :80/:443 touch.

## Formal channel conditions (honest — 待接入)

| Step | Status |
|------|--------|
| Bind 乘机人 | PASS — same traveler archive + consent |
| Watch + create draft | PASS — explicit user action |
| Fare / inventory API | **未接入** (Amadeus / authorized fare API) |
| Schedule-only sources | OpenSky / Aviationstack → schedule only; **not** inventoryLive |
| Login | Assistive airline/OTA path; **待用户登录官方** |
| Auto-buy / submit | **未接入** → `FLIGHT_INVENTORY_UNAVAILABLE` when not stub |
| Pay | Official airline/OTA cashier; **待用户登录官方** |
| Fake paid from schedule | **Forbidden** |

Train real submit: live **TRAIN_REAL_SUBMIT=0** (unchanged).

## Acceptance checklist

| # | Criterion | Expected |
|---|-----------|----------|
| 1 | 2 pax (self + authorized) → flight watch with travelerIds | PASS |
| 2 | passengers≠travelerIds length → 400 | PASS |
| 3 | `POST /grabs/:id/create-order` → draft, 2 pax hints, flight nextSteps | PASS |
| 4 | Idempotent reuse for same watch+item | PASS |
| 5 | Submit → 403 `FLIGHT_INVENTORY_UNAVAILABLE`; status not paid | PASS |
| 6 | Watch without travelerIds → create-order 400 `TRAVELER_IDS_REQUIRED` (乘机人) | PASS |
| 7 | health/meta `flightInventoryLive=false` without keys; schedule ≠ inventory | PASS |
| 8 | UI travelers + grabs 乘机人 draft button | PASS |
| 9 | Live `TRAIN_REAL_SUBMIT=0`; no commerce 80/443 | PASS |
| 10 | Overall unattended real purchase ready | **FAIL — 未通过** |

## API sketch (fake IDs only)

```bash
BASE=https://159.75.71.192:18444/api
# register → 2 travelers (authorizedConsent) → flight request passengers=2 → search → watch travelerIds
# POST /grabs/$WATCH_ID/create-order
# → 201 {"orderId":"...","status":"draft","channel":"flight","travelerIds":["A","B"],"flightInventoryLive":false,"flightAutoBuy":false,"nextSteps":[...待接入...]}
# POST /orders/$OID/submit → 403 FLIGHT_INVENTORY_UNAVAILABLE (when BOOKING_STUB=0)
curl -sS "$BASE/health" | jq '{trainRealSubmit,bookingStub,flightInventoryLive,providerMode}'
```

## Commit SHAs

- Private: _(pending)_
- Public demo: _(pending)_

## Live evidence

_(filled after deploy)_

## Remaining main blocker

**Authorized flight inventory / fare API keys (e.g. Amadeus Flight Offers) + airline/OTA login + official pay.** OpenSky/Aviationstack must never be treated as sellable inventory. This round only closes flight 乘机人 bind → draft-order parity with train/show; inventory/auto-buy remains unavailable.

## Overall: **未通过**
