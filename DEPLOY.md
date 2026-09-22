# Deploy

Use `docker-compose.prod.yml` + `docker-compose.proxy.yml` + `docker-compose.https.yml` with `.env.production` (from `.env.production.example`).

Do not bind host 80/443 if another stack owns them; this demo uses 18090/18444.
