# ACCEPTANCE — Concurrent grab management

**Deliverable:** `concurrent-grab-management`  
**Overall product status:** **未通过**  
**Live:** https://159.75.71.192:18444/  
**UI:** https://159.75.71.192:18444/grabs

## What this round delivers

1. User can create **≥2 active WatchJobs** concurrently (train + show + flight OK; different requests)
2. `GET /api/grabs` lists all with **channel**, **status**, **nextRunAt**, traveler summaries (if any), **dataSourceHint**, **repeatableArmed**, plus **quota** `{ maxActive: 10, activeCount, remaining }`
3. **Pause** one watch (`POST .../watch/:jobId/pause`) removes only that BullMQ repeatable; others stay armed
4. **Cancel** one clears only that repeatable (existing cancel proof patterns); others intact
5. **Resume** re-arms the paused watch only
6. Per-user soft limit **max 10** active (incl. paused) → clear **400** `ACTIVE_WATCH_LIMIT` (no new microservice)
7. Worker skips `paused` / `cancelled` / `completed`; payload scoped by `watchJobId` (no cross-talk)
8. UI `/grabs`: channel badge, data-source hint, pause/resume/cancel per row, quota + limit banner
9. Smoke: `apps/api/src/concurrent-grabs.smoke.test.ts` · Live script: `scripts/concurrent-grabs-e2e.mjs`

**No** enabling `TRAIN_REAL_SUBMIT` on live, real orders/charges, or overall PASS claim.

## Acceptance checklist

| # | Criterion | Expected |
|---|-----------|----------|
| 1 | Create 3 concurrent watches (train+show+flight) | PASS |
| 2 | List shows channel, status, nextRunAt, dataSourceHint, quota | PASS |
| 3 | Pause A → A `paused` + `repeatableArmed=false`; B still armed | PASS |
| 4 | Cancel A → only A cancelled/disarmed; B intact | PASS |
| 5 | Soft limit → 400 `ACTIVE_WATCH_LIMIT` with message | PASS |
| 6 | Worker ignores paused jobs; payload scoped by watch id | PASS |
| 7 | UI concurrent clarity + limit message | PASS |
| 8 | Live deploy keeps `TRAIN_REAL_SUBMIT=0` | PASS |
| 9 | Overall unattended real purchase ready | **FAIL — 未通过** |

## API sketch (fake IDs only)

```bash
BASE=https://159.75.71.192:18444/api
# register → 3 requests (train/show/flight) → 3 watches
# GET /grabs → items≥3, quota.maxActive=10
# POST /requests/$REQ_A/watch/$WATCH_A/pause → status=paused, repeatableArmed=false
# GET /grabs → B still repeatableArmed=true
# POST /requests/$REQ_A/watch/$WATCH_A/cancel → A cancelled; B intact
# 11th active watch → 400 ACTIVE_WATCH_LIMIT
curl -sS "$BASE/health" | jq '{trainRealSubmit,bookingStub,providerMode}'
```

## Commit SHAs

- Private: `(pending)`
- Public demo: `(pending)` — https://github.com/rong001/ticket-grab-cloud-demo/commit/(pending)

## Live evidence

_(filled after deploy)_

## Remaining main blocker

**Real 12306 submit still requires user-linked session + manual captcha/SMS + `TRAIN_REAL_SUBMIT=1` + official payment.** Concurrent task management does not unlock real submit.

## Overall: **未通过**
