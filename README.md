# ticket-grab-cloud (public demo)

Sanitized source for an assistive multi-channel ticket **search / watch / official-redirect** helper (train · show · flight).

## What this is

- Public search (12306 left-ticket style when `PROVIDER_MODE=live`)
- Chinese conversational intake (`/intake`) → confirmation card → authenticated watch create
- Persistent watch jobs (Postgres + BullMQ) with lifecycle statuses and restart rehydrate
- Honest capability copy: **no unauthorized unattended purchase**

## What this is NOT

- Not an authorized 12306 / Damai reseller
- Not unattended auto seat-hold / payment without platform authorization

## Quick start (local)

```bash
cp .env.example .env
# fill JWT_SECRET, ENCRYPTION_KEY, POSTGRES_PASSWORD, CORS_ORIGIN, NEXT_PUBLIC_API_URL
docker compose -f docker-compose.yml up --build
```

Production notes: see `DEPLOY.md` / `DEPLOY_HTTPS.md`.  
Acceptance evidence template: `ACCEPTANCE.md`.

### Watch-tick (≥5 min) evidence

- [`WATCH_TICK_ACCEPTANCE.md`](./WATCH_TICK_ACCEPTANCE.md) — low-frequency watch tick acceptance (train / show / flight)
- [`WATCH_TICK_TIMELINE.json`](./WATCH_TICK_TIMELINE.json) — redacted per-channel IDs / timestamps
- [`WATCH_TICK_COMMANDS.sh`](./WATCH_TICK_COMMANDS.sh) — public retest curls (no `-k`, self-register)
- [`SMTP_TEMPLATE.env.example`](./SMTP_TEMPLATE.env.example) — SMTP placeholders; email 阻塞 until configured
- Labels: 门禁通过; tick item pass/partial; **整体待独立验收**

## License

Demo / evaluation source. Do not deploy with placeholder secrets.
