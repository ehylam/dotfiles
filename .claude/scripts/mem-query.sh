#!/usr/bin/env bash
# Query private metadata written by mem-capture.sh. No command or prompt history.
#
#   mem-query.sh                          last 7 days, this repo
#   mem-query.sh --days 30 --repo example-theme
#   mem-query.sh --all-repos --class blocker
#   mem-query.sh --files                  which files got touched most
#   mem-query.sh --sessions               one line per session and repo
#   mem-query.sh --grep nosto             metadata/file substring match
#   mem-query.sh --raw                    metadata JSONL for further jq
#
# Malformed rows are skipped; legacy raw text is never returned.

set -uo pipefail

STORE_DIR="${CLAUDE_MEM_DIR:-$HOME/.claude/state/mem}"
DAYS=7; REPO=""; ALL_REPOS=0; CLS=""; MODE="summary"; PATTERN=""

while [ $# -gt 0 ]; do
  case "$1" in
    --days|--repo|--class|--grep)
      [ $# -ge 2 ] && [[ "$2" != --* ]] || { echo "missing value for $1" >&2; exit 1; }
      case "$1" in
        --days) DAYS="$2" ;;
        --repo) REPO="$2" ;;
        --class) CLS="$2" ;;
        --grep) PATTERN="$2" ;;
      esac
      shift 2 ;;
    --all-repos) ALL_REPOS=1; shift ;;
    --files) MODE="files"; shift ;;
    --sessions) MODE="sessions"; shift ;;
    --raw) MODE="raw"; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

[[ "$DAYS" =~ ^[0-9]{1,5}$ ]] && [ "$((10#$DAYS))" -le 36500 ] || {
  echo "--days must be an integer between 0 and 36500" >&2; exit 1;
}
DAYS=$((10#$DAYS))
case "$CLS" in
  ""|discovery|change|create|blocker) ;;
  *) echo "unknown classification: $CLS" >&2; exit 1 ;;
esac
command -v jq >/dev/null 2>&1 || { echo "jq required" >&2; exit 1; }
[ -d "$STORE_DIR" ] || { echo "no memory store at $STORE_DIR yet"; exit 0; }
shopt -s nullglob
files=("$STORE_DIR"/*.jsonl)
[ "${#files[@]}" -gt 0 ] || { echo "no records yet"; exit 0; }

if [ "$ALL_REPOS" -eq 0 ] && [ -z "$REPO" ]; then
  REPO=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")
fi
since=$(date -u -v-"${DAYS}"d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
     || date -u -d "${DAYS} days ago" +%Y-%m-%dT%H:%M:%SZ) || exit 1

# Project legacy rows onto the current schema before filtering or output.
sel=$(jq -Rc --arg since "$since" --arg repo "$REPO" --arg cls "$CLS" --arg pat "$PATTERN" '
  fromjson? | select(type == "object")
  | select((.ts | type) == "string")
  | select(.ts | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"))
  | .reason as $reason
  | {ts, kind, session_id, repo, branch, classification, status, error, interrupted,
     tool, command_category, exit_code,
     reason:(if (["logout","clear","prompt_input_exit","other"] | index($reason)) != null then $reason else null end),
     files:(if (.files | type) == "array" then [.files[] | select(type == "string")] else [] end)}
  | select(.ts >= $since)
  | select($repo == "" or .repo == $repo)
  | select($cls == "" or .classification == $cls)
  | select($pat == "" or ([.repo, .branch, .tool, .kind, .classification, .status, .command_category, (.files|join(" "))]
      | map(select(type == "string")) | join(" ") | ascii_downcase | contains($pat | ascii_downcase)))
  ' "${files[@]}") || exit 1

[ -n "$sel" ] || { echo "no records matching (repo=${REPO:-any} days=$DAYS class=${CLS:-any})"; exit 0; }

case "$MODE" in
  raw|summary) sel=$(printf '%s\n' "$sel" | jq -sc 'sort_by(.ts)[]') || exit 1 ;;
esac

case "$MODE" in
  raw) printf '%s\n' "$sel" ;;
  files) printf '%s\n' "$sel" | jq -r '.files[]?' | sort | uniq -c | sort -rn | head -30 ;;
  sessions)
    printf '%s\n' "$sel" | jq -sr '
      [.[] | select(.kind == "tool")] | group_by([.session_id, .repo])
      | map({sid:.[0].session_id, repo:.[0].repo, count:length,
             first:(map(.ts) | min), last:(map(.ts) | max)})
      | sort_by(-.count, .sid, .repo)[]
      | "\(.sid)\t\(.repo)\t\(.count) calls\t\(.first) -> \(.last)"' ;;
  summary)
    echo "window: last ${DAYS}d   repo: ${REPO:-all}   records: $(printf '%s\n' "$sel" | wc -l | tr -d ' ')"
    echo
    echo "by classification:"
    printf '%s\n' "$sel" | jq -r '.classification // "unknown"' | sort | uniq -c | sort -rn | sed 's/^/  /'
    echo
    echo "by repo:"
    printf '%s\n' "$sel" | jq -r '.repo // "unknown"' | sort | uniq -c | sort -rn | head -10 | sed 's/^/  /'
    echo
    echo "blockers (tool calls that failed):"
    b=$(printf '%s\n' "$sel" | jq -r 'select(.classification == "blocker")
      | "  \(.ts|.[5:16])  \(.repo)  \(.command_category // .tool)  \(.status // "error")  exit=\(.exit_code // "unknown")"' | tail -15)
    [ -n "$b" ] && printf '%s\n' "$b" || echo "  none"
    echo
    echo "most-touched files:"
    printf '%s\n' "$sel" | jq -r '.files[]?' | sort | uniq -c | sort -rn | head -10 | sed 's/^/  /'
    ;;
esac
