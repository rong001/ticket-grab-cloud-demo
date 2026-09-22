# ACCEPTANCE_INTAKE_P1C

## Status
**P1c (dual-date grabStartAt / Asia/Shanghai display / 时间不限≠seat): COMPLETE**

**整体对话入单验收: 通过**（prior overall PASS from ACCEPTANCE_INTAKE_FULL was **retracted** until this fix; re-evaluated after live measure + E2E）

## Live
- https://159.75.71.192:18444/intake
- API: https://159.75.71.192:18444/api/intake/turn

## Root cause
1. **Dual-date / grabStartAt**: `parseGrabStart` matched clock glued to `开始盯票` (`09:00开始盯`) *before* calendar datetime, rolling to tomorrow Shanghai 09:00 → `2026-09-23T01:00:00Z` instead of `2026-11-20T01:00:00.000Z`. Chinese `11月20日9点开始盯票` had no calendar grab matcher.
2. **Timezone display**: confirmation used `toLocaleString("zh-CN")` without `timeZone: "Asia/Shanghai"`, so UTC hosts showed `2026/9/23 01:00:00` as if local.
3. **时间不限 → seat 不限**: free-form `/不限/` set `seatClass="不限"` even after `extractSeat` found `二等座`, because the check used `!current.seatClass` (not patch) and did not scope 不限 to 时间.

## Fix
- Grab-clause calendar datetime (`YYYY-MM-DD HH:MM` / `M月D日N点` + 开始盯票/开抢) has priority over `明天` and today/tomorrow clock-roll.
- `明天N点开始盯票` only when 明天 refers to grab and no explicit calendar grab datetime is bound.
- Unreliable / past explicit grab → clear, `missing=grabStartAt`, no confirm/create.
- `formatShanghaiDateTime` for confirmation card (+ grabs/TimedGrabPanel UI).
- `时间不限` → `timeWindow` only; concrete `二等座` wins over bare 不限 for seat.
- Show free-form: extract tier even when travel/show date is also present (single-shot).

## Capability note
Monitor + official redirect only; never auto-purchase.

## Commits
- Public demo: (fill after push)
- Private: (fill after push)

## Exact user sentence (live measured)

### Request
```json
{
  "message": "2026-12-15韶关东到虎门，时间不限，二等座，一张，2026-11-20 09:00开始盯票"
}
```

### Response (fields + confirmation)
```json
{
  "fields": {
    "channel": "train",
    "from": "韶关东",
    "to": "虎门",
    "date": "2026-12-15",
    "timeWindow": "不限",
    "seatClass": "二等座",
    "passengers": 1,
    "grabStartAt": "2026-11-20T01:00:00.000Z"
  },
  "missing": null,
  "readyForConfirm": true,
  "confirmation": {
    "lines": [
      {
        "label": "出发",
        "value": "韶关东"
      },
      {
        "label": "到达",
        "value": "虎门"
      },
      {
        "label": "日期",
        "value": "2026-12-15"
      },
      {
        "label": "时间段",
        "value": "不限"
      },
      {
        "label": "席别",
        "value": "二等座"
      },
      {
        "label": "人数",
        "value": "1"
      },
      {
        "label": "盯票开始",
        "value": "2026-11-20 09:00 +08:00"
      }
    ],
    "fields": {
      "channel": "train",
      "from": "韶关东",
      "to": "虎门",
      "date": "2026-12-15",
      "timeWindow": "不限",
      "seatClass": "二等座",
      "passengers": 1,
      "grabStartAt": "2026-11-20T01:00:00.000Z"
    }
  }
}
```

## Regression table (live)

| Case | Result | timeWindow | seatClass | grabStartAt | ready | display |
|------|--------|------------|-----------|-------------|-------|---------|
| P1c_exact | PASS | 不限 | 二等座 | 2026-11-20T01:00:00.000Z | true | 2026-11-20 09:00 +08:00 |
| P1c_md (11月20日9点) | PASS | 不限 | 二等座 | 2026-11-20T01:00:00.000Z | true | Shanghai 09:00 |
| P1c_tomorrow + travel | PASS | 不限 | 二等座 | tomorrow 09:00 Z | true | Shanghai |
| P1c_时间不限+二等座 | PASS | 不限 | 二等座 | set | true | — |
| P1c_ambiguous 尽快 | PASS | 不限 | 二等座 | none | false | — |
| P1c_past grab | PASS | 不限 | 二等座 | none | false | — |
| P1b window regress | PASS | 08:00-10:00 | 二等座 | none | false | — |

## E2E evidence
- `/workspace/e2e-p1c-evidence.json`, `/workspace/e2e-p1c-create.log`, `/workspace/e2e-p1c-recheck.log`
- Train: confirm→grabs list→restart→detail startsAt+preferredSeats match→cancel **PASS**
- Show + flight: confirm fields + persist + rehydrate + cancel **PASS**

## Overall
**整体对话入单验收: 通过**

未通过项: 无（required P1c + regressions + E2E passed after fix）
