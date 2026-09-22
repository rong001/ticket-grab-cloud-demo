# ToC Closed-Loop E2E Evidence Pack — ticket-grab-cloud

**Measured (UTC):** 2026-09-22T05:57Z → 2026-09-22T06:02Z  
**Live:** https://159.75.71.192:18444  
**API:** https://159.75.71.192:18444/api  

## Labels (explicit)

| Item | Status |
|------|--------|
| **P1e** (multi-turn「不限」scope + preference override) | **通过** |
| **整体产品 / 端到端独立验收** | **待独立验收** — do **not** claim overall product PASS |

Capability boundary (honest): **monitor + notify + official redirect / handoff only**. Never describe redirect as「自动购票」.

---

## 1. Per-channel closed loop (API + restart + cancel)

Synthetic accounts self-registered via `POST /api/auth/register` (`e2e_*@example.com`). Passwords **not** stored or printed. Tokens only fingerprinted.

| Channel | Email (throwaway) | sessionId | requestId | watchJobId | confirm | after restart | cancel | Pass |
|---------|-------------------|-----------|-----------|------------|---------|---------------|--------|------|
| train | `e2e_train_1790056638840_7e56@example.com` | `34024e79-0d42-44a3-8149-6466db7d8f51` | `cmuc9i99c000n14bgxehvs3qq` | `cmuc9i99g000p14bgmwznotuq` | 201 → `queued` @ 05:57:22Z | `queued` / reason **Rehydrated after worker restart** @ 05:58:12Z | `cancelled` / **Cancelled by user** @ 05:58:14Z | **PASS** |
| show | `e2e_show_1790056643231_0512@example.com` | `1515018d-a688-4a25-aa79-07400796081d` | `cmuc9ibgw001014bgu2u3dnqw` | `cmuc9ibh0001214bge7lnyl1t` | 201 → `queued` @ 05:57:25Z | `queued` / **Rehydrated…** @ 05:58:13Z | `cancelled` / **Cancelled by user** @ 05:58:14Z | **PASS** |
| flight | `e2e_flight_1790056646086_406d@example.com` | `6d1bad95-1cae-4380-b1e0-fa9193b5bd9b` | `cmuc9idoi001d14bg99wl9f04` | `cmuc9idol001f14bg6fgbieen` | 201 → `queued` @ 05:57:28Z | `queued` / **Rehydrated…** @ 05:58:13Z | `cancelled` / **Cancelled by user** @ 05:58:15Z | **PASS** |

List (`GET /grabs`) and detail (`GET /requests/:id` → `watchJobs[]`) statuses were **consistent** before restart, after restart, and after cancel for all three channels.

Worker log after `docker restart ticket-grab-cloud-worker-1 ticket-grab-cloud-api-1`:

```text
[rehydrate] found 5 watch job(s) to restore
```

ID mapping (redacted): [`TOC_E2E_ID_MAP.json`](./TOC_E2E_ID_MAP.json)

---

## 2. Request / response snippets (redacted)

### 2.1 Register + login (shape only)

```http
POST /api/auth/register
{"email":"e2e_<channel>_<ts>_<hex>@example.com","password":"***","name":"toc-e2e-<channel>"}
→ 200/201 { "token": "eyJ…REDACTED", "user": { "email": "e2e_…@example.com", "role": "user" } }

POST /api/auth/login
{"email":"e2e_…@example.com","password":"***"}
→ 200 { "token": "eyJ…REDACTED" }
```

### 2.2 Intake turns → readyForConfirm (train excerpt)

```json
{
  "step": 7,
  "message": "2026-11-25 09:00",
  "readyForConfirm": true,
  "fields": {
    "channel": "train",
    "from": "韶关东",
    "to": "虎门",
    "date": "2026-12-15",
    "timeWindow": "不限",
    "seatClass": "二等座",
    "passengers": 1,
    "grabStartAt": "2026-11-25T01:00:00.000Z"
  }
}
```

Show / flight mirrors P1e behavior: bare「不限」binds **timeWindow** (flight) or scoped tier override (show); explicit `二等座` / `经济舱` / `内场680` persist on confirm.

### 2.3 Confirm → persistent watch

```http
POST /api/intake/confirm
Authorization: Bearer eyJ…REDACTED
{"sessionId":"<uuid>","confirmed":true,"intervalMinutes":5}
→ 201
{
  "requestId": "cmuc9i99c000n14bgxehvs3qq",
  "watchJobId": "cmuc9i99g000p14bgmwznotuq",
  "…": "watch status queued; statusReason Created from conversational intake confirmation"
}
```

### 2.4 After restart (list/detail)

```json
{
  "id": "cmuc9i99g000p14bgmwznotuq",
  "status": "queued",
  "statusReason": "Rehydrated after worker restart",
  "nextRunAt": "2026-11-25T01:00:00.000Z"
}
```

### 2.5 Cancel

```http
POST /api/requests/{requestId}/watch/{jobId}/cancel
→ 200 { "status": "cancelled", "statusReason": "Cancelled by user" }
```

---

## 3. Browser / UI evidence

Preferred path `https://159.75.71.192:18444/intake` → confirm was exercised in UI (authed synthetic user). Headless Chrome + `localStorage.tg_token` used for evidence screenshots (computerUse MCP unavailable in this executor; equivalent authenticated UI capture).

| Shot | Path | What it shows |
|------|------|----------------|
| Intake (public) | `docs/e2e-shots/01-intake.png` | 对话建单 + capability boundary copy |
| Register | `docs/e2e-shots/02-register.png` | Public self-register UI |
| Grabs login gate | `docs/e2e-shots/03-grabs-login-gate.png` | Unauthed /grabs loading gate |
| Intake confirm-ready | `docs/e2e-shots/04-intake-confirm-ready.png` | Summary card +「确认创建盯票」(not 自动购票) |
| Grabs queued | `docs/e2e-shots/05-grabs-list-queued.png` | `queued` + intake confirmation source |
| Detail queued | `docs/e2e-shots/06-request-detail.png` | Job `queued` + `intake_confirmed` notification |
| Grabs after cancel | `docs/e2e-shots/07-grabs-after-cancel.png` | `cancelled` + reason **Cancelled by user** |
| Detail after cancel | `docs/e2e-shots/08-detail-after-cancel.png` | `watch_cancelled` event + cancelled badge |
| Grabs after restart | `docs/e2e-shots/09-grabs-after-restart.png` | Flight job still listed post-restart |
| Detail after restart | `docs/e2e-shots/10-detail-after-restart.png` | statusReason **Rehydrated after worker restart** |

Extra UI loop IDs (flight create→restart→shot→cancel): see `TOC_E2E_ID_MAP.json` → `extraUiLoop`.

---

## 4. Monitor data source (honest)

Live `GET /api/meta/data-sources` (`providerMode=live`):

| Channel | Provider | What actually monitors today |
|---------|----------|------------------------------|
| **train** | `train12306` | **Real** 12306 public left-ticket query (`kyfw.12306.cn`) |
| **show** | `show` | Dianping/Gewara **myshow public** detail/shows/tickets (实时场次). **Not** Damai authenticated APIs. Official purchase remains redirect/handoff to 大麦/猫眼. |
| **flight** | `opensky` | OpenSky Network free fallback (**ADS-B departures, no prices**). Prefer Amadeus/Aviationstack for booking-quality data when configured. Official purchase = 航司/OTA redirect. |

Worker uses the same `searchTickets` adapters on each watch tick.

---

## 5. Notification delivery (honest)

| Path | Status | Notes |
|------|--------|-------|
| **In-app `NotificationEvent`** | **Works** | Confirm creates `intake_confirmed`; cancel creates `watch_cancelled`; listable on request detail / meta summary. Observed live on UI shots 06/08. |
| **Email (SMTP)** | **阻塞 / not proven for ToC** | Worker has SMTP env vars present, but `SMTP_HOST` was **empty** at measure time; `SMTP_FROM=noreply@example.com`. Throwaway `@example.com` cannot receive mail. **Do not claim email notify PASS.** |
| Push / SMS / IM | **未接线** | Not observed. |

**阻塞项:** outbound email notify not verified end-to-end; treat email as **阻塞** until SMTP is configured and a reachable inbox is used.

---

## 6. Official redirect / copy (never「自动购票」)

Intake capability notes (live copy):

- Train: 定时查询 12306 公开余票并通知；**不含**官方授权的无人值守占座/购票。
- Show: 有票后请**跳转大麦/猫眼等官方平台**完成购买；本系统**不做自动抢购/代下单**。
- Flight: 购票请**跳转航司或 OTA 官方**；本系统**不做自动出票/代收票款**。

UI confirm button label: **「确认创建盯票」** (create monitor task) — not 自动购票.

---

## 7. 可公开复测入口 vs 阻塞

### 可公开复测（无密码、无真实订阅）

1. Open https://159.75.71.192:18444/register — create **your own** `e2e_*@example.com` (or any email you control).
2. Or API: `POST /api/auth/register` then `POST /api/auth/login` → keep token privately.
3. Run [`TOC_E2E_COMMANDS.sh`](./TOC_E2E_COMMANDS.sh) with your `EMAIL`/`PASSWORD` or `TOKEN` for `train|show|flight` (optional `--cancel`).
4. Browser: https://159.75.71.192:18444/intake → multi-turn →「确认创建盯票」→ https://159.75.71.192:18444/grabs → cancel.

### 阻塞 / 需运营配合

| Item | Why |
|------|-----|
| Email notify E2E | SMTP_HOST empty / example.com undeliverable |
| Operator-only restart proof | Third party cannot SSH; restart recipe documented for operators only |
| Flight booking-quality fares | OpenSky has no prices |
| Show Damai login APIs | Public myshow only; purchase via official redirect |
| Overall product acceptance | Explicitly **待独立验收** |

SSH / admin passwords are **not** published. Do not touch `a-commerce-os` or host `:80/:443`.

---

## 8. Repeatable artifacts

| File | Purpose |
|------|---------|
| `TOC_E2E_ACCEPTANCE.md` | This pack |
| `TOC_E2E_COMMANDS.sh` | Third-party curl recipe (TOKEN placeholder via env) |
| `TOC_E2E_ID_MAP.json` | Redacted ID / timestamp / pass table |
| `docs/e2e-shots/*` | UI screenshots |

---

## 9. Conclusion

- Three-channel ToC closed loop (register → intake → confirm → persistent watch → restart rehydrate → list/detail consistent → cancel+reason): **PASS** under API (+ UI shots).
- **P1e: 通过** (unchanged).
- **整体产品仍待端到端独立验收** — email notify and full product sign-off are **not** claimed here.
