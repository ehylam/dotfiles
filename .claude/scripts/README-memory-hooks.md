# Deterministic memory capture + session guards

Added 2026-09-11. Replaces the need for a conversational observer agent to log what
happened, and guards the empty-response failure mode.

## What was wired

| Event | Script | Blocking? |
|---|---|---|
| `PostToolUse` `*` | `mem-capture.sh tool` | async, always exit 0 |
| `PostToolUseFailure` `*` | `mem-capture.sh tool` | async, always exit 0 |
| `PostToolUse` `Edit\|Write` | `theme-check-hook.sh` | exit 2 on theme-check errors |
| `SessionEnd` | `mem-capture.sh session` | no |
| `Stop` | `theme-check-hook.sh stop` | exit 2 on queued Liquid errors |
| `Stop` | `git-handover-check.sh` | no, advisory `systemMessage` |
| `Stop` | `require-visible-output.sh` | **exit 2 blocks an empty turn** |

Store: `~/.claude/state/mem/YYYY-MM.jsonl`, one JSON object per line.
Query: `~/.claude/scripts/mem-query.sh` or the `/mem-query` skill.

## Capture semantics

Successful `Write`, `Edit` and `NotebookEdit` calls use `classification:"change"`.
Only a successful `Write` with structured `tool_response.type:"create"` uses
`classification:"create"`. Post-tool file existence cannot distinguish creation
from replacement, and neither operation establishes feature or bugfix intent.
Other completed tools retain the coarse `discovery` bucket; this does not prove a
Bash command was read-only.

`PostToolUseFailure` captures executed tool failures using the documented top-level
`error` and optional `is_interrupt` fields. Records use `classification:"blocker"`,
`error:true`, and `status:"error"` or `status:"interrupted"`. Successful records use
`status:"success"`. Structured legacy `is_error` flags and nonzero structured exit
codes are also recognised. Tool response strings do not need an object shape for
successful read capture.

Schema 2 stores metadata only: timestamp, repo, branch, session ID, tool name,
repo-relative file paths, classification, status, interruption flag, an allowlisted
command category and a structured numeric exit code when available. It does not
store command arguments, environment assignments, prompts, search patterns, URLs,
responses or freeform failure text. Commands prefixed with assignments or wrappers
use `other` unless their first program is allowlisted. Paths outside the current
repo are omitted. Session-end reasons use a fixed allowlist. Directory permissions
are `700` and monthly file permissions are `600`, including existing current files.
Capture skips symlinked stores and monthly output files.

Coverage is best effort. Failure hooks exclude pre-execution validation failures
and permission denials. Claude's docs also say cancelling a running tool does not
fire this hook, so `is_interrupt` records only interruptions actually delivered in
a hook payload. Async timing, shutdown, missing `jq` or an unwritable store can
lose events. Existing JSONL records retain their old classifications; they are
not evidence of feature or bugfix intent and are not rewritten.

Inspect failure status and exit codes with
`mem-query.sh --all-repos --class blocker --raw`. `--grep` searches metadata and
file paths. Queries skip malformed JSONL rows and group sessions by both session
ID and repo. Raw and summary modes sort records by timestamp; file and session
aggregations avoid that sort, with session bounds computed from minimum/maximum
timestamps. All JSONL files remain eligible because legacy filenames do not
reliably describe their timestamps. `--raw` projects legacy rows onto the current
metadata schema, so previous command, URL and failure-text fields are not returned.
Legacy files still contain their original text on disk; this is not a migration.
Schema reference: [Claude hook inputs](https://code.claude.com/docs/en/hooks#posttoolusefailure-input)
and [structured tool output](https://code.claude.com/docs/en/hooks#posttoolbatch-input).

## Why this exists

`claude-mem` is already hooks-driven (`PostToolUse` -> `worker-service.cjs hook
claude-code observation`). The hooks were never the problem. The friction came from the
headless Claude session that worker spawns to turn tool output into prose: when a turn had
nothing novel, it had no defined fallback and emitted nothing, producing the 120 empty
responses and 105 no-visible-output events.

That prompt lives in `~/.claude/plugins/cache/thedotmack/claude-mem/<version>/`, which is
replaced on every plugin update, so patching it there is not durable.

This capture is independent: no model, no second session, nothing to stall. It records
**what** happened. It deliberately does not record **why** - that stays with `claude-mem`
or the `/observe` skill, and `type="none"` is now an explicit valid answer there.

The model-backed claude-mem plugin is disabled by default. Deterministic capture remains
active and asynchronous; `/observe` is available when a written observation is useful.

## Rollback

**Everything at once** (restores the exact pre-change settings):

```bash
cp ~/.dotfiles/.claude/settings.json.bak-preinsights ~/.dotfiles/.claude/settings.json
bash ~/.agents/skills/sync-llm/scripts/sync-llm.sh --apply
```

**Just the visible-output Stop guard**, leaving capture running:

```bash
jq 'del(.hooks.Stop[].hooks[]? | select(.command|test("require-visible-output")))' \
  ~/.dotfiles/.claude/settings.json > /tmp/s.json && mv /tmp/s.json ~/.dotfiles/.claude/settings.json
bash ~/.agents/skills/sync-llm/scripts/sync-llm.sh --apply
```

**Just the theme-check hook** (if it proves too slow in practice):

```bash
jq 'del(.hooks.PostToolUse[] | select(.hooks[]?.command | test("theme-check-hook"))) | del(.hooks.Stop[] | select(.hooks[]?.command | test("theme-check-hook")))' \
  ~/.dotfiles/.claude/settings.json > /tmp/s.json && mv /tmp/s.json ~/.dotfiles/.claude/settings.json
bash ~/.agents/skills/sync-llm/scripts/sync-llm.sh --apply
```

Tuning instead of removing:
- `THEME_CHECK_THROTTLE=120` is the default scan window. Stop flushes pending edits.
- `CLAUDE_MEM_DIR=/some/path` relocates the store.

The data is local JSONL and is never read at startup. Keep it outside Git, cloud
sync and client deliverables. Repo names, branches and filenames can still contain
client information. Review retention monthly; three months is a reasonable default
for recent-work queries, with longer retention only for a specific need. Review
monthly filenames before deleting older files. Existing pre-schema-2 files can
contain credentials or client text and should be removed when no longer needed.
No automatic deletion or rewriting of historical files is performed.

## Loop safety

`require-visible-output.sh` exits 0 immediately when `stop_hook_active` is true. That is
the only thing preventing a deadlock between a silent model and a strict hook. Do not
remove that check. It also allows the stop on any unparseable payload, missing transcript,
or absent `jq`, so a broken environment fails open rather than trapping the session.

The visible-output guard only handles primary `Stop` events. It allows worker exits,
API failure events, empty/unwritten transcripts and turns with no assistant entry.
Existing visible text allows completion even when the last entry is a tool call. A
genuinely silent assistant turn gets one short result/blocker request, without the old
observer no-op or filler instruction.

## Verified 2026-09-11

- Historical classification checks used file existence and labelled edits `bugfix`.
  Those labels did not establish intent and are superseded by the checks below.
- Stop guard: visible text allows, thinking+tool-only blocks, whitespace-only blocks,
  `stop_hook_active` allows, missing transcript allows, garbage payload allows
- theme-check: skips non-Liquid, skips Liquid outside a theme, finds a nested theme root
  (`<repo>/theme/config/settings_schema.json`), reports real filenames and error codes,
  second call inside the scan window throttled
- git-handover-check: silent on a clean level repo with a PR; reported dirty counts,
  unpushed commits and a missing PR across several theme repos

## Verified 2026-10-03

`python3 .claude/scripts/test_memory_capture.py` writes only to a temporary store.
It checks successful string responses, new/existing file metadata, neutral edits,
failure/interruption status, command categories, secret omission, private permissions,
invalid-input skips, session capture and async wiring for both post-tool events.
`python3 .claude/scripts/test_mem_query.py` checks temporary fixtures for malformed
rows, legacy secret omission, spaced paths, filters, chronological ordering,
cross-repo session grouping and invalid options. Neither test reads the live memory
store or proves live hook delivery. `bash -n` checks both scripts' shell syntax.
Existing vendor hooks remain alongside capture; no model-backed observer is added.
