# ACCEPTANCE_INTAKE_P1

Conversational Chinese intake P1 parsing fix acceptance.

## Capability note
Monitor + official redirect only; never auto-purchase.

## Required cases

| Case | Expected | Result |
|------|----------|--------|
| `2026-09-29北京南到上海虹桥，08:00-10:00，二等座，两张` | from=北京南, to=上海虹桥, passengers=2; must NOT ask passengers | PASS |
| `2026-09-29 北京南到上海虹桥 08:00-10:00 二等座 两人` | from=北京南, to=上海虹桥, passengers=2; must NOT ask passengers | PASS |
| `9月29日北京南→上海虹桥，上午8点到10点，二等，两张票` | from=北京南, to=上海虹桥, passengers=2; must NOT ask passengers | PASS |
| `北京南到上海虹桥 2026-09-29 二等座 2张` | from=北京南, to=上海虹桥, passengers=2; must NOT ask passengers | PASS |
| `2026-09-29假车站到另一个假站，二等座，两张` | invalid stations; no confirmation; no create | PASS |

**Intent parsing acceptance (this P1 scope): COMPLETE — all required cases PASS**

Full conversational intent parsing product acceptance remains broader than this P1 bugfix;
do not declare overall intent-parsing acceptance complete beyond the cases listed here.

## Exact live fields JSON
```json
{
  "channel": "train",
  "from": "北京南",
  "to": "上海虹桥",
  "date": "2026-09-29",
  "timeWindow": "08:00-10:00",
  "seatClass": "二等座",
  "passengers": 2
}
```

## Remaining gaps
- `grabStartAt` can still be inferred from bare `N点` when no year is present (e.g. 「上午8点到10点」 may set grab-start); prefer explicit 「现在」/datetime for start-watch.
- Allowlist is curated (~182 major stations), not full 12306 index; rare stations may need user to restate after index warm-up improvements.
- Overall conversational intent-parsing product acceptance is broader than this P1 scope (multi-turn UX, flight airports, show edge cases).
