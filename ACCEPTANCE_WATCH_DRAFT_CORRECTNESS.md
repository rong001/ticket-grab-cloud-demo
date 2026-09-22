# ACCEPTANCE — Watch→draft correctness v2 (exact prefs / fingerprint / UI)

**Deliverable:** `watch-draft-correctness-v2`  
**Overall product status:** **未通过**  
**Live:** https://159.75.71.192:18444/  
**UI:** https://159.75.71.192:18444/grabs · https://159.75.71.192:18444/orders/{id}

## What this round delivers

1. **Exact-token prefs (`pickShortlistItem`):** normalize structured `trainNo` / `seatClass` / `tier`, then **whole-token / field equality** — not arbitrary `includes`. Missing structured fields cannot match via title/subtitle substring (blocks **G1⊂G10/G100**, **380⊂1380**). Fuzzy/range **only** when the preference string itself is explicit glob/range (`*`,`?`,`280-580`,`G1~G9`) — documented in code + tests.
2. **Fingerprint DB lookup:** `Order.draftFingerprint` column + unique index. Create-order locks then `findFirst` by `(userId, draftFingerprint)` — **not** `take:20` then in-memory filter. Legacy rows without column: match payload / watch+travelers and backfill.
3. **Browser UI acceptance:** required; this run → **UI未验收** (see `docs/ACCEPTANCE_WATCH_DRAFT_UI/`).

**No** unlocking `TRAIN_REAL_SUBMIT`, real orders, charges, or new channel features.

## Checklist

| # | Criterion | Result |
|---|-----------|--------|
| ① | Exact prefs; G1 vs G10/G100 and 380 vs 1380 → 400 `NO_MATCHING_SHORTLIST`, no draft; positives G10/380 still select | **PASS** (unit + smoke) |
| ② | >20 other fingerprint drafts → reuse original `orderId`; concurrent + cross-user/watch isolation kept | **PASS** (smoke) |
| ③ | Real browser UI login → draft button → gate message + screenshots | **FAIL — UI未验收** |
| — | Live `TRAIN_REAL_SUBMIT=0`; commerce :80/:443 untouched | PASS (policy) |
| — | Overall unattended real purchase ready | **FAIL — 未通过** |

## Tests

```bash
cd apps/api && pnpm run test:watch-draft-correctness
# pickShortlistItem unit + watch-draft-correctness smoke + web orderGate unit
```

Summary artifact: `docs/ACCEPTANCE_WATCH_DRAFT_UI/TEST_OUTPUT_SUMMARY.txt`  
Last local run: **29 pass / 0 fail** (unit+smoke) + **4 pass** orderGate.

## Channel stop-at-acceptance

| Channel | 当前可用 | 尚缺接入 | 下一步持有人操作 |
|---------|----------|----------|------------------|
| train | 查票/盯票/草稿建单/门禁拒绝提交；**prefs 精确 token**；**指纹列原子复用**（不受 take:20 窗口挤出） | 真实 12306 协助提交（需会话+验证码/短信+`TRAIN_REAL_SUBMIT=1`）+ 官方支付；**浏览器 UI 验收未完成** | 用户绑定本人 12306；管理员显式开闸后协助提交；支付仅官方收银台；补计算机用浏览器验收 |
| show | 观演人绑定→草稿；提交 403 `SHOW_AUTO_BUY_UNAVAILABLE`；票档精确 token（380≠1380） | 大麦/猫眼真实下单 API | 接入官方购票 API；用户登录官方完成支付 |
| flight | 乘机人绑定→草稿（scheduleOnly 仅参考）；提交 403 `FLIGHT_INVENTORY_UNAVAILABLE` | 授权运价/库存 API（Amadeus 等） | 配置运价密钥；勿把 OpenSky/Aviationstack 当可售 |

## Overall: **未通过**
