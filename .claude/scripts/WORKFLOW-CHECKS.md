# Explicit workflow checkpoints

`workflow-check.py` checks recorded prerequisites and artifact hashes. It does not
classify prompts, verify semantic truth, approve actions or spawn workers. Shared
skills decide when a task needs a checkpoint and prepare it explicitly.

Use the `SessionStart` hook output to obtain the runtime, session identity and
state path. Copy those identities into a task JSON file outside the repository.
The record enables only the requirements it contains; each mode is optional.

```sh
python3 ~/.dotfiles/.claude/scripts/workflow-check.py prepare \
  --record /tmp/task.json --state /tmp/path-from-session-start.json
python3 ~/.dotfiles/.claude/scripts/workflow-check.py check \
  --state /tmp/path-from-session-start.json
python3 ~/.dotfiles/.claude/scripts/workflow-check.py final \
  --state /tmp/path-from-session-start.json
python3 ~/.dotfiles/.claude/scripts/workflow-check.py complete \
  --state /tmp/path-from-session-start.json
python3 ~/.dotfiles/.claude/scripts/workflow-check.py abandon \
  --state /tmp/path-from-session-start.json --reason 'Preview unavailable; after measurements could not be captured'
```

`prepare` validates before prerequisites, records CSS prerequisite hashes and activates
the task. Without `--state`, it derives and prints a temporary state path from
runtime, session ID and agent ID. `check` revalidates prerequisites and requires
the CSS file to still match its measured baseline. `final`
requires after evidence and reviewer results. `complete` performs the same final
check, then records a passed outcome and deactivates the task. Generate the
planned output files before completion. A separate `final` is optional diagnostic
work; `complete` already runs it. If the task is genuinely blocked or cannot be
reviewed, `abandon --reason` preserves the blocker, records an abandoned outcome
and deactivates it without claiming checks passed. It does not run final checks.

To revise a plan, edit the original task JSON and run `prepare` again for
the same task and identity. This renews CSS hashes and prerequisites. Draft edits
use the targeted `recheck` described below, without preparing again. Another
task cannot replace an active task. After a CSS edit, old before measurements
cannot authorise another constraint change. Capture fresh before measurements
and prepare again for the same task to renew that baseline. Final permits the
changed file when after measurements match its current hash. Do not edit the
generated state record.

Example task record, with all optional modes shown:

```json
{
  "runtime": "codex",
  "session_id": "copy-from-session-start",
  "agent_id": "main",
  "task": "hero-width",
  "delegation": {
    "mode": "parallel",
    "reason": "An independent visual review can check the fix",
    "workers": [{
      "id": "visual-review",
      "scope": "Read the hero evidence only",
      "deliverable": "Report constraint and spacing findings",
      "stop": "Stop after one comparison",
      "prompt": "Read the hero evidence only. Report constraint and spacing findings. Stop after one comparison.",
      "result": "/tmp/visual-review.md"
    }]
  },
  "css": [{
    "file": "/absolute/path/to/hero.css",
    "selector": ".hero",
    "properties": ["max-width"],
    "expected": "The hero stays at its designed maximum on desktop",
    "design": {
      "source": "https://www.figma.com/design/example",
      "intent": "The approved frame caps the hero at 400px"
    },
    "before": {
      "element": "/tmp/hero-before.json",
      "parent": "/tmp/container-before.json"
    },
    "after": {
      "element": "/tmp/hero-after.json",
      "parent": "/tmp/container-after.json"
    }
  }],
  "client": {
    "draft": "/tmp/client-draft.md",
    "market": "AU",
    "scope": "AU guest desktop preview",
    "claims": [{
      "text": "The hero now follows the approved desktop width.",
      "source": "/tmp/hero-qa-report.md",
      "market": "AU",
      "status": "verified"
    }],
    "review": "/tmp/client-review.json"
  }
}
```

For solo work, use `{"mode":"solo","reason":"One local change"}` and omit
workers. Assign bounded scope, deliverable and stopping conditions without exact
prompt matching. Collect results through native agent tools before completing;
there is no duplicate review of each worker. Risky changes can explicitly require
one review via a top-level `reviews` array, with `artifact`, `scope` and `review`
fields. A task may contain only `reviews`. Factual client drafts use `client.review`
instead; do not register that same review twice.

CSS measurement artifacts wrap actual browser evidence:

```json
{
  "file_sha256": "sha256-of-css-file-at-measurement-time",
  "selector": ".hero",
  "measurement": {"width": 400, "maxWidth": "400px"}
}
```

Record element and parent evidence separately, including the viewport and
parent layout properties needed to judge the constraint. Each measurement must
include a finite, nonnegative numeric `width` or `height`; a label such as
`"checked"` does not count as a measurement. Geometry presence does not establish
that it matches the recorded design intent. The element selector
must match the target; the parent artifact identifies the measured parent.
Before proofs must match the baseline file hash. After proofs must match the
current file hash. A local design source is hash checked; a URL requires explicit
extracted intent and is not fetched by this script.

Compute an artifact hash with the standard library:

```sh
python3 -c 'import hashlib,pathlib,sys; print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())' /tmp/client-draft.md
```

Review artifacts bind one independent review to the final artifact:

```json
{
  "artifact_sha256": "sha256-of-reviewed-draft-or-result",
  "scope": "AU guest desktop preview",
  "reviewer": "independent-reviewer",
  "verdict": "pass",
  "notes": "Each claim was compared with its cited evidence and scope",
  "unresolved_material": []
}
```

Scope equals the registered review or client's scope. Supply the draft, audience,
all relevant files and successful command outputs in one handoff. Claim text is a
description of a material fact, not an exact quote. Optional `client.evidence`
lists extra evidence paths such as template JSON. Extra evidence is welcome;
there is no exact evidence hash map.
A reviewer checks claim entailment, completeness, market,
customer/theme qualifiers and house writing style. Evidence presence alone does
not establish truth. Each listed claim must have a description and source,
matching market and status `verified` or `proposed`. A nonfactual draft can use an
empty claims array. `market` can be one name or an explicit array such as
`["AU", "US"]`; each claim's market or markets must be within that recorded set.
The reviewer still checks evidence for every claimed market.
Use independent review for factual client and PM drafts and risky changes.
The reviewer reports blocking items (factual errors, missing material facts and
unqualified claims) separately from optional suggestions. Pass when no blocking
items remain. Explicitly flag inferred rates, "always"/"never" and extrapolations
from samples: successful samples prove those samples, not the broader claim.
Read the source thread and ask what recent change or comment could contradict the
draft. Reread as the recipient for tone and leaked internal AI/tool names.
Use one full review and at most one follow-up of changed lines, reusing the same
reviewer with a diff and affected evidence. Apply explicit reviewer-suggested
fixes directly, without another review merely to approve those exact fixes.
If material issues remain after the follow-up, report the blocker; the round
limit does not authorise delivery. Optional suggestions go to the user without
another review loop. Use the runtime's available result tools: Codex has native
agent waiting; Claude may deliver background task notifications or expose
TaskOutput. Do not assume a native wait tool exists in every runtime. No
pending-agent IDs, duplicate result collection or sleep/file polling loops.

Keep one hash in the review record. After a pass, changed wording needs a targeted
check rather than another full review. Record that check and refresh the hash:

```sh
python3 ~/.dotfiles/.claude/scripts/workflow-check.py recheck \
  --record /tmp/client-review.json --artifact /tmp/client-draft.md \
  --change-kind wording --checked-by main \
  --reason 'Checked changed lines; facts and essential qualifiers are preserved'
```

For factual changes, use `--change-kind factual --checked-by <independent-reviewer>`
after that reviewer has checked affected claims. Theme names, timing, instructions,
qualifications and changed supporting evidence are factual changes, even when
small. `--author` defaults to `main`; supply the actual author when different.
This records an attestation of a completed check; it does not run one. It retains
the independent review and adds check notes in the same file. To record exact
reviewer-prescribed corrections, use `--change-kind suggested-fixes --checked-by
main` with a reason describing the applied fixes. This requires a completed
review (`verdict: changes` or `pass`) with each unresolved material finding a JSON
object containing the reviewer's `suggested_fix`. It retains those findings in
`addressed_material`, clears `unresolved_material` and records a pass. Use this
only after applying and checking every prescribed fix, without new factual
changes. Other material findings need the targeted independent follow-up.
The hook blocks missing required reviews, unresolved material issues and changes
without a recorded check when the response claims completion or delivers the
registered draft. A recorded wording check
after a pass does not require another independent review. CSS requirements stay
unchanged. Legacy worker review, pending-agent and evidence-hash fields are ignored.
Evidence freshness and whether an edit preserves meaning are reviewer/author
responsibilities, not semantic checks performed by the hook. Changed evidence
requires a targeted independent check even when the draft is unchanged; record
that check with `recheck --change-kind factual`.
Simple nonfactual acknowledgements need only a direct style and scope reread,
without activating a checkpoint. When included in an already activated task,
acknowledgements need the deterministic style check
and `"reread": true` in the client record, without an independent review artifact.
The reread flag is an author attestation. Claim coverage and whether proposed
claims are phrased honestly remain reviewer responsibilities.

The deterministic draft check rejects em dashes and a small set of stock or
instruction-leak phrases. It imposes no word limit and does not reject legitimate
product prices. The reviewer still checks estimates, costs and broader style.

Hook wiring uses one dispatcher for `SessionStart`, `PreToolUse` and `Stop`:

```sh
python3 "$HOME"/.dotfiles/.claude/scripts/workflow-check.py hook --runtime claude
python3 "$HOME"/.dotfiles/.claude/scripts/workflow-check.py hook --runtime codex
```

Match structured edits and delegation: `Edit|Write|apply_patch|Agent|Task|spawn_agent`.
Codex reports `apply_patch` with the patch in `tool_input.command`, including
nested code-mode calls. Claude Edit/Write use their structured file arguments.
The CSS gate compares declarations of recorded properties in registered files;
it detects changes and removals, including multiline update hunks. It does not
parse CSS semantics or selector ownership. Do not rely on it for CSS hidden in
arbitrary JavaScript or Liquid strings.

No active matching record means silent hooks. Worker/session identities remain
separate. Stop checks only an active root record when the last reply contains a
completion/delivery phrase or the registered draft. Waiting/status replies and
ordinary unrelated replies stay quiet, including while a background reviewer is
running. An explicit latest `/time-entries` request also
allows that unrelated reply's completion wording; delivering the registered
draft still triggers validation. Only the latest user request counts, and
tool-result entries are ignored. It prefers `last_assistant_message`; older payloads use at most 128 KiB
of the transcript tail, accepting Claude text and Codex final message shapes.
There is no authoritative running-reviewer registry in these hook payloads, so
this is response gating, not live agent detection. Completion language can still
produce a false positive for an unrelated task; unusual delivery phrasing can
be missed. Always run strict `complete` before delivery: `final` and `complete`
validate all requirements regardless of response text or running agents. Stop
honours `stop_hook_active` on the continuation and does not require filler or a
second visible response. State survives compaction and is temporary, so missing
state disables it.

Shell writes, interactive processes, external editors and specialised tool paths
can bypass structured-edit hooks. Final hashes detect stale after evidence for
registered files, but do not prove measurements preceded every edit. Records and
review artifacts are agent-writable. These are workflow guardrails, not a security
or semantic verification boundary. Source files named `.env*` are refused.

New or changed non-managed Codex hooks need trust through `/hooks` before they
run. Synthetic payload tests establish script behaviour, not runtime activation.
Never rewrite trust or approval state to bypass that review.

Append new hook groups after existing groups where possible. Codex identifies
hooks by their source and position, so inserting a group can invalidate trust for
unchanged hooks. Keep the existing order when adding a guard.

Run the isolated check:

```sh
python3 ~/.dotfiles/.claude/scripts/test_workflow_check.py
```
