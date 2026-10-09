#!/usr/bin/env bash
# Private metadata capture. No raw commands, prompts, URLs, responses or errors.
# Reads hook payloads on stdin; tool/session modes always exit 0.

set -uo pipefail
umask 077

MODE="${1:-tool}"
STORE_DIR="${CLAUDE_MEM_DIR:-$HOME/.claude/state/mem}"
OUT="$STORE_DIR/$(date +%Y-%m).jsonl"

command -v jq >/dev/null 2>&1 || exit 0
payload=$(cat 2>/dev/null) || exit 0
[ -n "$payload" ] || exit 0
[ ! -L "$STORE_DIR" ] && [ ! -L "$OUT" ] || exit 0

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
repo=$(basename "$repo_root")
branch=$(git -C "$repo_root" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

record=$(printf '%s\n' "$payload" | jq -ce --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg mode "$MODE" --arg repo "$repo" --arg branch "$branch" --arg root "$repo_root" '
  select(type == "object") |
  select((.tool_input.command // "" | tostring | test("mem-capture\\.sh|mem-query")) | not) |
  . as $p | (.tool_input // {}) as $i |
  (if (.tool_response | type) == "object" then .tool_response else {} end) as $r |
  (.is_interrupt == true) as $interrupted |
  ($r.exit_code // $r.exitCode // $p.exit_code // null) as $exit |
  ($interrupted or .hook_event_name == "PostToolUseFailure" or .is_error == true
    or $r.is_error == true or ((.error | type) == "string" and .error != "")
    or (($exit | type) == "number" and $exit != 0)) as $failed |
  {ts:$ts, schema_version:2, session_id:(.session_id // ""), repo:$repo, branch:$branch} +
  if $mode == "session" then
    {kind:"session_end", classification:"discovery",
     reason:(if (["logout","clear","prompt_input_exit","other"] | index($p.reason)) != null then $p.reason else "other" end)}
  else
    select((.tool_name | type) == "string" and .tool_name != "") |
    ($i.file_path // $i.notebook_path // "") as $file |
    ($i.command // "" | if type == "string" then . else "" end) as $command |
    ($command | [capture("^\\s*(?<name>[A-Za-z0-9_-]+)(?:\\s|$)").name][0] // "") as $program |
    {kind:"tool", tool:.tool_name,
     classification:(if $failed then "blocker"
       elif .tool_name == "Write" and $r.type == "create" then "create"
       elif (["Write","Edit","NotebookEdit"] | index($p.tool_name)) != null then "change"
       else "discovery" end),
     files:(if ($file | type) != "string" or $file == "" then []
       elif ($file | startswith($root + "/")) then [$file | ltrimstr($root + "/")]
       elif ($file | startswith("/")) or ($file | split("/") | index("..")) != null then []
       else [$file] end),
     command_category:(if (["git","npm","pnpm","yarn","bun","node","python","python3","pytest","shopify","theme-check","rg","ls","cat","sed","jq","curl","rtk"] | index($program)) != null then $program
       elif $command != "" then "other" else null end),
     exit_code:(if ($exit | type) == "number" and $exit == ($exit | floor) then $exit else null end),
     error:$failed, interrupted:$interrupted,
     status:(if $interrupted then "interrupted" elif $failed then "error" else "success" end)}
  end' 2>/dev/null) || exit 0

mkdir -p "$STORE_DIR" 2>/dev/null || exit 0
chmod 700 "$STORE_DIR" 2>/dev/null || exit 0
[ ! -L "$STORE_DIR" ] && [ ! -L "$OUT" ] || exit 0
touch "$OUT" 2>/dev/null && chmod 600 "$OUT" 2>/dev/null || exit 0
printf '%s\n' "$record" >> "$OUT" 2>/dev/null

exit 0
