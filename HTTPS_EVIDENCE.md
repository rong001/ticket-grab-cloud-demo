# HTTPS customer-view evidence — 2026-09-22T03:03:54.072659+00:00

## Edge
- Public HTTPS: `https://159.75.71.192:18444/`
- HTTP entry: `http://159.75.71.192:18090/` → **308** → `https://159.75.71.192:18444/`
- Cert lineage: **ticket-grab-ip** (separate from commerce `159.75.71.192`)
- ACME webroot: `/var/www/a-commerce-acme` (shared challenge path only; **commerce privkey not mounted**)
- Caddy-https mounts only: `live/ticket-grab-ip/{fullchain,privkey}.pem`
- Firewall: Lighthouse inbound TCP **18444** allow all IPv4 (remark `ticket-grab-https`)
- Renew: `certbot renew --cert-name ticket-grab-ip` dry-run **PASS**; deploy-hook restarts only `ticket-grab-cloud-caddy-https-1`

## TLS (external)
- OpenSSL verify return code: **0 (ok)**
- Chain: leaf YE2 ← Root YE ← ISRG Root X2; SAN IP `159.75.71.192`
- curl home: HTTP 200, ssl_verify_result **0**

## Flows over HTTPS
- Guest `POST /api/public/search` train 北京南→上海虹桥 2026-09-25: liveOk=True items=40 provider=train12306 mode=live
- Register: ok=True keys=['token', 'user']
- Login: ok=True keys=['token', 'user']

## Unchanged
- Commerce on :443 still HTTP 200 with its own cert lineage `159.75.71.192`
