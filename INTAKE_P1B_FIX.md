# INTAKE P1b FIX — travel timeWindow must NOT become grabStartAt

## Root cause
`parseGrabStart()` greedily matched any `N点` / `HH:MM` in free-form utterances (when no `YYYY` present).
「上午8点到10点」 therefore set `grabStartAt` to today 08:00 (UTC) while also correctly filling `timeWindow`.
Confirmation cards were emitted without an explicit 开抢/盯票 start.

P1 docs incorrectly marked `P1_cn_date` as PASS with `ready=True`.

## Fix summary
- Free-form extract: set `grabStartAt` **only** with explicit grab intent (`开抢`/`盯票`/`开始抢`/… or bare `现在`/`立刻`/`马上`/`立即`).
- Travel ranges (`上午8点到10点`, `08:00-10:00`) and `N点出发` → `timeWindow` only; never `grabStartAt`.
- Short-answer mode (assistant asked for grab-start) still accepts `现在` / clocks / datetimes.
- Times interpreted in **Asia/Shanghai**; stored as ISO Z; past values cleared → re-ask, no confirm.
- Relative grab phrasing: `明天8点开抢` / `立刻开抢` / `现在`.
- Prefer grab-local matchers over binding travel `YYYY-MM-DD HH:MM` window starts.

## Capability note
Monitor + official redirect only; never auto-purchase.

## Commits
(filled after push)

## Deploy
- Rebuilt & restarted `ticket-grab-cloud` api+worker on 159.75.71.192; a-commerce-os / :80 / :443 untouched.
- Live: https://159.75.71.192:18444

## Summary
- All required P1b cases: **PASS**

| Case | Kind | Result | timeWindow | grabStartAt | ready |
|------|------|--------|------------|-------------|-------|
| P1b_failing | pos | PASS | 08:00-10:00 | None | False |
| P1_exact | pos | PASS | 08:00-10:00 | None | False |
| P1b_window_alone | pos | PASS | 08:00-10:00 | None | False |
| P1b_tomorrow_grab | pos | PASS | 08:00-10:00 | 2026-09-23T00:00:00.000Z | True |
| P1b_depart | pos | PASS | 08:00 | None | False |
| P1b_now | pos | PASS | 08:00-10:00 | set≈now | True |


## Exact failing sentence (measured)

### Request
```json
{
  "message": "9月29日北京南→上海虹桥，上午8点到10点，二等，两张票"
}
```
### Response
```json
{
  "sessionId": "5a597663-1abd-400a-bff2-b9a1ac6a4967",
  "fields": {
    "channel": "train",
    "from": "北京南",
    "to": "上海虹桥",
    "date": "2026-09-29",
    "timeWindow": "08:00-10:00",
    "seatClass": "二等座",
    "passengers": 2
  },
  "missing": "grabStartAt",
  "readyForConfirm": false,
  "confirmation": null,
  "reply": "何时开始盯票/抢票？（例如「现在」「今晚20:00」「2026-10-01 09:00」）。"
}
```

## Status
- **P1b acceptance (this bug): COMPLETE**
- **Overall conversational intent-parsing product acceptance: NOT complete**
