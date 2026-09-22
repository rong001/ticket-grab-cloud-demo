# INTAKE P1d FIX — show eventName/tier field boundaries

## Root cause
1. `extractEvent` over-swallowed venue/date/tier/pax/grab into `eventName`.
2. Tier regex `票档\S+` swallowed following labeled fields after fullwidth colon.
3. No labeled show parser for `演出：…；场馆：…`.
4. Natural `场馆XXX` ignored; bare `演出` could become eventName.

## Fix summary
- Labeled show field parser with bound labels + fullwidth/ASCII separators.
- Bounded natural eventName (`…演唱会`) + `场馆XXX` / `内场680` / `N张`.
- Pollution sanitize → refuse confirm when venue missing or fields polluted.
- Keep P1c grab-clause calendar priority.

## Live
https://159.75.71.192:18444

## Status
- P1d: COMPLETE (live PASS)
- P1c: 通过
- 整体对话入单验收: 未通过（until user re-accepts）
