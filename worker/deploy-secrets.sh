#!/usr/bin/env bash
# Usage: ./deploy-secrets.sh [vars-file]
# Default vars file is .dev.vars
set -euo pipefail

VARS_FILE="${1:-.dev.vars}"

if [[ ! -f "$VARS_FILE" ]]; then
  echo "Error: $VARS_FILE not found" >&2
  exit 1
fi

echo "Deploying secrets from $VARS_FILE..."

while IFS= read -r line; do
  # skip blank lines and comments
  [[ -z "$line" || "$line" == \#* ]] && continue

  KEY="${line%%=*}"
  VALUE="${line#*=}"

  echo "  Putting $KEY"
  echo "$VALUE" | npx wrangler secret put "$KEY"
done < "$VARS_FILE"

echo "Done."
