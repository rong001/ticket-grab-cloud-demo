# ACCEPTANCE — Watch → Order draft

**Deliverable:** `watch-to-order-draft`  
**Overall product status:** **未通过**  
**Live:** https://159.75.71.192:18444/  
**UI:** https://159.75.71.192:18444/grabs · https://159.75.71.192:18444/orders/{id}

## What this round delivers

1. Explicit user action: `POST /api/grabs/:id/create-order` creates a **draft** Order from a WatchJob’s bound `travelerIds` + latest (or selected) shortlist item
2. Auth required; watch must belong to user; `travelerIds` non-empty and still valid
3. Idempotent: same watch + shortlist item → reuse existing draft / awaiting_login
4. Response: `orderId`, traveler summaries (hints only), `nextSteps` pointing to order page + gate conditions
5. Web: on `/grabs` and request TimedGrabPanel, train jobs with travelers show「用已选乘客创建草稿订单」→ navigate `/orders/{id}`
6. `has_tickets` notify payload includes **deep-link hint only** (no auto-create surprise drafts)
7. Submit of that draft still **403** `TRAIN_REAL_SUBMIT_DISABLED` when gate off — no live 12306 confirm/charge

**No** enabling `TRAIN_REAL_SUBMIT` on live, auto-submit/pay, captcha bypass, or overall PASS claim.

## Formal channel conditions (honest — 待用户)

| Step | Status |
|------|--------|
| Login | Assistive 12306 login path exists; **待用户** account + captcha/SMS |
| Captcha / SMS | Manual in-product; **不自动打码** |
| Gate `TRAIN_REAL_SUBMIT` | Live **=0**; admin must set `=1` to allow assistive submit |
| Pay | Official 12306 cashier handoff only; **待用户** complete payment |
| Real seat-hold / charge | **Blocked** while gate off |

Flight inventory / show auto-buy: **待接入** — out of scope.

## Acceptance checklist

| # | Criterion | Expected |
|---|-----------|----------|
| 1 | Create watch with 2 travelerIds + fixture shortlist | PASS |
| 2 | `POST /grabs/:id/create-order` → draft with 2 pax (hints only) | PASS |
| 3 | Second call reuses same draft (idempotent) | PASS |
| 4 | Submit → 403 `TRAIN_REAL_SUBMIT_DISABLED` + nextSteps; no 12306 network | PASS |
| 5 | Watch without travelerIds → 400 `TRAVELER_IDS_REQUIRED` | PASS |
| 6 | Health `trainRealSubmit=false` | PASS |
| 7 | Live deploy keeps `TRAIN_REAL_SUBMIT=0` | PASS (after deploy) |
| 8 | Overall unattended real purchase ready | **FAIL — 未通过** |

## API sketch (fake IDs only)

```bash
BASE=https://159.75.71.192:18444/api
# register → 2 travelers → request+search → watch with travelerIds
# POST /grabs/$WATCH_ID/create-order
# → 201 {"orderId":"...","status":"draft","travelerIds":["A","B"],"travelers":[{name,idNumberHint}],"nextSteps":[...],"orderPath":"/orders/..."}
# POST /orders/$OID/submit → 403 TRAIN_REAL_SUBMIT_DISABLED
curl -sS "$BASE/health" | jq '{trainRealSubmit,bookingStub,providerMode}'
```

## Commit SHAs

- Private: _(pending)_
- Public demo: _(pending)_

## Live evidence

_(filled after deploy)_

## Remaining main blocker

**Real 12306 submit still requires user-linked session + manual captcha/SMS + `TRAIN_REAL_SUBMIT=1` + official payment.** This round only closes watch→draft-order without surprise auto-create or live submit.

## Overall: **未通过**
