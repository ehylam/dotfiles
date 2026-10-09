#!/usr/bin/env bash
# Stop hook: refuse a turn that produced no user-visible text.
#
# This is the guard for the empty-response failure mode. Exit 2 blocks the stop and
# feeds stderr back to the model; exit 0 lets it stop.
#
# Loop safety is the whole design here. Claude Code sets stop_hook_active=true on a turn
# that a Stop hook already continued, so we bail immediately in that case. Without that
# check a silent model and a strict hook deadlock forever.
#
# WHY THE SCAN WINDOW IS THE WHOLE TURN, NOT THE LAST ENTRY:
# Claude Code writes ONE content block per assistant entry, never a bundle. Measured on a
# real transcript 2026-09-16: 481 assistant entries, every one holding exactly 1 block
# (146 text, 121 thinking, 214 tool_use). So "the last assistant entry" is a single block,
# and whenever a turn ended on a tool_use or thinking block the old version scored it 0 and
# fired, even when the same turn had emitted hundreds of words. That false positive forced a
# pointless re-emit and burned tokens on most turns. Sum across every assistant entry back to
# the user message that opened the turn. A `user` entry carrying a tool_result is part of the
# turn, not a boundary: only a real user message ends the window.

set -uo pipefail

payload=$(cat 2>/dev/null) || exit 0
[ -n "$payload" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

# The payload's last_assistant_message is the authority. The transcript is written
# asynchronously and can lag the Stop hook: on 2026-10-01 a turn's only text landed in the
# file 89ms before the block did, so a transcript-only scan read zero and fired falsely.
# Docs: "use last_assistant_message on Stop and SubagentStop instead of reading the transcript".
# Parse once; only primary, non-recursive stops without visible text need a scan.
# Never fire twice in a row. stop_hook_active is the loop breaker: do not remove it.
transcript=$(printf '%s\n' "$payload" | jq -er '
  select((.hook_event_name // "Stop") == "Stop") |
  select(((.stop_hook_active // false) | tostring) != "true") |
  select((try ((.last_assistant_message // "") | test("\\S")) catch false) | not) |
  .transcript_path // empty
' 2>/dev/null) || exit 0

# Field empty or missing (older Claude Code): fall back to scanning the turn, which still
# catches text written earlier in a turn that ended on a tool call.
[ -n "$transcript" ] && [ -r "$transcript" ] && [ -s "$transcript" ] || exit 0

# Walk backwards, summing visible text over the current turn. One jq pass, not one per line,
# so this stays cheap on long transcripts. Thinking and tool_use blocks are deliberately NOT
# counted as visible output.
# tac is GNU coreutils; BSD tail -r is the macOS built-in. With neither, allow the stop
# rather than score an empty stream as "no text".
if command -v tac >/dev/null 2>&1; then reverse() { tac "$1"; }
elif tail -r /dev/null >/dev/null 2>&1; then reverse() { tail -r "$1"; }
else exit 0
fi

visible=$(reverse "$transcript" 2>/dev/null | jq -n -r '
  reduce inputs as $e (
    {sum: 0, stop: false, assistant: false};
    if .stop then .
    elif $e.type == "user" then
      # tool_result keeps us inside the turn; anything else is the turn boundary
      if ([ ($e.message.content // [])[]? | select(.type == "tool_result") ] | length) > 0
      then .
      else .stop = true
      end
    elif $e.type == "assistant" then
      .assistant = true |
      .sum += ([ ($e.message.content // [])[]? | select(.type == "text") | .text ]
               | add // ""
               | gsub("^\\s+|\\s+$"; "")
               | length)
    else .
    end
  ) | if .assistant then .sum else empty end
' 2>/dev/null)

# Read or parse failed: say nothing and allow the stop.
[ -n "${visible:-}" ] || exit 0
echo "$visible" | grep -qE '^[0-9]+$' || exit 0
[ "$visible" -gt 0 ] && exit 0

cat >&2 <<'MSG'
This task ended without a visible response. Give a short result or name the blocker.
Report only verified work. Do not add filler, repeat prior replies, or claim completion
without evidence.
MSG
exit 2
