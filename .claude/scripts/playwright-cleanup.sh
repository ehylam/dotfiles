#!/usr/bin/env bash
# SessionEnd (Claude) / SessionStart (Codex): prune finished owned QA artifacts only.
# Close browsers through the originating session's API while ownership is available.
# Names, profile paths, age and PPID 1 do not establish ownership. Do not kill
# discovered processes or delete saved profiles, which can contain user logins.
#
# DRY_RUN=1 lists instead of acting. Always exits 0: cleanup must never block a session.

set -uo pipefail
cat >/dev/null 2>&1   # drain the hook payload

PRUNE_DAYS=${PLAYWRIGHT_PRUNE_DAYS:-14}
# Missing Python/helper must not block a session.
ARTIFACT_ARGS=(--days "$PRUNE_DAYS")
[ -n "${DRY_RUN:-}" ] && ARTIFACT_ARGS+=(--dry-run)
python3 "$(dirname "${BASH_SOURCE[0]}")/browser-artifact-cleanup.py" "${ARTIFACT_ARGS[@]}" 2>/dev/null || :
exit 0
