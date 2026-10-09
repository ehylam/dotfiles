---
name: agent-teams
description: Coordinate independent subagents for research, validation, debugging, testing, review, or implementation. Use when delegation is requested or complex work benefits from parallel investigation or independent verification. Keep small tasks and dependent steps in one session; file count alone does not trigger delegation.
---

# Agent Teams

Use a coordinator and the smallest useful set of workers when independent work will
materially improve speed or confidence. This applies across projects and task types.
Parallel tool calls are enough for small independent reads; keep short tasks and tightly
dependent steps in the main session.

## Choose The Work Split

For complex tasks, record the solo/parallel decision and its reason with
`~/.claude/scripts/workflow-check.py` before dispatch. Read `WORKFLOW-CHECKS.md` in
that directory for the task record and commands. Register each worker's objective,
allowed scope, deliverable and stopping condition. Small direct reads and simple
edits do not need a task record merely to justify staying solo.

Split by question, hypothesis, evidence source or verification responsibility. A market
or repository is only one possible boundary. Select useful workers, not a fixed roster:

| Task | Useful independent assignments |
|---|---|
| Research | Official API constraints; existing implementation or prior art |
| Debugging | Reproduce the failure; investigate different plausible causes |
| Validation | Check requirements/API assumptions; verify observed behaviour |
| Testing | Separate suites or journeys that use isolated state |
| Review | Correctness/security; accessibility/performance or test gaps |
| Implementation | Separate components/files with agreed interfaces |

The coordinator owns scope, dependencies, integration and the final response, and may
also implement. Usually start with one or two workers. Respect available runtime slots
and other active work; expand only for additional independent work. Only the coordinator
delegates. Reuse a worker for follow-up rather than creating another agent for each step.

## Dispatch And Collect

Use the current runtime's native subagent tools. Use persistent agent teams only when
workers need ongoing shared coordination. Do not start another multiplexer, install an
orchestrator, or create herdr panes merely to delegate. If delegation is unavailable,
state that and continue with the same checks in one session.

Each assignment includes the bounded question, relevant context/paths/ref, permitted
tools and changes, owned files/resources, dependencies, expected evidence and stopping
condition. Share only the context needed for that assignment. Keep the current model
unless there is an explicit reason to change it; use medium effort for routine research
or checks and high for ambiguous debugging or critical review when supported. Xhigh is
an explicit choice.

Research, debugging and review workers are read-only by default. For writes, give each
worker exclusive files or an isolated worktree; nobody else edits them until handback.
Do not run a reviewer or final verification against files still being edited: provide a
stable revision or wait for handback. Give browser workers separate pages/profiles and
isolated test data, or serialize access to a shared browser, cart, store or dev server.
Delegation never grants permission to push, deploy, publish or delete resources.

Workers return findings, source locations/URLs, exact checks and results, assumptions,
blockers and changed files where applicable. Keep raw logs/screenshots in artifacts.
An independent reviewer gets the requirements and stable diff, not the author's desired
verdict. For competing hypotheses, require evidence that supports or rules out each one.

The coordinator continues unassigned work, then collects every required result before
completion. Resolve conflicting findings using primary evidence, deduplicate them, and
re-run relevant checks after integration. A started agent or claimed pass is not proof.
If a worker fails, report the gap and finish its bounded work or mark it unverified.
Release only workers and browser resources created for this task. Return one coherent
answer with verified results and remaining gaps.

Before completing an activated task, run the checkpoint's final validation against
the returned worker evidence, then complete the record. Keep the private record
out of the final answer. Collect worker results using tools available in that
runtime: Codex native waiting, Claude task notifications or TaskOutput when
available. Do not assume every runtime exposes a native wait tool. Avoid
pending-agent IDs, duplicate collection and sleep/file polling. Worker results do not need a second review
artifact. Require independent review selectively for risky changes and factual
client and PM drafts, using one record for the artifact being assessed. Supply all
relevant evidence at dispatch. Split blocking factual errors, missing material
facts and unqualified claims from optional suggestions; pass without blocking
findings. Check extrapolated rates and "always"/"never", and read the source
thread for recent contradictory changes or comments. Use one full review and at
most one follow-up of changed lines with the same reviewer and a diff. Apply
explicit reviewer-prescribed fixes without another review merely to approve
those fixes. Still-unresolved material findings block delivery regardless of the
round limit. Report optional suggestions without repeated full reviews.
Bounded prompts need not match task record text exactly. The checkpoint checks
required reviews and CSS prerequisites; the
coordinator still resolves whether the evidence supports the conclusion.
