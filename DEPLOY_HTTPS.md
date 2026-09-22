# Production HTTPS (ticket-grab on high port)

## Design (minimal impact)
- Commerce nginx keeps **:80/:443** and cert lineage `159.75.71.192` unchanged.
- Ticket-grab uses a **separate** Let’s Encrypt short-lived IP cert: lineage **`ticket-grab-ip`**.
- ACME HTTP-01 reuses commerce webroot `/var/www/a-commerce-acme` (challenge files only).
- **Do not** mount commerce `privkey.pem` into ticket-grab. Caddy-https mounts only:
  - `/etc/letsencrypt/live/ticket-grab-ip/fullchain.pem`
  - `/etc/letsencrypt/live/ticket-grab-ip/privkey.pem`
- Public URLs:
  - HTTPS: `https://159.75.71.192:18444/`
  - HTTP entry `:18090` → **308** → HTTPS above

## Compose
```bash
docker compose -f docker-compose.prod.yml -f docker-compose.proxy.yml -f docker-compose.https.yml \
  --env-file .env.production up -d
```

## Firewall
Lighthouse inbound: TCP **18444** allow (remark `ticket-grab-https`).

## Renew
- snap/certbot timer renews `ticket-grab-ip` via webroot.
- Deploy hook `/etc/letsencrypt/renewal-hooks/deploy/ticket-grab-caddy.sh` restarts **only** `ticket-grab-cloud-caddy-https-1` when lineage is `ticket-grab-ip`.
- Dry-run: `sudo certbot renew --cert-name ticket-grab-ip --dry-run`

## Caddy IP / SNI note
Clients often omit SNI for raw-IP HTTPS. Site block is `:18444` with `default_sni 159.75.71.192` and explicit `tls` files.
