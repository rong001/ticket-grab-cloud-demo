# Read-only queue evidence (third-party / self-serve)

**Goal:** Prove cancel removes the BullMQ repeatable **without SSH, without printing secrets**.

## What anyone with their own account can verify

1. Register / login on the public demo (HTTPS).
2. Run [`CANCEL_REPEATABLE_SELFTEST.sh`](./CANCEL_REPEATABLE_SELFTEST.sh) with your own `EMAIL` / `PASSWORD`.
3. The script:
   - Creates a watch with `intervalMinutes=5`
   - Cancels it
   - Polls `GET /api/requests/:id` for **≥5 minutes**
4. Pass when:
   - `status=cancelled`
   - `lastRunAt` **unchanged** across the window (no further ticks)
   - `repeatableArmed=false` (API boolean — no Redis keys exposed)

Cancel response also returns `repeatableArmed` + `proofHint`.

`GET /api/grabs` (or watch list) includes `repeatableArmed` per live job for the owning user only.

## What third parties can see without operator access

| Evidence | Public? | Notes |
|----------|---------|-------|
| `/api/health` flight honesty flags | Yes | No secrets |
| `/api/meta/data-sources` | Yes | inventory vs schedule |
| Own watch `status` / `lastRunAt` / `repeatableArmed` | Yes (authed as owner) | Sufficient for cancel proof |
| Operator Redis `bull:watch-jobs:repeat` dump | **No** | Optional; requires host access |
| Worker container logs | **No** | Optional operator cross-check |

## Optional operator-only Redis (not required)

If you already have operator shell on the host:

```bash
# Read-only illustration — do not paste secrets into tickets
docker compose -f docker-compose.prod.yml exec -T redis \
  redis-cli --scan --pattern 'bull:watch-jobs:repeat*' | head
```

After cancel, the proof `watchJobId` must be **absent** from repeatable hash `data.watchJobId` fields.  
This mirrors the older `CANCEL_REPEATABLE_PROOF.md` timeline but is **not** needed for self-serve pass.

## Evidence boundary (important)

`CANCEL_REPEATABLE_SELFTEST.sh` proves **API self-report only**:
- watch `status=cancelled`
- `lastRunAt` freeze across the poll window
- `repeatableArmed=false` as returned by the API

It does **NOT** prove third-party Redis key absence or worker log absence. Those remain optional operator-only cross-checks (see above). Do not treat the selftest as a Redis/worker read.

## Labels

| Item | Status |
|------|--------|
| Self-serve cancel proof path | available (`CANCEL_REPEATABLE_SELFTEST.sh`) |
| Redis dump required for third parties | **no** |
| 门禁 / TRAIN_REAL_SUBMIT=0 | 通过 |
| 整体产品 | **未通过** |
