#!/usr/bin/env bash
# Start the service on this Mac for a public tunnel address.
# Use the HTTPS address from the existing tunnel. For the demo:
#    scripts/start_public.sh https://car-deal-finder.tail088e75.ts.net
# This address sets the agent prompt, discovery documents and MPP realm.
set -euo pipefail
URL="${1:?public https URL required}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOSTNAME="$(python3 -c "import urllib.parse,sys; print(urllib.parse.urlparse(sys.argv[1]).hostname)" "$URL")"
cd "$DIR"
# Stop any earlier copy that holds the port, and wait until the port is free.
PIDS="$(lsof -ti tcp:4320 -sTCP:LISTEN || true)"
[ -n "$PIDS" ] && kill $PIDS || true
for _ in $(seq 1 20); do lsof -ti tcp:4320 -sTCP:LISTEN >/dev/null || break; sleep 0.25; done
PUBLIC_ORIGIN="$URL" MPP_REALM="$HOSTNAME" exec node --env-file=.env src/server.mjs
