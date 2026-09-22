# ACCEPTANCE_INTAKE_P1D

## Status
**P1d (show eventName/tier field boundaries / labeled+natural single-shot): COMPLETE — live PASS**

**P1c: 通过** (regression live re-measured; dual-date grabStartAt / 时间不限 seat unchanged)

**整体对话入单验收: 未通过** — remains 未通过 until user re-accepts after P1d (do not auto-flip overall).

## Live
- https://159.75.71.192:18444/intake
- API: https://159.75.71.192:18444/api/intake/turn

## Root cause
1. **eventName over-swallow**: `extractEvent` stripped a few filler words then took the *entire remainder* (including 场馆/日期/票档/人数/盯票 blob) as `eventName`.
2. **tier swallow**: show tier regex used `票档\s*(\S+)`, so after `票档：` the `\S+` ate through `：内场680；人数：2；盯票开始：2026-11-20` until the space before `09:00`.
3. **No labeled show parser**: `演出：…；场馆：…` was never split on labels / fullwidth `：` `；` / ASCII `,` `:`.
4. **Natural venue**: `场馆XXX` without `在/于…中心` suffix was ignored → `missing=venue` even when venue was present.
5. **Bare channel keyword**: utterance `演出` alone could be stored as `eventName`, poisoning multi-turn.

## Fix
- Explicit **labeled show parse** for 演出/活动/演唱会名, 场馆/地点, 日期, 票档/票价档, 人数, 盯票开始/开售/开抢 — supports `：`/`:` and `；`/`;`/`,`/`，`.
- Field boundaries: stop values at next label or delimiter; eventName keeps `…演唱会` but never venue/date/tier/pax/grab text.
- Natural: `场馆XXX`, `内场680`, date glued before 演唱会, `2张` → passengers; grab clause priority unchanged (P1c).
- `isPollutedShowValue` + `sanitizeShowFields` + `buildConfirmationCard` refuse confirm/create when venue missing or eventName/tier still contain other labels.
- Reject channel-only tokens (`演出`/`演唱会`/…) as eventName.

## Capability note
Monitor + official 大麦/猫眼 redirect only; never auto-purchase.

## Regression table

| Case | Expected | Live/unit |
|------|----------|-----------|
| Labeled fullwidth `；` user sentence | clean fields, ready=true | **PASS** |
| Natural single-shot user sentence | clean fields, ready=true | **PASS** |
| Labeled ASCII `:` + `,` | clean fields, ready=true | **PASS** (unit) |
| Labeled fullwidth `，` | clean fields, ready=true | **PASS** (unit) |
| Missing venue | missing=venue, ready=false, no confirm | **PASS** (live+unit) |
| Polluted eventName blob | no confirm | **PASS** (unit) |
| Multi-turn show path | still reaches confirm | **PASS** (unit) |
| P1c train dual-date sentence | grab=2026-11-20T01:00:00.000Z, seat=二等座 | **PASS** (live) |

## Exact user sentences (live measured)

### 1) Labeled single shot — Request
```json
{
  "message": "演出：周杰伦演唱会；场馆：梅赛德斯-奔驰文化中心；日期：2026-12-31；票档：内场680；人数：2；盯票开始：2026-11-20 09:00"
}
```

### Response
```json
{
  "fields": {
    "channel": "show",
    "eventName": "周杰伦演唱会",
    "venue": "梅赛德斯-奔驰文化中心",
    "date": "2026-12-31",
    "tier": "内场680",
    "passengers": 2,
    "grabStartAt": "2026-11-20T01:00:00.000Z"
  },
  "missing": null,
  "readyForConfirm": true,
  "confirmation": {
    "lines": [
      {
        "label": "演出",
        "value": "周杰伦演唱会"
      },
      {
        "label": "场馆",
        "value": "梅赛德斯-奔驰文化中心"
      },
      {
        "label": "日期",
        "value": "2026-12-31"
      },
      {
        "label": "票档",
        "value": "内场680"
      },
      {
        "label": "人数",
        "value": "2"
      },
      {
        "label": "盯票开始",
        "value": "2026-11-20 09:00 +08:00"
      }
    ],
    "capabilityNote": "将创建「开售/有票监控」：定时检查公开场次信息并通知；有票后请跳转大麦/猫眼等官方平台完成购买。本系统不做自动抢购/代下单。"
  }
}
```

### 2) Natural single shot — Request
```json
{
  "message": "我要看2026-12-31周杰伦演唱会，场馆梅赛德斯-奔驰文化中心，内场680，2张，2026-11-20 09:00开始盯票"
}
```

### Response
```json
{
  "fields": {
    "channel": "show",
    "eventName": "周杰伦演唱会",
    "venue": "梅赛德斯-奔驰文化中心",
    "date": "2026-12-31",
    "tier": "内场680",
    "passengers": 2,
    "grabStartAt": "2026-11-20T01:00:00.000Z"
  },
  "missing": null,
  "readyForConfirm": true,
  "confirmation": {
    "lines": [
      {
        "label": "演出",
        "value": "周杰伦演唱会"
      },
      {
        "label": "场馆",
        "value": "梅赛德斯-奔驰文化中心"
      },
      {
        "label": "日期",
        "value": "2026-12-31"
      },
      {
        "label": "票档",
        "value": "内场680"
      },
      {
        "label": "人数",
        "value": "2"
      },
      {
        "label": "盯票开始",
        "value": "2026-11-20 09:00 +08:00"
      }
    ],
    "capabilityNote": "将创建「开售/有票监控」：定时检查公开场次信息并通知；有票后请跳转大麦/猫眼等官方平台完成购买。本系统不做自动抢购/代下单。"
  }
}
```

## Acceptance labels (explicit)
- **P1c: 通过**
- **P1d: 通过** (engineer live measure + unit tests; awaiting user re-accept for overall)
- **整体对话入单验收: 未通过**

## Commits
- Public demo: _(filled after push)_
- Private: _(filled after push)_
