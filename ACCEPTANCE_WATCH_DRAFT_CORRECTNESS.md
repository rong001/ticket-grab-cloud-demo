# ACCEPTANCE — Watch→draft correctness (prefs / concurrent / gate UI)

**Deliverable:** `watch-draft-correctness`  
**Overall product status:** **未通过**  
**Live:** https://159.75.71.192:18444/  
**UI:** https://159.75.71.192:18444/grabs · https://159.75.71.192:18444/orders/{id}

## What this round delivers

1. **Strict shortlist prefs:** `pickShortlistItem` no longer falls back to sold-out or to the pre-filter pool when preferredTrains/Seats/Tiers yield empty. Auto-pick uses **available/limited only**. Miss → **400** `NO_MATCHING_SHORTLIST`（无符合项，须用户重新选择）; no order created.
2. **Concurrent create-order idempotency:** same `(user, watchId, selectedShortlistItemId, travelerIds-set)` → single draft via Postgres `pg_advisory_xact_lock` + find-or-create. Parallel POSTs return the same `orderId` (`reused=true` for losers). Different user / different watch must not share that draft.
3. **Order page 403:** purchase-gate UI only for explicit codes (`TRAIN_REAL_SUBMIT_DISABLED`, `SHOW_AUTO_BUY_UNAVAILABLE`, `FLIGHT_INVENTORY_UNAVAILABLE`, `FLIGHT_AUTO_BUY_UNAVAILABLE`). Generic 403 → normal permission error. Flight `load` keeps **actual** `gateCode` (no longer hardcoded as `SHOW_AUTO_BUY_UNAVAILABLE`).

**No** unlocking `TRAIN_REAL_SUBMIT`, real orders, charges, new channel features, or overall PASS.

## Tests

```bash
cd apps/api && pnpm run test:watch-draft-correctness
# = pickShortlistItem unit + watch-draft-correctness smoke + web orderGate unit
```

## Acceptance checklist

| # | Criterion | Expected |
|---|-----------|----------|
| 1 | preferred train/seat/tier no match → 400 `NO_MATCHING_SHORTLIST`, no order | PASS |
| 2 | sold-out-only pool → 400, no silent success pick | PASS |
| 3 | Promise.all concurrent create-order → DB exactly 1 draft; same orderId | PASS |
| 4 | Different watch / different user → distinct drafts | PASS |
| 5 | orderGate: flight code not collapsed to SHOW; generic 403 ≠ gate | PASS |
| 6 | Live `TRAIN_REAL_SUBMIT=0`; commerce :80/:443 untouched | PASS |
| 7 | Overall unattended real purchase ready | **FAIL — 未通过** |

## Commit SHAs

- Private: `2247f07c6495c84cb23a5046cf8834b24740d441` (docs tip `618a5d937fc35addaa052abe24ab36b1919d65f2`)
- Public demo: `22cbe7a7b1b1458d7825068490bd485f2b1056b1` — https://github.com/rong001/ticket-grab-cloud-demo/commit/22cbe7a7b1b1458d7825068490bd485f2b1056b1  
  (docs tip `f98f4b4be73bbc9c4c0dfdbc6217e772e1e0d49d` — https://github.com/rong001/ticket-grab-cloud-demo/commit/f98f4b4be73bbc9c4c0dfdbc6217e772e1e0d49d)

## Live evidence

- `GET /api/health` → `ok=true`, `trainRealSubmit=false`, `bookingStub=false`, `providerMode=live`, `flightInventoryLive=false`
- Host `.env.production` still `TRAIN_REAL_SUBMIT=0`
- Synthetic register (emailFp `da0b9991b703`) → 2 travelers (hints `****4018` / `****1237`)
- Watch with `preferredTrains=["Z9999NOMATCH"]` → `POST /grabs/:id/create-order` → **400** `NO_MATCHING_SHORTLIST`（无符合项，须用户重新选择）; no order created
- Parallel create-order (3×) on matching watch → **unique_order_ids=1**; responses `(201,reused=false)` + `(200,reused=true)` ×2
- Order detail: status `draft`, 2 travelers; submit → **403** `TRAIN_REAL_SUBMIT_DISABLED`; after refresh `errorMessage`/`gate.code` = `TRAIN_REAL_SUBMIT_DISABLED` (UI maps explicit code only)
- UI HTTP 200: `/`, `/grabs`, `/orders/{id}`, `/login`
- Commerce :443 HTTP 200 (untouched lineage)

## Channel stop-at-acceptance

| Channel | 当前可用 | 尚缺接入 | 下一步持有人操作 |
|---------|----------|----------|------------------|
| train | 查票/盯票/草稿建单/门禁拒绝提交；prefs 严格；并发草稿原子复用 | 真实 12306 协助提交（需会话+验证码/短信+`TRAIN_REAL_SUBMIT=1`）+ 官方支付 | 用户绑定本人 12306；管理员显式开闸后协助提交；支付仅官方收银台 |
| show | 观演人绑定→草稿；提交 403 `SHOW_AUTO_BUY_UNAVAILABLE` | 大麦/猫眼真实下单 API | 接入官方购票 API；用户登录官方完成支付 |
| flight | 乘机人绑定→草稿（scheduleOnly 仅参考）；提交 403 `FLIGHT_INVENTORY_UNAVAILABLE` | 授权运价/库存 API（Amadeus 等） | 配置运价密钥；勿把 OpenSky/Aviationstack 当可售 |

## Overall: **未通过**
