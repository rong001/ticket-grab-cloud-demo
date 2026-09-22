# Guest acceptance

## Local run (pre-redeploy)

- API: `http://127.0.0.1:3001` (process **not yet restarted** with new build)
- When: 2026-09-22

| Check | Result | Detail |
| --- | --- | --- |
| public_search_no_token | FAIL (expected until redeploy) | status=404 — route not in running binary |
| assert_no_login_required_for_public_search | PASS | 404 ≠ 401/403 |
| register_fresh_email | PASS | status=200 + token |
| login_after_register | PASS | status=200 + token |

After parent deploys/restarts API+web from this build, re-run:

```bash
API_BASE=http://127.0.0.1:3001 node scripts/guest-acceptance.mjs
# or prod:
API_BASE=https://YOUR_API_HOST node scripts/guest-acceptance.mjs
```

## Curl (prod verify — run after deploy)

```bash
API=https://YOUR_API_HOST   # or http://HOST:3001
DATE=$(date -u -d '+1 day' +%F 2>/dev/null || date -u -v+1d +%F)

# 1) Public search — must be 200, NOT 401
curl -sS -w '\nHTTP %{http_code}\n' -X POST "$API/public/search" \
  -H 'content-type: application/json' \
  -d "{\"channel\":\"train\",\"fields\":{\"from\":\"北京南\",\"to\":\"上海虹桥\",\"date\":\"$DATE\",\"passengers\":1}}"

# 2) Self-register
EMAIL="guest_$(date +%s)@example.com"
curl -sS -X POST "$API/auth/register" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"GuestPass123!\",\"name\":\"Guest\"}"

# 3) Login
curl -sS -X POST "$API/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"GuestPass123!\"}"
```

## UI guest flow (after web deploy)

1. Open `/` → honest copy (公开查票 / 支付走官方 / 非代售)
2. `/requests/new` as guest → fill 北京南 / 上海虹桥 / tomorrow → **查询**
3. Results render **on the same page** (no redirect to `/login`)
4. CTA「登录后盯票/下单」→ `/login?returnUrl=/requests/new`
5. `/register` → real form → token → can「创建需求并盯票」
