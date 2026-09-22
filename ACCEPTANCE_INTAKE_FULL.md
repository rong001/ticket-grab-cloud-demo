# ACCEPTANCE_INTAKE_FULL

Conversational intake acceptance across **train / show / flight**.

## Live
- https://159.75.71.192:18444/intake
- https://159.75.71.192:18444/capabilities
- API: https://159.75.71.192:18444/api （`/intake/turn` public；`/intake/confirm` 需登录）
- Alt TLS: :18090

## Capability (honest)
- Train: 监控盯票 + 通知（非无人值守自动购票）
- Show: 开售/有票监控 + 跳转 **大麦/猫眼** 官方（非自动抢购）
- Flight: 航班监控 + 跳转 **航司/OTA** 官方（非自动出票）

## Station index
- 3388 names from 12306 `station_name.js` (2026-09-22) in `packages/shared/src/intake/data/stations.json`
- Small stops verified live: 嘉兴南 / 虎门 / 韶关东 / 龙岩 → confirm OK
- Nonsense / date fragments → no confirm

## Channel matrix

| Channel | Multi-turn fields | E2E create→list→restart→cancel | Result |
|---------|-------------------|--------------------------------|--------|
| train | from/to/date/window/seat/pax/grabStart | PASS | PASS |
| show | event/venue/date/tier/pax/grabStart | PASS | PASS |
| flight | airports/date/window/cabin/pax/grabStart | PASS | PASS |

## Negatives
Missing fields / ambiguous city&airport / past grabStartAt / fake stations → **PASS** (ask, no confirm)

## Overall
**整体对话入单验收: 通过**

See also: `INTAKE_ACCEPTANCE_E2E.md` for redacted transcripts and HTTP evidence.
