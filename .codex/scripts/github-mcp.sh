#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${CODEX_GITHUB_MCP_ENV:-$HOME/.codex/github-mcp.env}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${CODEX_GITHUB_PERSONAL_ACCESS_TOKEN:?Missing CODEX_GITHUB_PERSONAL_ACCESS_TOKEN. Create ~/.codex/github-mcp.env or export it.}"

headers=(--header "Authorization: Bearer ${CODEX_GITHUB_PERSONAL_ACCESS_TOKEN}")

exec npx -y mcp-remote@0.8.1 https://api.githubcopilot.com/mcp/ \
  --transport http-only \
  "${headers[@]}" \
  2> >(sed -E 's/Bearer [^"}[:space:]]+/Bearer <redacted>/g' >&2)
