# INTAKE P1e FIX — multi-turn「不限」field scope + preference override

## Root cause
1. `extractIntakePatch` treated bare「不限」as both `timeWindow` **and** `cabin`/`seatClass`/`tier` when the utterance lacked the word「时间」— because the seat/cabin unlimited branch used `/不限/` with only `!timeScopedUnlimited`.
2. Explicit later values (`经济舱` / `二等座` / `内场680`) used fill-once (`if (x && !current.x)`), so a wrongly stored「不限」could not be overridden.
3. Short-answer merge only filled keys extract left undefined, so it could not correct a polluted asked-field value.

## Fix summary
- Bare / free-form「不限」→ **timeWindow only** (never seat/cabin/tier). Scoped「舱位不限」「席别不限」「票档不限」set that field only.
- `applyShortAnswer` still allows bare「不限」for the **currently asked** field.
- Explicit extracted seat/cabin/tier **always override** prior values including「不限」.
- Asked-field short answer always wins in `processTurn` merge.
- Show channel never fills `timeWindow` from「不限」.
- Keep P1c:「时间不限」does not clobber seat.

## Live
https://159.75.71.192:18444

## Status
- P1e: COMPLETE (live PASS)
- P1d: 通过 (regression)
- 整体对话入单验收: 未通过（until user re-accepts）
