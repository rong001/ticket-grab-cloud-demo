# BullMQ cancel → removeRepeatable proof

**Measured (UTC):** 2026-09-22T06:46:49Z → 2026-09-22T06:53:02Z  
**Private SHA:** `26be33d81cd4db54515a987e0fd38e25f0f6c664`  
**Public demo SHA:** `33ab0025f0a96e65875b93a6b735f8900f4d3c96`  
**Live:** https://159.75.71.192:18444  
**Wait after cancel:** **330s** (≥ full next 5-minute window)  
**Machine timeline:** [`CANCEL_REPEATABLE_PROOF_TIMELINE.json`](./CANCEL_REPEATABLE_PROOF_TIMELINE.json)

Synthetic accounts self-registered via `POST /api/auth/register`. Passwords **never** stored or printed.

## Labels

| Item | Status |
|------|--------|
| **Cancel repeatable proof** | **pass** |
| **门禁 / TRAIN_REAL_SUBMIT=0** | **通过** (`trainRealSubmit:false`) |
| **Flight honesty** | **pass** (see FLIGHT_SOURCE_ROADMAP.md / WATCH_TICK_ACCEPTANCE) |
| **整体产品** | **未通过** — not an independent end-to-end product acceptance |

---

## What was fixed

BullMQ 5 stores repeatables under **MD5 content hashes**; `getRepeatableJobs()` does **not** return our cuid as `r.id`. Cancel now:

1. `removeRepeatable("watch", { every[, endDate] }, watchJobId)`
2. Match Redis hash `bull:watch-jobs:repeat:<key>` field `data.watchJobId`
3. `removeRepeatableByKey`
4. Sweep delayed/waiting/active jobs whose payload `watchJobId` matches

Code: `apps/api/src/lib/queue.ts` → `removeWatchRepeatable()` used by `POST /api/requests/:id/watch/:jobId/cancel`.

---

## New synthetic jobs (this proof)

| Channel | requestId | watchJobId | cancelAt (UTC) | observeAt | repeatableGone | process lines after cancel |
|---------|-----------|------------|----------------|-----------|----------------|----------------------------|
| train | `cmucb9vv50018wr35w1bmq85m` | `cmucb9wdp001cwr35km94kz25` | 06:47:04.113Z | 06:52:43.718Z | **yes** | **0** |
| show | `cmucb9z6j001lwr353kxjfrmo` | `cmucb9zpe001pwr35mca2z0x9` | 06:47:04.113Z | 06:52:43.718Z | **yes** | **0** |

DB after cancel: `status=cancelled`, `statusReason=Cancelled by user`.  
`lastRunAt` frozen at first immediate tick (before cancel) — no further updates across the window.

### Redis (redacted)

- **Before cancel:** hashes included proof jobs (`813d4d31…`, `c113f086…`) among others.
- **Immediately after cancel:** those two hashes **gone**.
- **After 330s:** proof `watchJobId`s still **absent** from `bull:watch-jobs:repeat` zset / hash `data`.

Unrelated pre-existing orphans (other cancelled jobs / empty hashes) were operator-swept after measurement; they are **not** the proof subjects.

### Worker logs

```text
# since 2026-09-22T06:47:10Z (after cancel)
grep watchJobId → ZERO_AFTER_CANCEL
# No Processing / Completed for either proof id after cancel
# No upstream 12306 / Dianping / OpenSky lines tied to those ids after cancel
```

(Immediate `watch-immediate` ticks that ran **before** cancel are expected and do not count against the proof.)

---

## Pass criteria checklist

| Criterion | Result |
|-----------|--------|
| Repeatable key for watchJobId GONE after cancel | **PASS** |
| Worker does not dequeue that job again in ≥5m window | **PASS** (0 process lines) |
| No upstream HTTP for that job after cancel | **PASS** |
| SMTP still blocked / no creds | **阻塞** (unchanged) |

