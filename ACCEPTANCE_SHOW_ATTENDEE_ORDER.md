# ACCEPTANCE — Show attendee watch → order parity

**Deliverable:** `show-attendee-watch-order-parity`  
**Overall product status:** **未通过**  
**Live:** https://159.75.71.192:18444/  
**UI:** https://159.75.71.192:18444/travelers · https://159.75.71.192:18444/grabs · https://159.75.71.192:18444/orders/{id}

## What this round delivers

1. Show watches accept `travelerIds` with the same ownership / authorized-consent / count rules as train (`quantity` ↔ traveler count)
2. Explicit `POST /api/grabs/:id/create-order` works for **channel=show** when shortlist/session item available (or `selectedShortlistItemId`) → **draft only**
3. Show submit path stays assistive / official-handoff: when `BOOKING_STUB≠1`, `POST /orders/:id/submit` returns **403** `SHOW_AUTO_BUY_UNAVAILABLE` — **never** marks paid from fixtures; no Damai/Maoyan reverse-auth
4. UI: `/travelers` title **出行人 / 观演人**; `/grabs` + TimedGrabPanel show button **「用已选观演人创建草稿订单」**; nextSteps list official Damai/Maoyan pay as **待用户登录官方**
5. Smoke: `apps/api/src/show-attendee-watch-order.smoke.test.ts`

**No** Damai captcha bypass, no real Damai/Maoyan purchase, no enabling `TRAIN_REAL_SUBMIT`, no overall PASS claim, no commerce :80/:443 touch.

## Formal channel conditions (honest — 待用户)

| Step | Status |
|------|--------|
| Bind 观演人 | PASS — same traveler archive + consent |
| Watch + create draft | PASS — explicit user action |
| Login | Assistive Damai/Maoyan path; **待用户登录官方** |
| Captcha / risk control | Manual / official; **不自动打码** |
| Auto-buy API | **未接入** → `SHOW_AUTO_BUY_UNAVAILABLE` when not stub |
| Pay | Official Damai/Maoyan cashier; **待用户登录官方** complete payment |
| Fake paid from fixtures | **Forbidden** |

Train real submit: live **TRAIN_REAL_SUBMIT=0** (unchanged).

## Acceptance checklist

| # | Criterion | Expected |
|---|-----------|----------|
| 1 | 2 attendees (self + authorized) → show watch with travelerIds | PASS |
| 2 | quantity≠travelerIds length → 400 | PASS |
| 3 | `POST /grabs/:id/create-order` → draft, 2 pax hints, show nextSteps | PASS |
| 4 | Idempotent reuse for same watch+item | PASS |
| 5 | Submit → 403 `SHOW_AUTO_BUY_UNAVAILABLE`; status not paid | PASS |
| 6 | Watch without travelerIds → 400 `TRAVELER_IDS_REQUIRED` (观演人) | PASS |
| 7 | UI travelers title flexible; grabs show draft button | PASS |
| 8 | Live `TRAIN_REAL_SUBMIT=0`; no commerce 80/443 | PASS |
| 9 | Overall unattended real purchase ready | **FAIL — 未通过** |

## API sketch (fake IDs only)

```bash
BASE=https://159.75.71.192:18444/api
# register → 2 travelers (authorizedConsent) → show request quantity=2 → search → watch travelerIds
# POST /grabs/$WATCH_ID/create-order
# → 201 {"orderId":"...","status":"draft","channel":"show","travelerIds":["A","B"],"showAutoBuy":false,"nextSteps":[...待用户登录官方...]}
# POST /orders/$OID/submit → 403 SHOW_AUTO_BUY_UNAVAILABLE (when BOOKING_STUB=0)
curl -sS "$BASE/health" | jq '{trainRealSubmit,bookingStub,providerMode}'
```

## Commit SHAs

- Private: `0ea10fc58529c67e85855257ad5f9fc9197ef65f`
- Public demo: `5de4d67b04c39486d78c1fa6060957d3af87814b` — https://github.com/rong001/ticket-grab-cloud-demo/commit/5de4d67b04c39486d78c1fa6060957d3af87814b

## Live evidence

- `GET /api/health` → `ok=true`, `trainRealSubmit=false`, `bookingStub=false`, `providerMode=live`
- Host `.env.production` still `TRAIN_REAL_SUBMIT=0`
- UI HTTP 200: `/`, `/grabs`, `/travelers` (title 出行人/观演人)
- Synthetic register (emailFp `4625363be0db`) → 2 travelers (hints `****4018` / `****1237`; no full ID)
- Show request quantity=2 → search (4 items) → watch with 2 travelerIds
- `POST /grabs/:id/create-order` → **201** draft, channel=show, 2 traveler summaries, showAutoBuy=false, nextSteps include 待用户登录官方
- Second create-order → same orderId, `reused=true`
- `POST /orders/:id/submit` → **403** `SHOW_AUTO_BUY_UNAVAILABLE`, status remains `draft` (not paid)
- Commerce :80/:443 untouched

## Remaining main blocker

**Real Damai/Maoyan purchase still requires user login on the official platform + captcha/risk control + official payment.** This round only closes show 观演人 bind → draft-order parity with train; auto-buy API remains unavailable.

## Overall: **未通过**
