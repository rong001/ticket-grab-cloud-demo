# ACCEPTANCE — Train order assist gate loop

**Deliverable:** `train-order-assist-gate-loop`  
**Overall product status:** **未通过**  
**Live:** https://159.75.71.192:18444/  
**UI:** https://159.75.71.192:18444/orders/{id} · https://159.75.71.192:18444/accounts · https://159.75.71.192:18444/travelers

## What this round delivers

1. Multi-pax draft order: create with ≥2 `travelerIds` (synthetic checksum IDs in tests only)
2. `POST /orders/:id/submit` when `TRAIN_REAL_SUBMIT≠1` and `BOOKING_STUB≠1`:
   - **403** with stable `code: "TRAIN_REAL_SUBMIT_DISABLED"`
   - `trainRealSubmit: false`
   - `nextSteps[]` (login / captcha-SMS / enable gate / official pay)
   - Order stays **draft** or **awaiting_login** (never paid / 候补成功)
   - **No** live 12306 confirm / seat-hold / charge
3. When gate on but no linked session → `awaiting_login` + clear next steps
4. `GET /orders/:id` traveler summaries: name, hint, relationship — never full ID / enc
5. Web order page shows gate-off banner + nextSteps + links to `/accounts` and `/travelers`
6. Health: `trainRealSubmit=false` (live default)

**No** enabling `TRAIN_REAL_SUBMIT` on live, real credentials, captcha bypass, or overall PASS claim.

## Formal channel conditions (honest — 待用户)

| Step | Status |
|------|--------|
| Login | Assistive 12306 login path exists; **待用户** account + captcha/SMS |
| Captcha / SMS | Manual in-product; **不自动打码** |
| Gate `TRAIN_REAL_SUBMIT` | Live **=0**; admin must set `=1` to allow assistive submit |
| Pay | Official 12306 cashier handoff only; **待用户** complete payment |
| Real seat-hold / charge | **Blocked** while gate off — this deliverable proves honest refusal |

Flight inventory / show auto-buy: **待接入** — out of scope.

## Acceptance checklist

| # | Criterion | Expected |
|---|-----------|----------|
| 1 | Create 2 travelers (synthetic IDs) + train order with both travelerIds | PASS |
| 2 | Submit with gate off → 403 `TRAIN_REAL_SUBMIT_DISABLED` + nextSteps | PASS |
| 3 | Order status not paid / 候补成功; payload stores nextSteps + gate code | PASS |
| 4 | No 12306 confirm network call on gated path (fetch spy) | PASS |
| 5 | Gate on + no session → awaiting_login + login/captcha nextSteps | PASS |
| 6 | Order GET travelers: name/hint/relationship only | PASS |
| 7 | Health `trainRealSubmit=false` | PASS |
| 8 | Live deploy keeps `TRAIN_REAL_SUBMIT=0` | PASS |
| 9 | Overall unattended real purchase ready | **FAIL — 未通过** |

## API sketch (fake IDs only)

```bash
BASE=https://159.75.71.192:18444/api
# register → 2 travelers (110105199003074018 / 110101199001011237) → request+search
# POST /requests/$REQ/orders  {"selectedShortlistItemId":"...","travelerIds":["A","B"]}
# POST /orders/$OID/submit
# → 403 {"code":"TRAIN_REAL_SUBMIT_DISABLED","trainRealSubmit":false,"nextSteps":[...],"status":"awaiting_login"|"draft"}
curl -sS "$BASE/health" | jq '{trainRealSubmit,bookingStub,providerMode}'
```

## Commit SHAs

- Private: `6e3365734d97c0e95736075185f9974553e03195`
- Public demo: `74ef53c7ef3ade39d69f3c056ebdb34789dc791f` — https://github.com/rong001/ticket-grab-cloud-demo/commit/74ef53c7ef3ade39d69f3c056ebdb34789dc791f

## Live evidence

- `GET /api/health` → `trainRealSubmit=false`, `bookingStub=false`, `providerMode=live`
- Synthetic register → 2 travelers (hints `****4018` / `****1237`, relationships self/authorized; no full ID)
- Train request passengers=2 → search → create order with 2 travelerIds → status `awaiting_login`
- `POST /orders/:id/submit` → **403** `code=TRAIN_REAL_SUBMIT_DISABLED`, `trainRealSubmit=false`, `nextSteps` length 5, status remains `awaiting_login` (not paid)
- `GET /orders/:id` → gate payload + traveler summaries only
- UI HTTP 200: `/`, `/accounts`, `/travelers`, `/orders/{id}`
- Host `.env.production` still `TRAIN_REAL_SUBMIT=0`
- Commerce :80/:443 untouched

## Remaining main blocker

**Real 12306 submit still requires user-linked session + manual captcha/SMS + `TRAIN_REAL_SUBMIT=1` + official payment.** This round only makes the assistive path testable and honest when the gate is off.

## Overall: **未通过**
