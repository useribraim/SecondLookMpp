#!/usr/bin/env bash
# Create (or reuse) the boat sandbox for the Facebook Marketplace collector, install the collector,
# and print the browser link where you sign in to Facebook yourself.
# Usage: scripts/prepare_facebook_sandbox.sh [existing-sandbox-id]
set -euo pipefail
BOAT="${BOAT_BIN:-$HOME/.ascii/bin/boat}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE=/data/chrome-facebook
REMOTE=/home/user/car-listing-collector

if [ "${1:-}" ]; then
  ID="$1"
  "$BOAT" resume "$ID" >/dev/null 2>&1 || true
else
  # `boat new --json` prints JSON lines; take the id from the line that has the sandbox.
  ID="$("$BOAT" new --name facebook-marketplace-collector --json | python3 -c 'import json,sys; print([json.loads(l)["sandbox"]["id"] for l in sys.stdin if "\"sandbox\"" in l][-1])')"
fi
echo "Sandbox: $ID"

# Copy the collector over the API as base64 (boat scp can fail when the local SSH socket path is too long).
"$BOAT" exec "$ID" "mkdir -p $REMOTE" >/dev/null
for FILE in collect_marketplace.mjs package.json; do
  "$BOAT" exec "$ID" "echo $(base64 < "$DIR/sandbox/$FILE" | tr -d '\n') | base64 -d > $REMOTE/$FILE" >/dev/null
done
"$BOAT" exec "$ID" "sha256sum $REMOTE/collect_marketplace.mjs" | grep -o '"stdout":"[0-9a-f]*' || true
shasum -a 256 "$DIR/sandbox/collect_marketplace.mjs"
"$BOAT" exec "$ID" --timeout 300 "cd $REMOTE && npm install --ignore-scripts --no-audit --no-fund" | grep -o '"success":[a-z]*'

echo
echo "Open this link and sign in to Facebook yourself. The sign-in stays in $PROFILE:"
"$BOAT" browser "$ID" --profile "$PROFILE"
echo
echo "Then add this line to .env and restart the service:"
echo "BOAT_SANDBOX_ID=$ID"
