# Far-future /api/grabs omission — fix & E2E evidence

Date: 2026-09-22 (UTC)  
Live base: `https://159.75.71.192:18444` (also `:18090`)

## Root cause

`GET /api/grabs` defaulted to `status IN ('active','pending')` only.  
Watch jobs with far-future `startsAt` are created as **`queued`** and stay queued until `startsAt`, so they were omitted from the default list (UI「进行中」).

## Fix summary

- Default live statuses: `queued`, `pending`, `active`, `running`, `notified` (still excludes `cancelled` / `completed` / `failed` unless `?status=all` or explicit status).
- List items always include `statusReason`, `statusChangedAt`, `startsAt`.
- Web `/grabs` treats `queued` as in-progress and shows startsAt / statusReason.
- Intake: city→station disambiguation; weekday-only date requires YYYY-MM-DD; show tier no longer confused with YYYY-MM-DD.

## E2E (HTTP)

Throwaway user: `farfuture_***@example.com` (token redacted `eyJh…iSd8`).

### 1. Create request + far-future watch (+30d)

- `POST /api/requests` → `201` id=`cmuc6dzes0006hks97qcjee9x`
- `POST /api/requests/cmuc6dzes0006hks97qcjee9x/watch` with `startsAt=2026-10-22T04:30:13.000Z` → `201`
  - id=`cmuc6e6tn000ghks9zk1ul3nb` status=`queued` statusReason=`Queued until startsAt` startsAt unchanged

### 2. List + detail

- `GET /api/grabs` → `200`, item found: status=`queued`, statusReason, statusChangedAt, startsAt present
- `GET /api/requests/cmuc6dzes0006hks97qcjee9x` → `200`, same job fields consistent

### 3. Restart worker + api

- `docker compose … restart worker api`
- Worker log: `[rehydrate] found 2 watch job(s) to restore`
- `GET /api/grabs` + detail → same id, status=`queued`, statusReason=`Rehydrated after worker restart`, startsAt unchanged

### 4. Cancel

- `POST /api/requests/cmuc6dzes0006hks97qcjee9x/watch/cmuc6e6tn000ghks9zk1ul3nb/cancel` → `200` status=`cancelled` statusReason=`Cancelled by user`
- Default `GET /api/grabs` omits cancelled; `GET /api/grabs?status=all` + detail show cancelled + reason

## Intake ambiguity (3 scenarios)

| # | Input | Result | Notes |
|---|-------|--------|-------|
| A | 下周北京到上海高铁，二等座 | **PASS** | Asks exact 出发站 (北京南/西…); no confirm/create |
| B | 周五晚上广州南到深圳北 | **PASS** | Asks exact YYYY-MM-DD; no confirm/create |
| C | 周杰伦演唱会上海 | **PASS** | Asks venue→date→票档→… one-by-one; confirm card only when complete; turn API never creates |

Capability copy remains monitor + official redirect (not unattended purchase).

## Live URLs

- App/API: https://159.75.71.192:18444/
- Alt TLS: https://159.75.71.192:18090/
- Do not use :80/:443 (a-commerce-os).

## Remaining gaps

- Rule-based intake still may mis-parse unusual phrasing.
- Show/flight remain monitor + official redirect only (by design).
