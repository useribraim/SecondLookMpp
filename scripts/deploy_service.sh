#!/usr/bin/env bash
# Deploy the service into the boat sandbox that also runs the Facebook collector, and publish it.
# Usage: scripts/deploy_service.sh <sandbox-id>
# Secrets: the sandbox .env gets the testnet service keys and OPENCODE_API_KEY from the local .env.
# They travel inside a boat exec command, which boat may record; rotate the OpenCode key after the event.
set -euo pipefail
BOAT="${BOAT_BIN:-$HOME/.ascii/bin/boat}"
ID="${1:?sandbox id required}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP=/home/user/car-listing-search
PORT=4320
run() { "$BOAT" exec "$ID" --timeout "${2:-120}" "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.stdout.write(d.get("stdout","")); sys.stderr.write(d.get("stderr","")[-500:]); sys.exit(d.get("exitCode") or 0)'; }

# 1. Public URL first: the service needs its own origin for discovery documents and the MPP realm.
URL="$("$BOAT" host "$ID" "$PORT" --public --title car-listing-search --json | python3 -c 'import json,sys; t=sys.stdin.read(); print([v for v in __import__("re").findall(r"https://[^\"]+", t)][0])')"
HOSTNAME="$(python3 -c "import urllib.parse,sys; print(urllib.parse.urlparse('$URL').hostname)")"
echo "Public URL: $URL"

# 2. Code.
TARBALL="$(mktemp)"
(cd "$DIR" && COPYFILE_DISABLE=1 tar --no-xattrs -czf "$TARBALL" src scripts sandbox test package.json package-lock.json README.md)
run "mkdir -p $APP && echo $(base64 < "$TARBALL" | tr -d '\n') | base64 -d | tar xzf - -C $APP && ls $APP" >/dev/null
rm -f "$TARBALL"
run "cd $APP && npm ci --ignore-scripts --no-audit --no-fund >/dev/null && npm test 2>&1 | grep -E '^. (pass|fail)'" 300

# 3. Configuration (testnet keys, classifier key, local collector, public origin).
ENVFILE="$(mktemp)"
grep -E '^(MPP_SECRET_KEY|TEMPO_RECIPIENT|TEMPO_SELLER_KEY|SEARCH_PRICE|OPENCODE_API_KEY|ANTHROPIC_API_KEY|FACEBOOK_MAX_DETAILS|DONEDEAL_CANDIDATES)=' "$DIR/.env" > "$ENVFILE"
cat >> "$ENVFILE" <<EOF
PORT=$PORT
HOST=0.0.0.0
PUBLIC_ORIGIN=$URL
MPP_REALM=$HOSTNAME
FACEBOOK_COLLECTOR_DIR=/home/user/car-listing-collector
EOF
run "umask 077 && echo $(base64 < "$ENVFILE" | tr -d '\n') | base64 -d > $APP/.env" >/dev/null
rm -f "$ENVFILE"

# 4. Restart the service in the background.
run "pkill -f '[c]ar-listing-search/src/server.mjs' || true; mkdir -p $APP/.private" >/dev/null
"$BOAT" exec "$ID" --detach "cd $APP && exec node --env-file=.env $APP/src/server.mjs >> $APP/.private/server.log 2>&1" >/dev/null
sleep 3
curl -fsS "$URL/health" && echo
echo "Deployed: $URL"
