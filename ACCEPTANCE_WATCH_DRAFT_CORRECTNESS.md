# ACCEPTANCE — Watch→draft correctness v2 + CORS/range gaps

**Deliverable:** `acceptance-gaps-cors-noise-range`  
**Overall product status:** **未通过**  
**Live:** https://159.75.71.192:18444/  
**UI:** https://159.75.71.192:18444/grabs · https://159.75.71.192:18444/orders/{id}

## What this round delivers

1. **CORS single matching Origin:** `CORS_ORIGIN` parsed as comma-separated allowlist; `@fastify/cors` origin callback returns **only** the request Origin when allowlisted (never the raw comma-joined string). credentials: true. No `*`.
2. **>20 noise same itemId:** smoke seeds noise with same `userId`/`requestId`/`selectedShortlistItemId`, different watch/traveler fingerprints; asserts reuse + target fingerprint count = 1.
3. **Train range numeric:** `G1~G9` uses same letter prefix + **numeric** number-part compare (not lexicographic); G10/G100 rejected; price ranges stay numeric.

**No** unlocking `TRAIN_REAL_SUBMIT`, real orders, charges, or commerce :80/:443. Screenshots deferred to parent computerUse on :18444 after CORS fix.

## Checklist

| # | Criterion | Result |
|---|-----------|--------|
| ① | CORS OPTIONS Origin 18444 → ACAO exactly that one URL (no comma) | **PASS** (unit + live curl) |
| ② | >20 same-itemId noise drafts → reuse original `orderId`; concurrent + cross-user kept | **PASS** (smoke) |
| ③ | Train range `G1~G9` vs G10/G100 → 400 `NO_MATCHING_SHORTLIST`; G5 still matches; price numeric | **PASS** (unit + smoke) |
| ④ | Real browser UI login → draft button → gate message + screenshots | **FAIL — UI未验收** (parent after CORS) |
| — | Live `TRAIN_REAL_SUBMIT=0`; commerce :80/:443 untouched | PASS (policy) |
| — | Overall unattended real purchase ready | **FAIL — 未通过** |

## Tests

```bash
cd apps/api && pnpm run test:watch-draft-correctness
# pickShortlistItem unit + cors-origin smoke + watch-draft-correctness smoke + web orderGate unit
```

Summary: `docs/ACCEPTANCE_WATCH_DRAFT_UI/TEST_OUTPUT_SUMMARY.txt`  
Last local run: **41 pass / 0 fail** (unit+smoke) + **4 pass** orderGate.

## Live CORS proof

```bash
curl -sSI -X OPTIONS 'https://159.75.71.192:18444/api/auth/register' \
  -H 'Origin: https://159.75.71.192:18444' \
  -H 'Access-Control-Request-Method: POST'
# Expect: access-control-allow-origin: https://159.75.71.192:18444
# (exactly one URL; no comma-joined allowlist)
```

Also verified Origin 18090 → single 18090; unknown Origin → no ACAO.

## Channel stop-at-acceptance

| Channel | 当前可用 | 尚缺接入 | 下一步持有人操作 |
|---------|----------|----------|------------------|
| train | 查票/盯票/草稿建单/门禁；prefs 精确 token + **车次范围数值比较**；指纹列原子复用；**CORS 单 Origin** | 真实 12306 协助提交（需会话+验证码/短信+`TRAIN_REAL_SUBMIT=1`）+ 官方支付；**浏览器 UI 验收未完成** | 用户绑定本人 12306；管理员显式开闸；支付仅官方收银台；父代理 computerUse 在 :18444 补 UI |
| show | 观演人绑定→草稿；提交 403；票档精确 + 数值区间 | 大麦/猫眼真实下单 API | 接入官方购票 API |
| flight | 乘机人绑定→草稿；提交 403 | 授权运价/库存 API | 配置运价密钥 |

## Commit SHAs

- Private (feat): `67dd78ff1a7bc78d439b53480718041c44582660` — https://github.com/rong001/ticket-grab-cloud/commit/67dd78ff1a7bc78d439b53480718041c44582660
- Public demo (feat): `690027c764a48f6b8bacf3be271d59f4a80d4c8b` — https://github.com/rong001/ticket-grab-cloud-demo/commit/690027c764a48f6b8bacf3be271d59f4a80d4c8b


## Live evidence (API)

- `GET /api/health` → `ok=true`, `trainRealSubmit=false`
- Host `.env.production` still `TRAIN_REAL_SUBMIT=0`; `CORS_ORIGIN` remains comma allowlist (now parsed correctly)
- Commerce :80/:443 untouched this round

## Overall: **未通过**
