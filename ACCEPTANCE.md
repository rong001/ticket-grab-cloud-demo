# Acceptance Report — ticket-grab-cloud (ToC gaps)

Date: 2026-09-22  
Live: `https://159.75.71.192:18444/` (and `:18090` → HTTPS)  
Scope: Chinese conversational intake, persistent watch jobs, honest capability copy, public demo repo.

## Checklist

| # | Requirement | Result | Evidence |
|---|-------------|--------|----------|
| 1 | Chinese conversational intake UI+API; ask missing fields one-by-one; confirmation card; create only after confirm | **PASS** | `/intake` UI + `POST /api/intake/turn` + `POST /api/intake/confirm` (auth). Confirm without login rejected. E2E created watch `queued`. |
| 2 | Persistent scheduled watches survive restart; statuses + reason/timestamps; cancel | **PASS** | After `docker compose restart worker api`, DB row `status=queued`, `statusReason=Rehydrated after worker restart`, `bullJobId` present. Cancel: `POST /api/requests/{id}/watch/{jobId}/cancel`. |
| 3 | Real railway query | **PASS** | `POST /api/public/search` Beijing South→Shanghai Hongqiao `liveOk=true`, 40 items. |
| 4 | Show honest capability path | **PASS** | Intake confirmation note: 开售/有票监控 + 官方下单；不含未授权自动抢购. |
| 5 | Flight honest capability path | **PASS** | Intake confirmation note: 航班监控 + 航司/OTA 官方购票；不含代收票款. |
| 6 | Product distinction (query / monitor / official redirect vs authorized auto-buy) | **PASS** | `/capabilities` + homepage/footer: no unattended purchase claims; HTTPS wording updated (no “建议 HTTPS”). |
| 7 | Homepage/footer old HTTPS advice removed | **PASS** | Copy: “已启用 HTTPS” / “本环境已通过 HTTPS 提供服务”. |
| 8 | Public sanitized demo repo | **PASS** | See URL below (no secrets / sessions / keys). |
| 9 | Do not seize 80/443 or stop a-commerce-os | **PASS** | Only ticket-grab ports 18090/18444 rebuilt. |

## E2E notes

- Intake collected: train / 北京南→上海虹桥 / 2026-10-01 / 06:00-12:00 / 二等座 / 2人 → confirmation → create watch.
- Worker log after restart: `[rehydrate] found 1 watch job(s) to restore`.
- Public search liveOk for 12306 left-ticket style query.

## Remaining gaps

- `/api/grabs` list may omit jobs whose `startsAt` is far in the future (UI should still show via request detail).
- Show/flight are monitor + official redirect only (by design; no unauthorized auto-purchase).
- Conversational parser is rule-based (no LLM); unusual phrasing may need follow-up turns.

## Far-future /api/grabs fix

See `ACCEPTANCE_FAR_FUTURE.md` / `/workspace/FAR_FUTURE_E2E.md` — queued far-future watches now listed; rehydrate+cancel verified.
