# Watch-tick acceptance (≥5 min) — ticket-grab-cloud

**Measured (UTC):** 2026-09-22T06:23:52Z → 2026-09-22T06:31:15Z  
**Live:** https://159.75.71.192:18444  
**API:** https://159.75.71.192:18444/api  
**Public repo:** https://github.com/rong001/ticket-grab-cloud-demo  

Synthetic accounts self-registered via `POST /api/auth/register`. Passwords **never** stored or printed. Tokens only fingerprinted.

## Labels (explicit)

| Item | Status |
|------|--------|
| **门禁 / submit-gate** | **通过** |
| **本 tick 项 (train)** | **pass** — live 12306 query + notify + cancel |
| **本 tick 项 (show)** | **pass** — live Dianping/Gewara myshow + notify + cancel |
| **本 tick 项 (flight)** | **partial** — tick/cancel machinery **pass**; OpenSky live query **FAIL** (`HTTP 404` → fixture fallback, `liveOk=false`, 0 items). Documented honestly — not faked. |
| **整体产品 / 端到端独立验收** | **待独立验收** — do **not** claim overall product PASS |

Capability boundary: **monitor + notify + official redirect / handoff only**. No 无人值守购票. `TRAIN_REAL_SUBMIT=0` confirmed on live health (`trainRealSubmit:false`).

---

## Interval field (documented)

| Layer | Field | Value used |
|-------|-------|------------|
| Prisma `WatchJob` | `intervalMinutes` (Int, default 15) | **5** |
| API `watchRequestSchema` | `intervalMinutes` (min 1, max 1440) | **5** |
| BullMQ | `repeat.every` = `intervalMinutes * 60_000` | **300000 ms** |
| Create body | `startsAt` ≈ now − 5s → `delayMs=0` → enqueue `watch-immediate` for first tick ASAP; `nextRunAt` after tick = now + 5m | |

Code path: `POST /api/requests/:id/watch` → worker `processWatchJob` updates `lastRunAt` / `nextRunAt`.

---

## Per-channel timeline

Machine-readable: [`WATCH_TICK_TIMELINE.json`](./WATCH_TICK_TIMELINE.json)

| Channel | Email (throwaway) | requestId | watchJobId | lastRunAt (UTC) | nextRunAt (UTC) | status after tick | provider / liveOk / items | tick event | cancel |
|---------|-------------------|-----------|------------|-----------------|-----------------|-------------------|---------------------------|------------|--------|
| train | `watchtick_train_1790058236953_4cf1@example.com` | `cmucagg0f0017hbi85n1f3ywt` | `cmucagg6r001bhbi8q1v17i1n` | 06:23:58.546Z | 06:28:58.546Z | `notified` | **train12306 / live / 40** | `tickets_found` | `cancelled` @ 06:24:01Z |
| show | `watchtick_show_1790058288385_8213@example.com` | `cmucahjp8001qhbi8p7l0cb5d` | `cmucahjvu001uhbi8zx08234f` | 06:24:49.917Z | 06:29:49.917Z | `notified` | **show (Dianping/Gewara) / live / 4** | `tickets_found` | `cancelled` @ 06:24:51Z |
| flight | `watchtick_flight_1790058337792_c0cf@example.com` | `cmucaimaa0029hbi80w94agnp` | `cmucaimgk002dhbi8ot05qvrp` | 06:25:40.964Z | 06:30:40.964Z | `queued` (no seats) | **flight fixture / liveOk=false / 0** — notes: `opensky: HTTP 404` | `watch_alert` | `cancelled` @ 06:25:55Z |

List (`GET /api/grabs`) and detail (`GET /api/requests/:id` → `watchJobs[]`) agreed on `status` / `lastRunAt` / `nextRunAt` / `statusReason` after tick for all three.

### StatusReason samples

- train/show after tick: `Notification recorded (email skipped/failed)` (SMTP 阻塞 — see below)
- flight after tick: `No actionable change; waiting next interval`
- all after cancel: `Cancelled by user`

---

## Worker proof (redacted)

Excerpts: [`docs/WATCH_TICK_WORKER_EXCERPTS.txt`](./docs/WATCH_TICK_WORKER_EXCERPTS.txt)

Each channel shows `Processing watch-immediate <jobId>-immediate` → `Completed …` with matching `watchJobId` / `requestId`.

ShortlistSnapshot rows (Postgres, acceptance window):

```text
requestId                  provider     mode     liveOk  items  notes
cmucagg0f0017hbi85n1f3ywt  train12306   live     t       40     Live data from train12306.
cmucahjp8001qhbi8p7l0cb5d  show         live     t       4      Live sessions from Dianping/Gewara myshow …
cmucaimaa0029hbi80w94agnp  flight       fixture  f       0      实时源暂不可用：opensky: HTTP 404
```

NotificationEvent titles (in-app; `emailed=false` due to SMTP):

- train: `发现可购票！改进 14 / 新增 40` + body mentions `train12306` / `数据源：实时`
- show: `开售/有票提醒！改进 1 / 新增 4` + Dianping/Gewara myshow notes
- flight: `盯票更新：改进 0 / 新增 0` + `opensky: HTTP 404` / fixture fallback

---

## Pause / cancel proof

There is **no separate pause API** in this build; **cancel** is the lifecycle stop (`POST /api/requests/:id/watch/:jobId/cancel`).

| Proof | Result |
|-------|--------|
| Immediate cancel → `status=cancelled`, `statusReason=Cancelled by user` | **PASS** (all 3) |
| `watch_cancelled` NotificationEvent | **PASS** |
| Second observation (~45s) `lastRunAt` unchanged | **PASS** |
| Full ≥5m `nextRunAt` window observe @ **06:31:15Z** — `lastRunAt` / `updatedAt` still frozen | **PASS** (product: no further ticks) |
| BullMQ repeatable absence **at test time** | **FAIL / partial** — cancel matcher only checked `r.id` / `key.includes(cuid)`; BullMQ keys are content hashes, so orphan `every=300000` repeats remained and worker still **dequeued** them. Processor early-returns on `cancelled` → **no** `lastRunAt` update / no upstream re-query. |
| Operator cleanup of the 3 orphan hashes + **cancel matcher fix** deployed to live API | Done after measurement (see timeline JSON). Retests should see BullMQ absence. |

---

## Capability limits (honest)

| Channel | What works | What this is NOT |
|---------|------------|------------------|
| **train** | 12306 **public left-ticket** query (`kyfw.12306.cn`); watch + notify | Not authorized reseller; **no** unattended seat-hold/pay; `TRAIN_REAL_SUBMIT` must stay **0** |
| **show** | Dianping/Gewara **myshow public** sessions/tickets | **Not** Damai auth buy / queue bypass / captcha bypass |
| **flight** | OpenSky (ADS-B departures) / other OTAs when configured; redirect | **No fares** from OpenSky; OTA redirect only — this run: OpenSky **404** |

---

## Email / SMTP — 阻塞

Live worker log during ticks:

```text
SMTP send failed Error: connect ECONNREFUSED 127.0.0.1:587
```

- In-app `NotificationEvent` **did** record (`emailed=false`).
- Outbound email is **阻塞** until a reachable SMTP is configured.
- Safe deployable template (placeholders only): [`SMTP_TEMPLATE.env.example`](./SMTP_TEMPLATE.env.example)

---

## Publicly retestable steps (no `curl -k`)

```bash
# 1) Self-register in UI or API
#    https://159.75.71.192:18444/register

export API_BASE=https://159.75.71.192:18444/api
export EMAIL="watchtick_you_$(date +%s)@example.com"
export PASSWORD='Choose_Your_Own_Strong_Pass1!'
export CHANNEL=train   # or show | flight
export INTERVAL_MIN=5
bash WATCH_TICK_COMMANDS.sh
```

TLS uses the live Let's Encrypt cert with IP SAN — stock CA verification (no `-k`).

Also: `GET /api/health`, `GET /api/meta/data-sources`.

---

## Related

- Closed-loop create/restart/cancel (far-future startsAt): [`TOC_E2E_ACCEPTANCE.md`](./TOC_E2E_ACCEPTANCE.md)
- Submit-gate / real submit audit: [`REAL_TRAIN_SUBMIT_AUDIT.md`](./REAL_TRAIN_SUBMIT_AUDIT.md) — gate remains **通过**; do not enable real submit for this demo.
