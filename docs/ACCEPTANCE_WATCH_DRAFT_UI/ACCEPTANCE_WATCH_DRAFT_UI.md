# ACCEPTANCE — Watch draft UI (browser)

**Deliverable:** `watch-draft-correctness-v2` · Fix ③  
**Result:** **UI PASS** on live frontend `https://159.75.71.192:18090/` (form login, no token injection)  
**Note:** Exact target `:18444` hit CORS on register (`Access-Control-Allow-Origin` duplicate preflight). Same API health on both ports: `trainRealSubmit=false`. Commerce :80/:443 untouched.

## Steps completed (synthetic account; password not recorded)

1. Open live site in box browser (real TLS navigation) — used `:18090` after `:18444` register CORS block
2. Register + login via normal forms (NOT token / localStorage injection; NOT curl-only)
3. `/travelers` — add 2 travelers; list shows masked hints only
4. Create train watch (深圳北→汕尾) → `/grabs` → UI「用已选乘客创建草稿订单」
5. `/orders/{id}` shows **draft**, 「未提交、未扣款」, gate requires enabling real submit (host still `TRAIN_REAL_SUBMIT=0` / health `trainRealSubmit=false`)
6. No real 12306 submit, no payment, no platform credentials

## Screenshots

| File | Step |
|------|------|
| `login_ok.png` | After form login |
| `travelers.png` | Travelers list (hints only) |
| `grabs_or_draft_btn.png` | Grabs + create-draft control |
| `order_draft_gate.png` | Draft order + not-submitted / gate copy |

## Related API correctness (Fix ①②)

Public feature: `383d1ff92954ac4c3a31db29bf51e31aa4a1636c`  
Unit/smoke: `pnpm run test:watch-draft-correctness` — see `TEST_OUTPUT_SUMMARY.txt`

**Overall product:** 未通过
