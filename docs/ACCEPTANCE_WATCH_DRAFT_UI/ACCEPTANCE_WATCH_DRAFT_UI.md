# ACCEPTANCE — Watch draft UI (browser)

**Deliverable:** `watch-draft-correctness-v2` · Fix ③  
**Live:** https://159.75.71.192:18444/  
**Result:** **UI未验收**

## Required steps (not completed)

1. Open live site in box browser (real TLS navigation)
2. Login via login form (NOT token / localStorage injection; NOT curl-only)
3. Go travelers / intake or grabs → select travelers / open task
4. Create draft order via UI button（「用已选乘客创建草稿订单」）
5. Confirm UI shows draft / not real submit / train gate message (`TRAIN_REAL_SUBMIT_DISABLED` or equivalent)
6. Save desensitized screenshots under this folder

## Blocker (minimal)

**Executor subagent has no `Task` / `computerUse` tool in this run.**  
Box-desktop skill forbids Shell-driven Playwright/Puppeteer / CDP / xdotool as a substitute.  
Prior Toc screenshots that used `localStorage.setItem("tg_token", …)` explicitly **do not** count as UI pass per ticket.

Do **not** treat HTTP 200 on `/login` `/grabs` or API-only draft create as UI acceptance.

## When unblocked

Re-run with computerUse against a synthetic account (password never logged/committed). Expected screenshot set:

| File | Step |
|------|------|
| `01-login-form.png` | Login form (email field visible; no password in shot title/alt) |
| `02-after-login-grabs.png` | `/grabs` after form login |
| `03-draft-created.png` | After UI「创建草稿订单」— draft status visible |
| `04-order-gate.png` | Order page gate / not-real-submit message |

## Related API correctness (Fix ①②)

See root `ACCEPTANCE_WATCH_DRAFT_CORRECTNESS.md` (v2). Unit/smoke: `pnpm --filter @ticket-grab/api run test:watch-draft-correctness`.
