#!/usr/bin/env bash
# Watch-tick retest recipe (≥5 minute interval). Self-register; no embedded passwords.
# TLS: normal verification (no curl -k). Live cert has IP SAN for 159.75.71.192.
#
#   export API_BASE=https://159.75.71.192:18444/api
#   export EMAIL="watchtick_you_$(date +%s)@example.com"
#   export PASSWORD='Choose_Your_Own_Strong_Pass1!'
#   export CHANNEL=train   # train | show | flight
#   bash WATCH_TICK_COMMANDS.sh
#
set -euo pipefail
API_BASE="${API_BASE:-https://159.75.71.192:18444/api}"
CHANNEL="${CHANNEL:-train}"
INTERVAL_MIN="${INTERVAL_MIN:-5}"
redact() { sed -E 's/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/eyJ…REDACTED/g'; }
json_get() {
  python3 -c 'import json,sys
d=json.load(sys.stdin); p=sys.argv[1].lstrip("."); o=d
for k in p.split("."):
  if not k: continue
  o=o[int(k)] if isinstance(o,list) else (o or {}).get(k)
print("" if o is None else o)' "$1"
}
# Public search body shape (POST /public/search):
# {"channel":"train|show|flight","fields":{...}}
api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-sS -X "$method" -H "content-type: application/json" -H "accept: application/json")
  [[ -n "${TOKEN:-}" ]] && args+=(-H "Authorization: Bearer ${TOKEN}")
  [[ -n "$body" ]] && args+=(-d "$body")
  curl "${args[@]}" "${API_BASE}${path}"
}

echo "== $(date -u +%Y-%m-%dT%H:%M:%SZ) CHANNEL=$CHANNEL INTERVAL_MIN=$INTERVAL_MIN =="
api GET /health | redact; echo
api GET /meta/data-sources | redact; echo

: "${EMAIL:?set EMAIL}"; : "${PASSWORD:?set PASSWORD}"
api POST /auth/register "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"name\":\"watch-tick-retest\"}" | redact || true
echo
LOGIN=$(api POST /auth/login "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")
echo "$LOGIN" | redact
TOKEN=$(printf '%s' "$LOGIN" | json_get token)
export TOKEN
echo "TOKEN fingerprint: ${TOKEN:0:8}…${TOKEN: -6}"

case "$CHANNEL" in
  train)
    BODY='{"channel":"train","notifyOnly":true,"fields":{"from":"深圳北","to":"汕尾","date":"2026-09-25","timeWindow":"不限","seatClass":"二等座","passengers":1}}'
    ;;
  show)
    BODY='{"channel":"show","notifyOnly":true,"fields":{"eventName":"周杰伦嘉年华演唱会","city":"上海","venue":"梅赛德斯-奔驰文化中心","date":"2026-12-31","tier":"内场680","quantity":1}}'
    ;;
  flight)
    BODY='{"channel":"flight","notifyOnly":true,"fields":{"from":"SZX","to":"PVG","date":"2026-09-25","cabin":"经济舱","passengers":1}}'
    ;;
  *) echo "unknown CHANNEL"; exit 2 ;;
esac

REQ=$(api POST /requests "$BODY")
echo "$REQ" | redact
REQUEST_ID=$(printf '%s' "$REQ" | json_get id)
STARTS=$(date -u -d '5 seconds ago' +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || python3 -c 'from datetime import datetime,timedelta,timezone;print((datetime.now(timezone.utc)-timedelta(seconds=5)).strftime("%Y-%m-%dT%H:%M:%S.000Z"))')
WATCH=$(api POST "/requests/${REQUEST_ID}/watch" "{\"intervalMinutes\":${INTERVAL_MIN},\"startsAt\":\"${STARTS}\",\"autoOrder\":false,\"preferences\":{\"notify\":true}}")
echo "$WATCH" | redact
JOB_ID=$(printf '%s' "$WATCH" | json_get id)
echo "requestId=$REQUEST_ID watchJobId=$JOB_ID intervalMinutes field documented in WATCH_TICK_ACCEPTANCE.md"

echo "== poll detail until lastRunAt (first tick via watch-immediate) =="
for i in $(seq 1 30); do
  DET=$(api GET "/requests/${REQUEST_ID}")
  LAST=$(printf '%s' "$DET" | python3 -c 'import json,sys;d=json.load(sys.stdin);js=d.get("watchJobs") or [];print((js[0] or {}).get("lastRunAt") or "")')
  STATUS=$(printf '%s' "$DET" | python3 -c 'import json,sys;d=json.load(sys.stdin);js=d.get("watchJobs") or [];print((js[0] or {}).get("status") or "")')
  NEXT=$(printf '%s' "$DET" | python3 -c 'import json,sys;d=json.load(sys.stdin);js=d.get("watchJobs") or [];print((js[0] or {}).get("nextRunAt") or "")')
  echo "  poll#$i status=$STATUS lastRunAt=$LAST nextRunAt=$NEXT"
  [[ -n "$LAST" ]] && break
  sleep 5
done

echo "== events =="; api GET "/requests/${REQUEST_ID}/events" | redact | head -c 2000; echo
echo "== grabs list =="; api GET /grabs | redact | python3 -c 'import json,sys;d=json.load(sys.stdin);items=d.get("items") or [];
[print(i.get("id"), i.get("status"), i.get("lastRunAt"), i.get("nextRunAt"), i.get("intervalMinutes")) for i in items[:10]]'

echo "== cancel =="; api POST "/requests/${REQUEST_ID}/watch/${JOB_ID}/cancel" '{}' | redact; echo
echo "Observe ≥1 interval (${INTERVAL_MIN}m) or confirm lastRunAt frozen + status=cancelled."
