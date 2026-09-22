# 12306 station name index

- **Source:** `https://kyfw.12306.cn/otn/resources/js/framework/station_name.js`
- **Fetched:** 2026-09-22
- **Count:** 3388 unique Chinese station names (passenger stations published by 12306)
- **Files:**
  - `stations.json` — sorted unique name array (runtime allowlist for intake)
  - `stations-index.json.gz` — name + telecode + 三字码 + pinyin (reference archive; not loaded at runtime)
- **Usage:** imported by `knownStations.ts` for conversational intake validation / fuzzy clarify.
- **Note:** station names are public timetable metadata from 12306; redistributed as static lookup data for validation only. Not a live scrape at request time.
