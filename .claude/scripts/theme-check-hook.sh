#!/usr/bin/env bash
# PostToolUse[Edit|Write]: run `shopify theme check` and report errors in the edited files.
# Stop (`theme-check-hook.sh stop`): check whatever edits the throttle left unchecked.
#
# A full scan costs ~20s (large client theme, measured 2026-10-01) and real themes carry thousands of
# pre-existing errors, so the guards are:
#   1. only Liquid files inside an actual Shopify theme
#   2. only errors, and only in files edited this session (theme-wide noise is ignored)
#   3. throttled per theme; edits made inside the window queue up and are checked by the
#      next scan or, at the latest, by the Stop pass, so the end of a burst is never skipped
#
# Why the full theme, not `--path sections`: a subdirectory scan invents MissingTemplate and
# MissingAsset errors (272 false hits on a large theme). Scan everything, filter to edited files.
#
# Exit 2 surfaces findings; unavailable validation emits a nonblocking advisory.

set -uo pipefail

THROTTLE_SECS="${THEME_CHECK_THROTTLE:-120}"
SCAN_TIMEOUT="${THEME_CHECK_TIMEOUT:-60}"
mode="${1:-edit}"

payload=$(cat 2>/dev/null) || exit 0
command -v jq >/dev/null 2>&1 || exit 0
echo "$payload" | jq -e . >/dev/null 2>&1 || exit 0

session=$(echo "$payload" | jq -r '.session_id // "nosession"')
pending="${TMPDIR:-/tmp}/.theme-check-pending-${session}"

# Lock queue transactions, not the slow CLI scan. Unique entries preserve repeat
# edits of the same file while an earlier version is being checked.
queue() {
  python3 - "$pending" "$@" <<'PY'
import fcntl, os, pathlib, sys, tempfile, uuid
path = pathlib.Path(sys.argv[1])
mode = sys.argv[2]
with pathlib.Path(str(path) + '.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    lines = path.read_text().splitlines() if path.exists() else []
    if mode == 'append':
        with path.open('a') as stream:
            stream.write('\t'.join([sys.argv[3], sys.argv[4], uuid.uuid4().hex]) + '\n')
    elif mode == 'snapshot':
        for line in lines:
            if line.split('\t', 1)[0] == sys.argv[3]: print(line)
    elif mode == 'roots':
        print('\n'.join(sorted({line.split('\t', 1)[0] for line in lines if line})))
    elif mode == 'retire':
        checked = set(sys.argv[3].splitlines())
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as stream:
                temporary = stream.name
                stream.write(''.join(line + '\n' for line in lines if line not in checked))
            os.replace(temporary, path)
        finally:
            if temporary and os.path.exists(temporary): os.unlink(temporary)
PY
}

# perl ships with macOS; GNU `timeout` does not. SIGALRM exits 142.
with_timeout() { perl -e 'alarm shift; exec @ARGV or exit 127' "$@"; }

# Return findings, or status 3 with an advisory while retaining pending edits.
scan() {
  local theme_root=$1 json files status snapshot
  snapshot=$(queue snapshot "$theme_root" 2>/dev/null) || {
    printf 'Theme check could not read the queue for %s; recheck pending edits.\n' "$theme_root"
    return 3
  }
  files=$(printf '%s\n' "$snapshot" | cut -f2 | sort -u)
  [ -n "$files" ] || return 0
  date +%s > "${TMPDIR:-/tmp}/.theme-check-$(echo "$theme_root" | shasum | cut -c1-12)" 2>/dev/null

  json=$(cd "$theme_root" && with_timeout "$SCAN_TIMEOUT" shopify theme check -o json 2>/dev/null)
  status=$?
  if [ "$status" = 142 ] || [ "$status" = 127 ] || ! printf '%s' "$json" | jq -e '
    type == "array" and all(.[];
      type == "object" and (.path | type) == "string" and (.offenses | type) == "array"
      and all(.offenses[]; type == "object" and (.severity | type) == "string"
        and (.severity != "error" or ((.start_row | type) == "number"
          and (.check | type) == "string" and (.message | type) == "string"))))
  ' >/dev/null 2>&1; then
    printf 'Theme check did not run successfully for %s; edits remain queued.\n' "$theme_root"
    return 3
  fi
  if ! queue retire "$snapshot" 2>/dev/null; then
    printf 'Theme check could not update the queue for %s; recheck pending edits.\n' "$theme_root"
    return 3
  fi

  echo "$json" | jq -r --arg root "$theme_root/" --arg files "$files" '
    ($files | split("\n") | map(ltrimstr($root))) as $rel
    | .[]? | .path as $p
    | select(any($rel[]; . as $r | $p | endswith("/" + $r)))
    | .offenses[] | select(.severity == "error")
    | "  \($p | sub(".*?/(?<r>(sections|snippets|blocks|layout|templates|config|locales|assets)/.*)$"; "\(.r)")):\(.start_row + 1) \(.check): \(.message)"
  ' 2>/dev/null | head -20
  return 0
}

report() {
  if [ -n "$1" ]; then
    printf 'shopify theme check: errors in files edited this session:\n%s\n' "$1" >&2
    [ -z "${2:-}" ] || printf '%s\n' "$2" >&2
    exit 2
  fi
  [ -z "${2:-}" ] || printf '%s' "$2" | jq -Rs '{systemMessage: (.[0:1200] | rtrimstr("\n"))}'
  exit 0
}

if [ "$mode" = "stop" ]; then
  [ "$(echo "$payload" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0
  [ -s "$pending" ] || exit 0
  out=""; advisory=""
  while IFS= read -r root; do
    r=$(scan "$root")
    if [ $? = 3 ]; then advisory="${advisory}${r}"$'\n'
    elif [ -n "$r" ]; then out="${out}${r}"$'\n'; fi
  done < <(queue roots 2>/dev/null)
  report "$out" "$advisory"
fi

fp=$(echo "$payload" | jq -r '.tool_input.file_path // ""')
case "$fp" in *.liquid) ;; *) exit 0 ;; esac

# Walk up from the edited file to the theme root (the dir holding config/settings_schema.json).
root=$(cd "$(dirname "$fp")" 2>/dev/null && pwd) || exit 0
theme_root=""
while [ "$root" != "/" ] && [ -n "$root" ]; do
  if [ -f "$root/config/settings_schema.json" ]; then theme_root="$root"; break; fi
  root=$(dirname "$root")
done
[ -n "$theme_root" ] || exit 0

queue append "$theme_root" "$fp" 2>/dev/null || report "" 'Theme check could not queue this edit; run the check before handover.'

stamp="${TMPDIR:-/tmp}/.theme-check-$(echo "$theme_root" | shasum | cut -c1-12)"
if [ -f "$stamp" ]; then
  last=$(cat "$stamp" 2>/dev/null || echo 0)
  [ $(( $(date +%s) - last )) -lt "$THROTTLE_SECS" ] && exit 0   # queued for the next scan
fi

out=$(scan "$theme_root")
if [ $? = 3 ]; then report "" "$out"; else report "$out"; fi
