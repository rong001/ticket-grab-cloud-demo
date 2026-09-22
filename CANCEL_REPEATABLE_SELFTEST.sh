#!/usr/bin/env bash
# Self-serve cancel → repeatable-gone proof (API-safe, no SSH/Redis required).
#
# Usage (with YOUR own account — never commit passwords):
#   export API_BASE=https://159.75.71.192:18444/api
#   export EMAIL=you@example.com
#   export PASSWORD='your-password'
#   # optional: OBSERVE_SECONDS=330 (default ≥5m)
#   ./CANCEL_REPEATABLE_SELFTEST.sh
#
# Proof criteria (no operator Redis):
#   After cancel, poll own job for ≥5m:
#     status=cancelled, lastRunAt unchanged, repeatableArmed=false
# Optional operator redis dump is documented in READONLY_QUEUE_EVIDENCE.md.
set -euo pipefail

API_BASE="${API_BASE:-https://159.75.71.192:18444/api}"
OBSERVE_SECONDS="${OBSERVE_SECONDS:-330}"
POLL_EVERY="${POLL_EVERY:-30}"
CHANNEL="${CHANNEL:-train}"

if [[ -z "${EMAIL:-}" || -z "${PASSWORD:-}" ]]; then
  echo "Set EMAIL and PASSWORD for an account you own (register at the site if needed)."
  echo "Example:"
  echo "  export API_BASE=https://159.75.71.192:18444/api"
  echo "  export EMAIL=you@example.com PASSWORD='…'"
  echo "  $0"
  exit 2
fi

json_field() {
  # Usage: json_field <json> <key>  (top-level string/number/bool)
  local json="$1" key="$2"
  python3 -c 'import json,sys; d=json.load(sys.stdin); v=d.get(sys.argv[1]); print("" if v is None else v)' "$key" <<<"$json"
}

echo "==> Login"
LOGIN=$(curl -sS -X POST "$API_BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d "$(python3 -c 'import json,os; print(json.dumps({"email":os.environ["EMAIL"],"password":os.environ["PASSWORD"]}))')")
TOKEN=$(json_field "$LOGIN" token)
if [[ -z "$TOKEN" || "$TOKEN" == "" ]]; then
  # try register then login
  echo "==> Login failed; attempting register"
  curl -sS -X POST "$API_BASE/auth/register" \
    -H 'Content-Type: application/json' \
    -d "$(python3 -c 'import json,os; print(json.dumps({"email":os.environ["EMAIL"],"password":os.environ["PASSWORD"],"name":"selftest"}))')" >/dev/null || true
  LOGIN=$(curl -sS -X POST "$API_BASE/auth/login" \
    -H 'Content-Type: application/json' \
    -d "$(python3 -c 'import json,os; print(json.dumps({"email":os.environ["EMAIL"],"password":os.environ["PASSWORD"]}))')")
  TOKEN=$(json_field "$LOGIN" token)
fi
if [[ -z "$TOKEN" ]]; then
  echo "AUTH_FAILED: could not obtain token (check EMAIL/PASSWORD). Response redacted."
  exit 1
fi
AUTH="Authorization: Bearer $TOKEN"

DATE=$(python3 -c 'from datetime import date,timedelta; print((date.today()+timedelta(days=14)).isoformat())')

echo "==> Create request ($CHANNEL)"
if [[ "$CHANNEL" == "flight" ]]; then
  BODY=$(python3 -c "import json; print(json.dumps({'channel':'flight','fields':{'from':'SZX','to':'PVG','date':'$DATE'},'notifyOnly':True}))")
elif [[ "$CHANNEL" == "show" ]]; then
  BODY=$(python3 -c "import json; print(json.dumps({'channel':'show','fields':{'eventName':'selftest','city':'上海'},'notifyOnly':True}))")
else
  BODY=$(python3 -c "import json; print(json.dumps({'channel':'train','fields':{'from':'深圳北','to':'广州南','date':'$DATE'},'notifyOnly':True}))")
fi
REQ=$(curl -sS -X POST "$API_BASE/requests" -H "$AUTH" -H 'Content-Type: application/json' -d "$BODY")
REQUEST_ID=$(json_field "$REQ" id)
if [[ -z "$REQUEST_ID" ]]; then
  echo "CREATE_REQUEST_FAILED"
  echo "$REQ" | head -c 400
  exit 1
fi
echo "requestId=$REQUEST_ID"

echo "==> Start watch intervalMinutes=5"
WATCH=$(curl -sS -X POST "$API_BASE/requests/$REQUEST_ID/watch" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"intervalMinutes":5,"autoOrder":false}')
WATCH_ID=$(python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("id") or d.get("watchJobId") or "")' <<<"$WATCH")
if [[ -z "$WATCH_ID" ]]; then
  echo "CREATE_WATCH_FAILED"
  echo "$WATCH" | head -c 400
  exit 1
fi
echo "watchJobId=$WATCH_ID"

# Capture lastRunAt after a short settle (immediate tick may run)
sleep 8
DETAIL=$(curl -sS "$API_BASE/requests/$REQUEST_ID" -H "$AUTH")
LAST_BEFORE=$(python3 -c 'import json,sys; d=json.load(sys.stdin); jobs=d.get("watchJobs") or []; j=next((x for x in jobs if x.get("id")==sys.argv[1]), None); print((j or {}).get("lastRunAt") or "")' "$WATCH_ID" <<<"$DETAIL")
echo "lastRunAt before cancel: ${LAST_BEFORE:-<none>}"

echo "==> Cancel watch"
CANCEL=$(curl -sS -X POST "$API_BASE/requests/$REQUEST_ID/watch/$WATCH_ID/cancel" -H "$AUTH")
STATUS=$(json_field "$CANCEL" status)
ARMED=$(json_field "$CANCEL" repeatableArmed)
echo "cancel status=$STATUS repeatableArmed=$ARMED"
if [[ "$STATUS" != "cancelled" ]]; then
  echo "CANCEL_STATUS_UNEXPECTED"
  exit 1
fi
if [[ "$ARMED" == "True" || "$ARMED" == "true" ]]; then
  echo "WARN: repeatableArmed still true immediately after cancel (will re-check while polling)"
fi

FROZEN_LAST="$LAST_BEFORE"
if [[ -z "$FROZEN_LAST" ]]; then
  FROZEN_LAST=$(python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("lastRunAt") or "")' <<<"$CANCEL")
fi

echo "==> Poll own job for ${OBSERVE_SECONDS}s (expect lastRunAt frozen + cancelled + repeatableArmed=false)"
START=$(date +%s)
PASS=1
while true; NOW=$(date +%s); ELAPSED=$((NOW-START)); do
  DETAIL=$(curl -sS "$API_BASE/requests/$REQUEST_ID" -H "$AUTH")
  read -r ST LAST ARMED NEXT < <(python3 -c '
import json,sys
d=json.load(sys.stdin)
wid=sys.argv[1]
j=next((x for x in (d.get("watchJobs") or []) if x.get("id")==wid), {})
print(j.get("status") or "", j.get("lastRunAt") or "", j.get("repeatableArmed"), j.get("nextRunAt") or "")
' "$WATCH_ID" <<<"$DETAIL")
  echo "[t=${ELAPSED}s] status=$ST lastRunAt=$LAST repeatableArmed=$ARMED nextRunAt=$NEXT"
  if [[ "$ST" != "cancelled" ]]; then
    echo "FAIL: status drifted from cancelled"
    PASS=0
    break
  fi
  if [[ -n "$FROZEN_LAST" && -n "$LAST" && "$LAST" != "$FROZEN_LAST" ]]; then
    echo "FAIL: lastRunAt changed after cancel ($FROZEN_LAST -> $LAST) — repeatable likely still firing"
    PASS=0
    break
  fi
  if [[ "$ARMED" == "True" || "$ARMED" == "true" ]]; then
    echo "WARN: repeatableArmed=true at t=${ELAPSED}s"
    PASS=0
  fi
  if (( ELAPSED >= OBSERVE_SECONDS )); then
    break
  fi
  sleep "$POLL_EVERY"
done

# Also check /grabs list projection
GRABS=$(curl -sS "$API_BASE/grabs" -H "$AUTH" || curl -sS "$API_BASE/requests/watches" -H "$AUTH" || true)
echo "==> Summary"
echo "requestId=$REQUEST_ID watchJobId=$WATCH_ID frozenLastRunAt=$FROZEN_LAST observeSeconds=$OBSERVE_SECONDS"
if [[ "$PASS" -eq 1 ]]; then
  echo "RESULT: PASS (API-safe self-serve cancel proof)"
  echo "Optional: operators with redis ACL may follow READONLY_QUEUE_EVIDENCE.md — not required for pass."
  exit 0
else
  echo "RESULT: FAIL"
  exit 1
fi
