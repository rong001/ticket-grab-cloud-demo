#!/usr/bin/env bash
# Bring up production compose stack with validation + optional Mailhog profile.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy from .env.production.example and fill secrets."
  exit 1
fi

# shellcheck disable=SC1090
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

fail=0
need() {
  local k="$1"
  if [[ -z "${!k:-}" ]]; then
    echo "ERROR: $k is empty in $ENV_FILE"
    fail=1
  fi
}
need JWT_SECRET
need ENCRYPTION_KEY
need POSTGRES_PASSWORD
need CORS_ORIGIN
need NEXT_PUBLIC_API_URL

weak() {
  local k="$1" v="${!1:-}"
  if [[ ${#v} -lt 24 ]] || [[ "$v" =~ ^(change-?me|dev|test|REPLACE_) ]] || [[ "$v" == *"change-me"* ]]; then
    echo "ERROR: $k looks weak / placeholder (len=${#v}). Use a long random secret."
    fail=1
  fi
}
weak JWT_SECRET
weak ENCRYPTION_KEY

if [[ "${PROVIDER_MODE:-live}" != "live" ]]; then
  echo "WARN: PROVIDER_MODE=${PROVIDER_MODE:-} (recommend live for To-C)"
fi

if [[ $fail -ne 0 ]]; then
  echo "Aborting. Fix $ENV_FILE and retry."
  exit 1
fi

PROFILES=()
if [[ "${WITH_MAILHOG:-0}" == "1" ]]; then
  PROFILES+=(--profile mail)
  echo "Including Mailhog profile (WITH_MAILHOG=1)"
fi

echo "Building & starting ($COMPOSE_FILE, env=$ENV_FILE)…"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "${PROFILES[@]}" up -d --build "$@"

echo ""
echo "Waiting for API readiness…"
for i in $(seq 1 40); do
  if docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T api \
    node -e "fetch('http://127.0.0.1:3001/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    2>/dev/null; then
    echo "API ready."
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
    echo ""
    echo "Next: put Caddy/Nginx in front (HTTPS), point DNS, verify GET /health/ready and /meta/data-sources"
    echo "Backup tip: docker compose -f $COMPOSE_FILE exec -T postgres pg_dump -U ticket ticket_grab > backup-\$(date +%F).sql"
    exit 0
  fi
  sleep 3
done

echo "WARN: API did not become ready in time — check: docker compose -f $COMPOSE_FILE logs api"
exit 1
