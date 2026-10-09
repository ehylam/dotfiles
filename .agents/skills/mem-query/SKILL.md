---
name: mem-query
description: Search and summarise the deterministic memory store of past sessions (what was touched, what broke, which files churn). Use when asked "what did I do on X", "what broke recently", "have we seen this before", or for a cross-repo activity summary.
---

# mem-query

Queries the hook-written JSONL store at `~/.claude/state/mem/YYYY-MM.jsonl`. Every record
is written deterministically by `mem-capture.sh` on `PostToolUse`,
`PostToolUseFailure` and `SessionEnd`, without a model-backed observer. Capture is
best effort, so an absent record does not establish that an event never happened.

## Run it

```bash
~/.claude/scripts/mem-query.sh                              # last 7d, current repo
~/.claude/scripts/mem-query.sh --days 30 --repo example-theme
~/.claude/scripts/mem-query.sh --all-repos --class blocker  # everything that failed
~/.claude/scripts/mem-query.sh --grep nosto --all-repos     # substring over detail + files
~/.claude/scripts/mem-query.sh --files                      # churn ranking
~/.claude/scripts/mem-query.sh --sessions                   # one line per session
~/.claude/scripts/mem-query.sh --raw | jq ...               # anything else
```

## Record shape

```json
{"ts":"2026-09-11T03:16:04Z","kind":"tool","session_id":"...","repo":"example-theme-827",
 "branch":"feat/827-reviews","cwd":"...","tool":"Edit","classification":"change",
 "files":["..."],"detail":"...","error":false,"interrupted":false,
 "status":"success","failure_reason":""}
```

`classification` records operations, not intent: completed `Write`, `Edit` and
`NotebookEdit` calls are `change`. Only a successful `Write` whose structured
response has `type:"create"` is `create`. Other tools use the coarse `discovery`
bucket, which does not establish that a Bash command was read-only. Captured
failures and interruptions are `blocker`; `status` distinguishes `error` from
`interrupted`, and `failure_reason` retains at most 500 characters of supplied text.
Older records may use `feature` or `bugfix`; neither label proves intent.

## Reading it well

- **Answer from the store, not from memory.** Run the query and cite what came back.
- Treat classifications as pointers to a tool, file and timestamp. Read the diff
  or git history before describing a feature, fix or refactor.
- `--class blocker --raw` includes captured error/interruption status and reasons.
  The default summary and `--grep` search input details/files, not failure reasons.
- Capture does not cover pre-execution validation failures or permission denials.
  Ordinary running-tool cancellation does not fire the failure hook. Async delivery,
  shutdown or a missing/unwritable store can also leave gaps. Do not call the store
  complete or count captured blockers as every failure in a session.
- The store says *what* happened. It does not say *why*. For intent, open the file or
  the git log the record points at.
