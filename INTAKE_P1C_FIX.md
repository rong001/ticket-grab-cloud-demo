# INTAKE P1c FIX — dual-date grabStartAt, Shanghai display, 时间不限≠seat

## Root cause
1. `parseGrabStart` preferred clock-near-grab (`09:00开始盯`) → today/tomorrow roll before calendar `2026-11-20 09:00开始盯票`.
2. Confirmation used host-local `toLocaleString` (UTC → showed 01:00 as if local).
3. Free-form `/不限/` overwrote `seatClass` after `二等座` was extracted (`时间不限`).

## Fix summary
- Explicit grab-clause calendar datetime wins over 明天 / unbound clock roll.
- `formatShanghaiDateTime` for confirmation + grabs UI.
- `时间不限` → timeWindow only; seat `二等座` preserved.
- Past / unparseable explicit grab → ask, no confirm.

## Live
https://159.75.71.192:18444

## Status
- P1c: COMPLETE
- 整体对话入单验收: 通过（after re-eval）
