# ACCEPTANCE — Intake confirm traveler select

**Deliverable:** `intake-confirm-traveler-select`  
**Overall product status:** **未通过**  
**Live:** https://159.75.71.192:18444/  
**UI:** https://159.75.71.192:18444/intake · https://159.75.71.192:18444/travelers · https://159.75.71.192:18444/grabs

## What this round delivers

1. Conversational `/intake` confirm card: logged-in users fetch `/travelers` and **multi-select** saved travelers (self / authorized-with-consent)
2. `POST /intake/confirm` accepts `travelerIds`: ownership + authorized consent + length vs conversational passengers; persists on `WatchJob.travelerIds`
3. Guest / unauthenticated: dialogue search stays public; confirm card CTA **「登录后选择出行人」** (no traveler bind without login; count-only watch after login if none selected)
4. Confirm card / success banner show **names + idNumberHint only** (no full ID)
5. Smoke: `apps/api/src/intake-confirm-traveler-select.smoke.test.ts` (7/7 pass)

**No** real submit, no fake inventory success, no overall PASS, no commerce :80/:443 touch. `TRAIN_REAL_SUBMIT=0`.

## Remaining unlocks (honest — need user-provided credentials)

Further closed-loop buy **cannot** be faked without:

| Dependency | Status |
|------------|--------|
| Platform sessions (12306 / Damai / airline-OTA) | **待用户提供官方登录** |
| SMTP for notify | **待配置** (template only) |
| Flight fare / inventory API (e.g. Amadeus) | **未接入** |
| `TRAIN_REAL_SUBMIT` + captcha/SMS | Gated **0**; **待用户账号+人工验证** |

No more fake closed-loop without the above.

## Acceptance checklist

| # | Criterion | Expected |
|---|-----------|----------|
| 1 | Logged-in confirm with 2 travelers → WatchJob has travelerIds; /grabs summaries redacted | PASS |
| 2 | travelerIds length ≠ passengers → 400 | PASS |
| 3 | Traveler belonging to another user → 400 | PASS |
| 4 | Authorized traveler without consent → 400 | PASS (smoke; DB edge) |
| 5 | GET /travelers / confirm payload never expose full idNumber | PASS |
| 6 | Guest `/intake/turn` works without auth; CTA「登录后选择出行人」 | PASS |
| 7 | Live `TRAIN_REAL_SUBMIT=0`; no commerce 80/443 | PASS |
| 8 | Overall unattended real purchase ready | **FAIL — 未通过** |

## API sketch (fake IDs / redacted)

```bash
BASE=https://159.75.71.192:18444/api
# register → 2 travelers (hints only) → POST /intake/turn (ready) →
# POST /intake/confirm {"sessionId","confirmed":true,"travelerIds":["…","…"]}
# → 201 watchJob.travelerIds length 2; travelers[].idNumberHint like ****4018
# mismatch / foreign id / no-consent → 400
curl -sS "$BASE/health" | jq '{ok,trainRealSubmit,bookingStub,providerMode}'
```

## Commit SHAs

- Private: `c7bbd037863a584c6f01c5a77eb2f80b514090b3` — https://github.com/rong001/ticket-grab-cloud/commit/c7bbd037863a584c6f01c5a77eb2f80b514090b3
- Public demo: `695f2a6286b8e02e2c1610e8840778fd26212182` — https://github.com/rong001/ticket-grab-cloud-demo/commit/695f2a6286b8e02e2c1610e8840778fd26212182

## Live evidence

- `GET /api/health` → `ok=true`, `trainRealSubmit=false`, `bookingStub=false`, `providerMode=live`, `flightInventoryLive=false`
- Host `.env.production` still `TRAIN_REAL_SUBMIT=0`, `BOOKING_STUB=0`
- UI HTTP 200: `/`, `/intake`, `/travelers`, `/grabs`
- CTA「登录后选择出行人」present in `/_next/static/chunks/app/intake/page-*.js`
- Synthetic register (emailFp `86569d6ce131`) → 2 travelers (hints `****4018` / `****1237`; no full ID)
- `/intake/turn` ready pax=2 → `POST /intake/confirm` with 2 travelerIds → **201**, travelerIdsLen=2, names 出行甲/出行乙, hints only
- `/grabs` contains bound watch with same hints; response has no full synthetic IDs
- mismatch (1 traveler vs 2 pax) → **400** `…数量（1）与人数（2）不一致`
- foreign traveler id → **400** `…不存在或不属于当前用户`
- Commerce :80/:443 listeners unchanged (a-commerce-os); ticket-grab remains 18090/18444 only for this stack rebuild

## Remaining main blocker

**Platform credentials / sessions + SMTP + fare API** for real buy. This round only closes ordinary-user intake confirm → traveler bind on WatchJob. Overall **未通过**.

## Overall: **未通过**
