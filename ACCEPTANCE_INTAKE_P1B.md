# ACCEPTANCE_INTAKE_P1B

Travel time window must NOT become `grabStartAt`.

## Capability note
Monitor + official redirect only; never auto-purchase.

## Required cases

| Case | Expected | Result |
|------|----------|--------|
| `9月29日北京南→上海虹桥，上午8点到10点，二等，两张票` | timeWindow set; grabStartAt missing; ready=false; confirmation=null; ask 开抢/盯票 | PASS |
| `上午8点到10点 (in multi-turn context)` | timeWindow only; not grabStartAt | PASS |
| `…两张 明天8点开抢` | grabStartAt set future (Asia/Shanghai) | PASS |
| `9月29日8点出发 北京南到上海虹桥 二等座 两张票` | not grabStartAt; ask 开抢时间 | PASS |
| `2026-09-29…08:00-10:00…两张 (bare window, no 开抢)` | must not invent grabStartAt | PASS |
| `…两张 → 现在` | grabStartAt ≈ now; ready=true | PASS |

**P1b acceptance status: COMPLETE — all required cases PASS (live measured)**

**Overall conversational intent-parsing product acceptance: NOT complete**

## Exact failing sentence (live)

### Request
```json
{
  "message": "9月29日北京南→上海虹桥，上午8点到10点，二等，两张票"
}
```

### Response (redacted — no secrets)
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

## Regression table

| Case | Kind | Result | timeWindow | grabStartAt | ready |
|------|------|--------|------------|-------------|-------|
| P1b_failing | pos | PASS | 08:00-10:00 | None | False |
| P1_exact | pos | PASS | 08:00-10:00 | None | False |
| P1b_window_alone | pos | PASS | 08:00-10:00 | None | False |
| P1b_tomorrow_grab | pos | PASS | 08:00-10:00 | 2026-09-23T00:00:00.000Z | True |
| P1b_depart | pos | PASS | 08:00 | None | False |
| P1b_now | pos | PASS | 08:00-10:00 | set≈now | True |


## Remaining gaps
- Multi-turn repair when user corrects grab-start after a bad prior turn is not deeply covered.
- Flight/show channels share the same grabStartAt rules but have thinner golden-path coverage.
- Station allowlist still curated (~182), not full 12306 index.
- Overall conversational intent-parsing (ambiguous cities, weekday dates, flight airports, show edge cases, UX polish) remains **NOT complete**.
