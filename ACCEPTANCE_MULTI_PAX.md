# ACCEPTANCE — Multi-passenger / attendee bind (train-first)

**Deliverable:** `multi-pax-traveler-bind`  
**Overall product status:** **未通过**  
**Live:** https://159.75.71.192:18444/  
**UI:** https://159.75.71.192:18444/travelers · https://159.75.71.192:18444/intake · https://159.75.71.192:18444/grabs

## What this round delivers

1. Traveler authorization fields: `relationship` (`self`|`authorized`), `authorizedConsent`, `authorizedConsentAt`
2. Chinese ID validation: format + **GB11643 checksum** for 18-digit; passport/other soft checks
3. APIs never return full `idNumber` / `idNumberEnc` — only `idNumberHint`
4. `WatchJob.travelerIds` column; intake confirm + `/requests/:id/watch` accept optional `travelerIds`
5. `/grabs` and request detail return traveler **summaries** (id, name, idNumberHint, relationship)
6. Minimal UI: travelers form consent + multi-select on intake confirm / TimedGrabPanel

**No** real paid orders, captcha bypass, or fixture-as-purchase.

## Formal channel conditions (honest)

| Step | Train status |
|------|----------------|
| Login | Assistive 12306 login exists; needs user credentials + captcha/SMS; **do not automate past captcha** |
| Passenger auth | **This deliverable:** self/authorized consent + encrypted store |
| Query | Live public left-ticket OK |
| 候补/下单 | Code path gated by `TRAIN_REAL_SUBMIT=0`; **待用户账号+门禁开启+人工验证码** |
| Payment | Official handoff only; **待接入用户完成官方支付** |

Flight inventory / show auto-buy: **待接入** — out of scope this round.

## Acceptance checklist

| # | Criterion | Expected |
|---|-----------|----------|
| 1 | Create traveler `relationship=authorized` without consent → 400 | PASS |
| 2 | 18-digit ID with bad GB11643 checksum → 400 | PASS |
| 3 | Create 2 travelers with synthetic valid IDs; GET list shows hints only | PASS |
| 4 | With `ENCRYPTION_KEY`, stored `idNumberEnc` ≠ plaintext and ≠ `plain:` prefix | PASS |
| 5 | Create watch with `travelerIds` matching passengers count | PASS |
| 6 | Mismatch travelerIds length vs passengers → 400 | PASS |
| 7 | `/grabs` returns traveler summaries without full IDs | PASS |
| 8 | Health `trainRealSubmit=false` | PASS |
| 9 | No real 12306 submit / payment | PASS (gated) |
| 10 | Overall product ready for unattended buy | **FAIL — 未通过** |

## API examples (fake IDs only)

Synthetic checksum-valid test numbers (not real people):

- `110105199003074018`
- `110101199001011237`

```bash
# Login / register (synthetic)
TOKEN=$(curl -sS -X POST "$BASE/api/auth/register" \
  -H 'content-type: application/json' \
  -d '{"email":"multipax-demo@example.com","password":"password123","name":"MP"}' \
  | jq -r .token)

# Create self traveler
curl -sS -X POST "$BASE/api/travelers" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"测试甲","idType":"id_card","idNumber":"110105199003074018","relationship":"self"}'
# → { id, name, idNumberHint:"****4018", relationship:"self", ... }  (no idNumber)

# Authorized without consent → 400
curl -sS -X POST "$BASE/api/travelers" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"测试乙","idType":"id_card","idNumber":"110101199001011237","relationship":"authorized","authorizedConsent":false}'

# Authorized with consent
curl -sS -X POST "$BASE/api/travelers" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"测试乙","idType":"id_card","idNumber":"110101199001011237","relationship":"authorized","authorizedConsent":true}'

# Request + watch bind
REQ=$(curl -sS -X POST "$BASE/api/requests" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"channel":"train","fields":{"from":"北京南","to":"上海虹桥","date":"2026-10-01","passengers":2}}' \
  | jq -r .id)

curl -sS -X POST "$BASE/api/requests/$REQ/watch" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"intervalMinutes":15,"travelerIds":["<idA>","<idB>"]}'

curl -sS "$BASE/api/grabs?status=all" -H "authorization: Bearer $TOKEN"
# travelers[].idNumberHint only

curl -sS "$BASE/api/health" | jq '{trainRealSubmit,bookingStub}'
```

Intake confirm also accepts optional `travelerIds` in the same shape.


## Commit SHAs

- Private: `2b0897963780286e126fc1dfdec2f82c304e4646`
- Public demo: `e9ae3ed95c8dcf10d6cd7da861394ee40680b017` — https://github.com/rong001/ticket-grab-cloud-demo/commit/e9ae3ed95c8dcf10d6cd7da861394ee40680b017

## Live evidence (2026-09-22)

- `GET /api/health` → `trainRealSubmit=false`, `bookingStub=false`, `providerMode=live`
- Register synthetic user → POST `/travelers` ×2 (self + authorized with consent) → hints only (`****4018`, `****1237`); authorized without consent → **400**
- POST `/requests` train passengers=2 → POST `/watch` with two travelerIds → `status=queued`, traveler summaries bound
- GET `/grabs?status=all` → traveler hints only; full ID absent from JSON
- UI pages HTTP 200: `/travelers`, `/intake`, `/grabs`
- Commerce stack :80/:443 untouched
- Prisma migrate status: Database schema is up to date (6 migrations)

## Remaining main blocker (next round)

**12306 real submit still gated** (`TRAIN_REAL_SUBMIT=false`): even with bound travelers, placing a real order still requires user-linked session + manual captcha/SMS + gate enablement + official payment handoff. Multi-pax bind does **not** unlock unattended purchase.

## Overall: **未通过**
