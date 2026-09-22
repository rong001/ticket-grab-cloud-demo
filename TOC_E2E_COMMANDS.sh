#!/usr/bin/env bash
# ToC closed-loop retest recipe (train / show / flight)
# Third parties MUST create their OWN account via public register.
# This script never embeds passwords. Pass EMAIL/PASSWORD or TOKEN yourself.
# TLS: use normal certificate verification (no curl -k). Live IP uses a Let's Encrypt
# certificate with IP SAN for 159.75.71.192 — stock CA stores should verify.
# If a client rejects IP SANs, upgrade the CA bundle / curl; do not disable verify.

#
# Register UI: https://159.75.71.192:18444/register
# Live base:   https://159.75.71.192:18444
#
# Examples:
#   export API_BASE=https://159.75.71.192:18444/api
#   export EMAIL="e2e_you_$(date +%s)@example.com"
#   export PASSWORD='Choose_Your_Own_Strong_Pass1!'
#   bash TOC_E2E_COMMANDS.sh train
#   bash TOC_E2E_COMMANDS.sh train --cancel
#   TOKEN=… REQUEST_ID=… JOB_ID=… bash TOC_E2E_COMMANDS.sh cancel
#
# Restart (operator, not required for third-party API retest of create/list/cancel):
#   docker restart ticket-grab-cloud-worker-1 ticket-grab-cloud-api-1
# Then re-GET /grabs and /requests/:id — expect statusReason "Rehydrated after worker restart".

set -euo pipefail
API_BASE="${API_BASE:-https://159.75.71.192:18444/api}"
MODE="${1:-train}"
DO_CANCEL=0
[[ "${2:-}" == "--cancel" ]] && DO_CANCEL=1

redact() { sed -E 's/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/eyJ…REDACTED/g'; }
json_get() {
  python3 -c 'import json,sys
d=json.load(sys.stdin); p=sys.argv[1].lstrip("."); o=d
for k in p.split("."):
  if not k: continue
  o = o[int(k)] if isinstance(o, list) else (o or {}).get(k)
print("" if o is None else o)' "$1"
}
# Public search body shape (POST /public/search):
# {"channel":"train|show|flight","fields":{...}}
api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-sS -X "$method" -H "content-type: application/json" -H "accept: application/json")
  if [[ -n "${TOKEN:-}" ]]; then args+=(-H "Authorization: Bearer ${TOKEN}"); fi
  if [[ -n "$body" ]]; then args+=(-d "$body"); fi
  curl "${args[@]}" "${API_BASE}${path}"
}

echo "== $(date -u +%Y-%m-%dT%H:%M:%SZ)  API_BASE=$API_BASE mode=$MODE =="
echo "== meta/data-sources =="
api GET /meta/data-sources | tee /tmp/toc-meta.json | redact
echo

if [[ "$MODE" == "cancel" ]]; then
  : "${TOKEN:?set TOKEN}"
  REQ="${REQUEST_ID:-$(cat /tmp/toc-request-id.txt 2>/dev/null || true)}"
  JOB="${JOB_ID:-$(cat /tmp/toc-job-id.txt 2>/dev/null || true)}"
  : "${REQ:?set REQUEST_ID}"
  : "${JOB:?set JOB_ID}"
  echo "== cancel =="
  api POST "/requests/${REQ}/watch/${JOB}/cancel" '{}' | tee /tmp/toc-cancel.json | redact
  echo "== detail after cancel =="
  api GET "/requests/${REQ}" | tee /tmp/toc-detail-cancel.json | redact | python3 -c 'import json,sys
d=json.load(sys.stdin)
for j in d.get("watchJobs") or []:
  print(j.get("id"), j.get("status"), j.get("statusReason"))'
  exit 0
fi

TOKEN="${TOKEN:-}"
EMAIL="${EMAIL:-}"
PASSWORD="${PASSWORD:-}"
if [[ -z "$TOKEN" ]]; then
  if [[ -z "$EMAIL" || -z "$PASSWORD" ]]; then
    echo "Set EMAIL+PASSWORD (your throwaway) or TOKEN." >&2
    echo "UI register: https://159.75.71.192:18444/register" >&2
    exit 2
  fi
  echo "== register =="
  api POST /auth/register "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"name\":\"toc-retest\"}" | redact || true
  echo
  echo "== login =="
  LOGIN_JSON=$(api POST /auth/login "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")
  echo "$LOGIN_JSON" | redact
  TOKEN=$(printf '%s' "$LOGIN_JSON" | json_get token)
  [[ -n "$TOKEN" ]] || { echo "login failed" >&2; exit 1; }
  export TOKEN
  echo "TOKEN fingerprint: ${TOKEN:0:8}…${TOKEN: -6}"
fi
export TOKEN

turn() {
  local sid="$1" msg="$2"
  local payload
  payload=$(MSG="$msg" SID="$sid" python3 - <<'PY'
import json, os
msg=os.environ["MSG"]; sid=os.environ.get("SID") or ""
body={"message": msg}
if sid: body["sessionId"]=sid
print(json.dumps(body, ensure_ascii=False))
PY
)
  api POST /intake/turn "$payload"
}

run_turns() {
  local sid="" msg RESP
  for msg in "$@"; do
    echo "-- turn: $msg"
    RESP=$(turn "$sid" "$msg")
    echo "$RESP" | redact | python3 -c 'import json,sys
d=json.load(sys.stdin)
print({"sessionId":d.get("sessionId"),"missing":d.get("missing"),"ready":d.get("readyForConfirm")})
print("fields", d.get("fields"))'
    sid=$(printf '%s' "$RESP" | json_get sessionId)
  done
  printf '%s' "$sid" > /tmp/toc-session-id.txt
  printf '%s' "$RESP" > /tmp/toc-last-turn.json
}

case "$MODE" in
  train)  run_turns "火车" "韶关东到虎门" "2026-12-15" "不限" "二等座" "1人" "2026-11-25 09:00" ;;
  show)   run_turns "演出" "周杰伦嘉年华演唱会" "梅赛德斯-奔驰文化中心" "2026-12-31" "内场680" "1人" "2026-11-25 09:00" ;;
  flight) run_turns "机票" "SZX到PVG" "2026-12-10" "不限" "经济舱" "1人" "2026-11-25 09:00" ;;
  *) echo "usage: $0 train|show|flight [--cancel] | cancel" >&2; exit 2 ;;
esac

SID=$(cat /tmp/toc-session-id.txt)
READY=$(python3 -c 'import json; print(json.load(open("/tmp/toc-last-turn.json")).get("readyForConfirm"))')
echo "sessionId=$SID readyForConfirm=$READY"
[[ "$READY" == "True" || "$READY" == "true" ]] || { echo "not readyForConfirm" >&2; exit 1; }

echo "== confirm =="
CONFIRM=$(api POST /intake/confirm "{\"sessionId\":\"${SID}\",\"confirmed\":true,\"intervalMinutes\":5}")
echo "$CONFIRM" | tee /tmp/toc-confirm.json | redact
REQ=$(printf '%s' "$CONFIRM" | json_get requestId)
JOB=$(printf '%s' "$CONFIRM" | json_get watchJobId)
[[ -n "$REQ" ]] || REQ=$(printf '%s' "$CONFIRM" | json_get request.id)
[[ -n "$JOB" ]] || JOB=$(printf '%s' "$CONFIRM" | json_get watchJob.id)
echo "requestId=$REQ watchJobId=$JOB"
printf '%s' "$REQ" > /tmp/toc-request-id.txt
printf '%s' "$JOB" > /tmp/toc-job-id.txt

echo "== list /grabs =="
api GET /grabs | tee /tmp/toc-grabs.json | redact | python3 -c 'import json,sys
d=json.load(sys.stdin); items=d.get("items") or []
print("count", len(items))
for i in items[:8]:
  print({k:i.get(k) for k in ["id","requestId","status","statusReason","startsAt","nextRunAt"]})'

echo "== detail =="
api GET "/requests/${REQ}" | tee /tmp/toc-detail.json | redact | python3 -c 'import json,sys
d=json.load(sys.stdin)
print("channel", d.get("channel")); print("fields", d.get("fields"))
for j in d.get("watchJobs") or []:
  print({k:j.get(k) for k in ["id","status","statusReason","startsAt","nextRunAt","bullJobId"]})'

if [[ "$DO_CANCEL" -eq 1 ]]; then
  echo "== cancel =="
  api POST "/requests/${REQ}/watch/${JOB}/cancel" '{}' | tee /tmp/toc-cancel.json | redact
  api GET "/requests/${REQ}" | redact | python3 -c 'import json,sys
d=json.load(sys.stdin)
for j in d.get("watchJobs") or []:
  print(j.get("id"), j.get("status"), j.get("statusReason"))'
fi

echo
echo "Done. Labels context: P1e=通过; overall product remains 待独立验收."
