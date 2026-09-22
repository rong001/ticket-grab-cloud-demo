# E2E Report — Ticket Grab Cloud

**Date:** 2026-09-21T06:04:31.670Z
**Env:** PROVIDER_MODE=live, BOOKING_STUB=0, TRAIN_BOOKING_DRY_RUN=0
**API:** http://localhost:3001  **Web:** http://localhost:3000

## Summary

| Journey | Result | Pass/Total |
|---------|--------|------------|
| auth | **PASS** | 4/4 |
| travelers | **PASS** | 3/3 |
| platform_bind | **PASS** | 8/8 |
| train | **PASS** | 8/8 |
| show | **PASS** | 7/7 |
| flight | **PASS** | 6/6 |
| watch | **PASS** | 3/3 |
| nav | **PASS** | 17/17 |

**Overall:** PASS — 56/56 checks

## Details

### auth

| Check | Result | Detail |
|-------|--------|--------|
| register | PASS | status=200 |
| login | PASS | status=200 |
| session_persist_/auth/me | PASS | status=200 email=e2e_full_1789970661998@test.local |
| logout | PASS | status=200 |

### travelers

| Check | Result | Detail |
|-------|--------|--------|
| create | PASS | id=cmuaubef700078szop58kuh8a |
| list | PASS | count=1 |
| delete | PASS | status=200 body={"ok":true,"id":"cmuaubefg00098szoaa3xxjyo"} |

### platform_bind

| Check | Result | Detail |
|-------|--------|--------|
| list | PASS | 12306,damai,maoyan,airline |
| link_start_damai | PASS | status=201 |
| link_complete_damai | PASS | status=200 body={"id":"cmuaubeft000b8szoxue3rphq","platform":"damai","sessionStatus":"linked","hasSessionBlob":true, |
| link_start_maoyan | PASS | status=201 |
| link_complete_maoyan | PASS | status=200 body={"id":"cmuaubeg4000f8szoxgkl89kk","platform":"maoyan","sessionStatus":"linked","hasSessionBlob":true |
| link_start_airline | PASS | status=201 |
| link_complete_airline | PASS | status=200 body={"id":"cmuaubegc000j8szonk0p9u4h","platform":"airline","sessionStatus":"linked","hasSessionBlob":tru |
| 12306_login_honest_no_creds | PASS | status=400 apiStatus=fail msg=核验方式不正确！ |

### train

| Check | Result | Detail |
|-------|--------|--------|
| create_request | PASS | id=cmuaubhgd000p8szomy5x0z6u |
| live_search | PASS | items=40 mode=live liveOk=true |
| shortlist_has_secretStr | PASS | sample meta keys=trainNo,fromTelecode,toTelecode,fromName,toName,date,duration,seatClass,seatToken,secretStr,source |
| create_order | PASS | order=cmuaubim2000v8szow95m62cs status=awaiting_login checkout=/checkout/cmuaubim2000v8szow95m62cs |
| checkout_page_loads | PASS | http=200 |
| submit_without_session_awaiting_login | PASS | status=awaiting_login err= |
| order_detail | PASS | status=awaiting_login events=2 |
| refresh_12306_status | PASS | status=200 orderStatus=awaiting_login notes=无会话，无法向 12306 刷新订单状态。 |

### show

| Check | Result | Detail |
|-------|--------|--------|
| create_request | PASS | id=cmuaubitl00138szodsgt3qca |
| live_or_fixture_search | PASS | items=1 mode=live liveOk=true |
| create_order | PASS | order=cmuaubjif00198szox74h4gmp status=draft checkout=/checkout/cmuaubjif00198szox74h4gmp |
| checkout_page_loads | PASS | http=200 |
| submit_with_linked_damai | PASS | status=awaiting_payment ext=HAND-SHOW-X74H4GMP |
| waitlist_path_候补中 | PASS | status=候补中 ext=HAND-SHOW-YWWEV1WV |
| order_status_detail | PASS | status=awaiting_payment |

### flight

| Check | Result | Detail |
|-------|--------|--------|
| create_request | PASS | id=cmuaubjku001l8szov18bw962 |
| search_live_fail_fixture_ok | PASS | items=3 mode=fixture liveOk=false notes=LIVE FAILED — fell back to fixture. Reason: No keyless public flight schedule API configured. Set FL |
| create_order | PASS | order=cmuaubjl5001r8szot0mh2n20 status=draft checkout=/checkout/cmuaubjl5001r8szot0mh2n20 |
| checkout_page_loads | PASS | http=200 |
| submit_with_linked_airline | PASS | status=awaiting_payment ext=HAND-FLT-T0MH2N20 |
| order_status_detail | PASS | status=awaiting_payment |

### watch

| Check | Result | Detail |
|-------|--------|--------|
| start | PASS | job=cmuaubjmn001x8szod3gwe3rr |
| notification_events_visible | PASS | types=watch_check,watch_started,order_12306_refresh,order_submitted,order_created,search_completed |
| request_detail_shows_events_ui_data | PASS | events=6 |

### nav

| Check | Result | Detail |
|-------|--------|--------|
| page / | PASS | http=200 |
| page /login | PASS | http=200 |
| page /register | PASS | http=200 |
| page /requests | PASS | http=200 |
| page /requests/new | PASS | http=200 |
| page /orders | PASS | http=200 |
| page /travelers | PASS | http=200 |
| page /accounts | PASS | http=200 |
| page /requests/cmuaubhgd000p8szomy5x0z6u | PASS | http=200 |
| page /orders/cmuaubim2000v8szow95m62cs | PASS | http=200 |
| page /checkout/cmuaubim2000v8szow95m62cs | PASS | http=200 |
| page /checkout/cmuaubjif00198szox74h4gmp | PASS | http=200 |
| page /checkout/cmuaubjl5001r8szot0mh2n20 | PASS | http=200 |
| page /accounts?platform=12306 | PASS | http=200 |
| page /accounts?platform=damai | PASS | http=200 |
| page /accounts?platform=maoyan | PASS | http=200 |
| page /accounts?platform=airline | PASS | http=200 |

## Remaining external blockers

| Blocker | Impact | Notes |
|---------|--------|-------|
| 12306 captcha / SMS / face | Train real submit | Login returns honest fail/challenge without real account; order stays `awaiting_login` until valid session |
| 12306 payment cashier | Train paid | After real submit → awaiting_payment; mark-paid only with live_session confirmation |
| Damai/Maoyan booking API | Show real platform order id | Assistive handoff (`HAND-SHOW-*`) when session linked; 候补 path works in-system |
| Airline/OTA booking API | Flight real order id | Assistive handoff (`HAND-FLT-*`) when session linked |
| Flight live schedule API | Live shortlist | Honest LIVE FAILED → fixture OK unless `FLIGHT_PUBLIC_API_URL` set |

## Notes

- Train secretStr present on live shortlist items for real submit path.
- Show/flight stub platform link remains usable under BOOKING_STUB=0 (assistive handoff, not silent fake paid).
- Watch NotificationEvents (`watch_started` / `watch_check` / `search_completed`) appear on request detail「通知」and order detail「通知」.
- No git push performed.
