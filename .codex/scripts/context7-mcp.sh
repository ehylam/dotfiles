#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${CODEX_CONTEXT7_ENV:-$HOME/.codex/context7.env}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${CONTEXT7_API_KEY:?Missing CONTEXT7_API_KEY. Create ~/.codex/context7.env or export it.}"

exec npx -y @upstash/context7-mcp@4.1.1
