# ACCEPTANCE_INTAKE_P1E

## Status
**P1e (flight/train/show multi-turn「不限」scope + preference override): COMPLETE — live PASS**

**P1d: 通过** (labeled show regression re-measured live)

**整体对话入单验收: 未通过** — remains 未通过 until user re-accepts after P1e (do not auto-flip overall).

## Live
- https://159.75.71.192:18444/intake
- API: https://159.75.71.192:18444/api/intake/turn
- Measured at: 2026-09-22T05:51:35.159Z
- Evidence: `p1e-live-measure.json` (pass=11 fail=0)

## Root cause
1. Free-form / short「不限」in `extractIntakePatch` set **both** `timeWindow` and `cabin`/`seatClass` (global `/不限/` seat/cabin branch when text lacked「时间」).
2. Explicit later `经济舱`/`二等座`/`内场680` used fill-once and could not override prior「不限」.
3. Confirmation/persist therefore showed cabin「不限」even after the user said「经济舱」.

## Fix
- Bare「不限」→ timeWindow only; scoped「舱位/席别/票档不限」→ that field only; short-answer binds only the asked field.
- Explicit seat/cabin/tier always override (including「不限」); asked-field short answer wins merge.
- Show: do not fill timeWindow from「不限」; tier override works.
- Persist via `toRequestPayload`: cabin「不限」stripped; final「经济舱」stored on request.fields.

## Capability note
Monitor + official redirect only; never auto-purchase.

## Regression table

| Case | Expected | Live |
|------|----------|------|
| Flight 7-step: step4 不限 only timeWindow | cabin unset, missing=cabin | **PASS** |
| Flight step5 经济舱 | cabin=经济舱 | **PASS** |
| Flight final confirm | cabin=经济舱, tw=不限, grab=2026-11-20T01:00:00.000Z, ready | **PASS** |
| Correction: cabin 不限 → 经济舱 | cabin=经济舱 | **PASS** |
| Train: 不限 then 二等座 | seatClass=二等座 | **PASS** |
| Show: tier 不限 then 内场680 | tier=内场680 | **PASS** |
| Negative: confirm cabin ≠ 不限 when 经济舱 given | cabin line 经济舱 | **PASS** |
| E2E confirm→GET→cabin match→cancel | stored cabin=经济舱, cancelled | **PASS** |
| P1d labeled show regression | ready, clean fields | **PASS** |
| P1c 时间不限 + 二等座 (unit) | seat preserved | **PASS** |

## Exact flight 7-step (live JSON summaries)

```json
{
  "step": 1,
  "message": "机票",
  "missing": "from",
  "readyForConfirm": false
}
```

```json
{
  "step": 2,
  "message": "SZX到PVG",
  "missing": "date",
  "readyForConfirm": false
}
```

```json
{
  "step": 3,
  "message": "2026-12-10",
  "missing": "timeWindow",
  "readyForConfirm": false
}
```

```json
{
  "step": 4,
  "message": "不限",
  "timeWindow": "不限",
  "missing": "cabin",
  "readyForConfirm": false
}
```

```json
{
  "step": 5,
  "message": "经济舱",
  "timeWindow": "不限",
  "cabin": "经济舱",
  "missing": "passengers",
  "readyForConfirm": false
}
```

```json
{
  "step": 6,
  "message": "1人",
  "timeWindow": "不限",
  "cabin": "经济舱",
  "passengers": 1,
  "missing": "grabStartAt",
  "readyForConfirm": false
}
```

```json
{
  "step": 7,
  "message": "2026-11-20 09:00",
  "timeWindow": "不限",
  "cabin": "经济舱",
  "passengers": 1,
  "grabStartAt": "2026-11-20T01:00:00.000Z",
  "readyForConfirm": true,
  "confirmCabin": "经济舱",
  "confirmTw": "不限"
}
```

### Session
`sessionId=eb518cea-6a43-4048-883b-b1e86f079e3d`

## Train multi-turn (live)

```json
{
  "step": 1,
  "message": "火车",
  "missing": "from",
  "readyForConfirm": false
}
```

```json
{
  "step": 2,
  "message": "韶关东到虎门",
  "missing": "date",
  "readyForConfirm": false
}
```

```json
{
  "step": 3,
  "message": "2026-12-15",
  "missing": "timeWindow",
  "readyForConfirm": false
}
```

```json
{
  "step": 4,
  "message": "不限",
  "timeWindow": "不限",
  "missing": "seatClass",
  "readyForConfirm": false
}
```

```json
{
  "step": 5,
  "message": "二等座",
  "timeWindow": "不限",
  "seatClass": "二等座",
  "missing": "passengers",
  "readyForConfirm": false
}
```

```json
{
  "step": 6,
  "message": "1人",
  "timeWindow": "不限",
  "seatClass": "二等座",
  "passengers": 1,
  "missing": "grabStartAt",
  "readyForConfirm": false
}
```

```json
{
  "step": 7,
  "message": "2026-11-20 09:00",
  "timeWindow": "不限",
  "seatClass": "二等座",
  "passengers": 1,
  "grabStartAt": "2026-11-20T01:00:00.000Z",
  "readyForConfirm": true,
  "confirmSeat": "二等座",
  "confirmTw": "不限"
}
```

## Show tier override (live)

```json
{
  "step": 1,
  "message": "演出",
  "missing": "eventName",
  "readyForConfirm": false
}
```

```json
{
  "step": 2,
  "message": "周杰伦演唱会",
  "missing": "venue",
  "readyForConfirm": false
}
```

```json
{
  "step": 3,
  "message": "梅赛德斯-奔驰文化中心",
  "missing": "date",
  "readyForConfirm": false
}
```

```json
{
  "step": 4,
  "message": "2026-12-31",
  "missing": "tier",
  "readyForConfirm": false
}
```

```json
{
  "step": 5,
  "message": "不限",
  "tier": "不限",
  "missing": "passengers",
  "readyForConfirm": false
}
```

```json
{
  "step": 6,
  "message": "内场680",
  "tier": "内场680",
  "missing": "passengers",
  "readyForConfirm": false
}
```

## E2E persist (redacted)
- confirm status 201, requestId `cmuc9b3d4000614bgqvnphcwe`
- request.fields.cabin = **经济舱** (not 不限)
- GET /grabs hit request.fields.cabin = **经济舱**
- cancel → status cancelled

## Labels
- **P1d**: 通过
- **P1e**: 通过 (this report)
- **整体对话入单验收**: 未通过
