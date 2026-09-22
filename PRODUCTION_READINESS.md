# Production readiness

Status as of 2026-09-21 — what shipped for To-C launch hardening, and what still blocks「真正上线」.

## Shipped in this pass

| Area | Done |
|------|------|
| Postgres + Redis | Already present; `/health/ready` now checks both |
| Live train / show search | Default `PROVIDER_MODE=live` in `.env.production.example` |
| Live flight path | Amadeus / Aviationstack / `FLIGHT_PUBLIC_API_URL` + OpenSky keyless fallback |
| Data-source badge | `GET /meta/data-sources` + UI「实时数据 / 演示数据」 |
| Prod compose | `docker-compose.prod.yml` — Mailhog **optional** (`--profile mail` / `WITH_MAILHOG=1`) |
| Secrets bootstrap | Fail boot if `JWT_SECRET` / `ENCRYPTION_KEY` weak in `NODE_ENV=production` |
| Rate limits | Auth 20/min, search 30/min, submit 10/min (memory; `RATE_LIMIT_REDIS=1` for multi-instance) |
| Request logging | No passwords / cookies / id numbers in logs |
| Legal pages | `/privacy` `/terms`（中文简要 SaaS；上线前需法务终稿） |
| Launch helper | `scripts/prod-up.sh` + README「上线 checklist」 |
| Env docs | `.env.production.example` |

## Remaining blockers for「真正上线」

1. **Stable public host + HTTPS** — need real domain, reverse proxy (Caddy/Nginx sample in README), TLS certs. Localhost is not To-C.
2. **Strong secrets in a real `.env.production`** — generate with `openssl rand -hex 32`; never commit.
3. **Flight API keys for booking-quality data** — OpenSky has no fares and sparse coverage. Register Amadeus test keys (~5 min) or Aviationstack; see README「5 分钟启用实时机票」.
4. **12306 human steps** — image captcha, SMS / face verification, and **final payment** always require the customer on official flows. We surface them in-app; we do not auto-solve or fake `paid`.
5. **Show booking** — search is live (Dianping/Gewara); submit/pay still handoff to Damai/Maoyan sessions (assistive, not full unsupervised checkout).
6. **SMTP** — configure a real provider for watch/order emails (Mailhog is dev-only).
7. **Legal copy** — replace `/privacy` and `/terms` stubs with counsel-approved text; confirm ICP / 经营许可 if required for your jurisdiction and traffic.
8. **Backups + monitoring** — enable `pg_dump` cron; watch `/health/ready`, 5xx rate, queue lag; set up log drain.
9. **E2E against prod-like stack** — prior E2E 56/56 was on local live modes; re-run after DNS/TLS cutover.

## Quick verify

```bash
curl -s http://localhost:3001/health | jq .
curl -s http://localhost:3001/health/ready | jq .
curl -s http://localhost:3001/meta/data-sources | jq .
pnpm test
```

## Explicit non-goals (compliance)

- No scalping, queue-bypass, captcha farms, or multi-account abuse tooling.
- No inventing payment confirmation — `paid` only with real confirmation fields / live session refresh.
