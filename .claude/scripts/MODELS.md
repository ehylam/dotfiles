# Model choices for agency work

Cost-focused shortlist, checked 3 October 2026 against the OpenRouter catalogue
and tau2-Bench Airline leaderboard. These are current family versions and
provisional choices, not measured Shopify winners. Expensive Fable, Opus and GPT
models are excluded from the experiment defaults and default OpenRouter picker.
Use Ctrl-s then m to select models. Ctrl-s, Space, w, h opens this guide.
For routine client work, use Ctrl-s, Space, c for Fix, Review, QA and Handover;
see [Support Workflow](SUPPORT-WORKFLOW.md). Model comparisons are optional.

| Work | Suggested OpenRouter model | Starting effort |
|---|---|---|
| Daily Liquid/theme work, JavaScript/CSS, tests, client drafts | anthropic/claude-sonnet-5.5 | Medium |
| Independent correctness review | google/gemini-3.8-flash | Medium |
| Budget read-only review, accessibility and test gaps | z-ai/glm-5.3 | Low |
| Budget alternative for read-only review and research | stepfun/step-3.7-flash | Medium |
| Research intake from documents, recordings and screenshots | google/gemini-3.8-flash | Medium |

GLM 5.3 replaces the older GLM 5 comparison entry. Step 3.7 Flash and Sonnet 5.5
are the latest versions of their shortlisted families; Gemini 3.8 Flash replaces
3.7 Flash. The newer Gemini scores 71.3% on Airline versus 78.5% for 3.7, so a
version upgrade is not evidence of improved quality on this benchmark.
Airline measures policy/tool execution, not Shopify coding correctness.

The GLM 5.3 DigitalOcean row reports 76.0%, US$0.016/task and 42 seconds; default
GLM routing reports 76.2%, US$0.069/task and 2.7 minutes. Our configurations use
default routing, not a DigitalOcean pin, so they do not reproduce that cheaper
provider result. Judge cost per accepted result, including retries and missed
defects, before assigning a production winner.

Managed sessions keep Sonnet as the only scoped Build writer; the other three
models are available for read-only roles. The review planner defaults to Gemini
for correctness and GLM for accessibility. GLM supports low/high/max effort;
the comparison harness maps its medium comparison preset to high, and managed
sessions do the same for an explicit medium override.

Keep the current model for a simple follow-up. Escalate after a reproducible failure,
conflicting evidence or a difficult reasoning problem. A second reviewer is useful
for high-risk changes, but its findings still need tests or source evidence.
For client writing, verified market/theme facts and house style matter more than
extra reasoning. Higher effort can increase latency without improving the answer.

Choose browser/Figma QA tools separately. Screenshot understanding does not supply
Playwright, native Safari, an iOS simulator, Figma access or measured pixel parity.
Check tool availability in the selected runtime before sending a task brief.

Picker tabs share the caller's checkout and do not enforce read-only access or
one writer. Use them for read-only comparisons, or prepare separate worktrees
for additional writers. The picker header states this constraint.

The picker defaults to the four shortlisted OpenRouter models and three active
workers, intersected with OpenCode's available catalogue. It accepts another
provider or an explicit full-catalogue override, for example:

    ~/.config/herdr/openrouter-picker.sh all
    ~/.config/herdr/openrouter-picker.sh openrouter 4

These change only that launch, preserving global defaults. Models run through
OpenCode; your Claude Code/Codex subscription and session settings are separate.
The daily batch currently seeds Claude and checks its named MCP servers. Starting a
different model does not reuse that Claude-specific readiness proof.

Reasoning settings are provider/model-specific. Gemini and Step list low, medium
and high; Sonnet also supports xhigh/max; GLM lists low/high/max. Verify OpenCode's
supported variants before changing effort. OpenRouter's advertised tool interface
needs a real host/provider test before relying on it. The isolated native host
configurations passed a localhost mock check;
that proves request settings and host tool execution, not real model quality.
Bounded paid managed-session trials have now run; they do not establish production winners.

## Managed-session trials

On 3 October 2026, Sonnet 5.5 and Gemini 3.8 Flash reviewed four small synthetic
Swiper controls twice in fresh OpenCode 1.18.34 sessions at low effort. Fifteen of
sixteen assignments completed as bounded JSON; one Sonnet repeat failed with an
Anthropic HTTP 400 rejecting a thinking-only intermediate assistant message.
The controller rejected that result and stopped; it was not retried or counted
as correct. Treat this host/provider combination as experimental until that
interoperability failure is resolved. Do not upgrade the pinned host or bypass
its permissions/completion checks without a fresh audit.

Every completed reply correctly classified its seeded bug/non-bug case, with no
false-positive findings. That narrow result is not a complete quality pass: one
Sonnet reply exceeded its content-word budget, and both models supplied weaker
or unsupported details in some explanations/checks. Count JSON string contents,
not whitespace in compact JSON, when judging a prose budget.

Source-only review and supplied QA evidence were tested separately. A live
API-client manual-chat/return/rebrief cycle invalidated old review evidence after
an acceptance change with unchanged source. The fresh review kept QA blocked;
it did not claim Figma parity or native Safari coverage. These tests do not prove
human-operated TUI behaviour, production Shopify rendering or a general model
ranking. Global model defaults remain unchanged. The coordinator still decides
what to dispatch, relay and accept; there is no unattended build pipeline.

A subsequent bounded Herdr trial exercised real attached Build and Review TUIs
through terminal text and Enter, not HTTP prompt submission. Both replied in the
registered sessions; explicit manual return advanced the decision revision,
rejected old evidence and preserved the approved note after a no-change return.
This proves the attached terminal input/rendering path, not human usability or
model-written implementation. Only synthetic source was used; the four-turn trial
left it unchanged and stopped its backends and tabs.

A credential-free replay through the pinned host reproduced the HTTP 400 path:
signed reasoning plus a tool-finish with no actual tool call produces a subsequent
thinking-only assistant message. Normal tool completion and reasoning with final
text passed controls. The original upstream stream was not captured, so this does
not establish why that real response took the malformed path or fix the adapter.
The controller now reports a validated HTTP status without exposing error bodies.
The newer provider SDK major targets AI SDK 7, not this host's AI SDK 6; it is not
a drop-in upgrade.

A subsequent credential-free proof added a small public LanguageModel v3 stream
guard without modifying the provider SDK. Eleven adapter cases, eight pinned-host
replays and eight wrapper checks passed. A tool-call finish with no actual tool
call now fails before a thinking-only continuation; signed reasoning, healthy
tools, usage and cancellation remain intact. This is containment, not recovery
of the original failed assignment. The reusable guard and focused tests live in
`openrouter-stream-guard.mjs` and `test_openrouter_stream_guard.mjs` beside this
guide. It is not enabled in managed-session defaults or the current human chat
trial. New managed runs can opt in with `prepare --stream-guard`, then explicitly
run `install-provider <run>` before serving. Dependencies are pinned and isolated
inside the run; source/dependency changes fail the runtime-policy check. One
guarded synthetic real-provider Build/Review cycle completed with required fresh
reads, one scoped Build write, source-only Review and 139 coordinator checks on
the inspected, hash-frozen candidate. The owned backends stopped and the temporary
key copy was removed. This is one healthy cycle, not a reliability-rate measurement
or recovery of the original failure. The malformed case remains rejected in
localhost replay; default activation remains unchanged.
Evidence: `/private/tmp/dc-outstanding-20261003/provider-result.md`.
Integration/live evidence: `/private/tmp/dc-provider-integration-20261003/report.md`.

A separate four-assignment synthetic code cycle used Sonnet Build and Gemini
Review with only one writable JavaScript file and an immutable contract.
Build implemented a deliberately staged helper; Review identified its pending
empty-collection requirement; Build revised it; fresh source review found no
remaining issues. The coordinator's 139-case full-contract check passed, including
safe-integer edges, positive zero and invalid inputs. Actual write/edit tools,
three exact final-text relay links, read-only handoffs and unapplied patch export
were recorded. All handoffs stayed within their content-word budgets and retained
`testsRun: false`. This establishes that bounded code-feedback path, not a blind
defect-finding score, real UI acceptance or general model ranking.
Independent inspection found no helper defect, but later turns omitted some
requested rereads and the initial Review did not explicitly label the missing
requirement as deliberate staging. Their unchanged prior context was available;
these remain instruction/communication limits, not a fully compliant delivery.

A four-assignment synthetic visual cycle then exercised Gemini design intake,
Sonnet's two CSS edits, Gemini source review and a fresh Gemini supplied-QA review.
All requested reads and bounded final JSON deliveries were recorded. Coordinator
inspect measurements, matching-geometry pixels in default/middle/focus states
and 54 Chromium interaction states passed at three viewports. Native Safari
default-state smoke/pixels passed; Mobile Safari could not create an automation
session and native Safari input journeys were not run. The QA reviewer correctly
kept overall acceptance blocked and testsRun:false. This is reference-site fixture
evidence, not NPFG/Figma parity, native input proof or a new model ranking.
An ambiguous Next-button width in the intake packet needed coordinator
clarification before Build. Exact selectors, variants and state belong beside
measurements. Index bulky raw QA separately while keeping required coverage and
unknowns in a frozen selected file; a smaller file does not establish cost savings.

To choose an actual winner, compare the same representative tasks in isolated
workspaces: a Liquid bug, a CSS constraint investigation, browser QA and a client
draft. Judge correctness, successful tool use, missed claims, elapsed time and total
usage. Do not change production defaults from one answer or a general leaderboard.

The reusable comparison uses the existing OpenCode CLI and Playwright MCP:

```sh
python3 ~/.claude/scripts/benchmark-models.py self-check
python3 ~/.claude/scripts/benchmark-models.py prepare
```

Both commands are free of paid inference. Actual tests require an approved US$5
allowance and a fresh, separate OpenRouter key with a credit limit of US$5 or less,
no reset, and BYOK usage included in that limit. Save only that key in
`/private/tmp/herdr-benchmark-openrouter.key` with permissions 600, then run:

```sh
python3 ~/.claude/scripts/benchmark-models.py check-key
python3 ~/.claude/scripts/benchmark-models.py run
```

The runner preserves global settings, prepares sixteen isolated cases, and uses
medium effort, a 4096-token output ceiling and eight tool-loop steps. It runs one
session at a time and checks provider usage between sessions, stopping at US$3.50
observed usage to leave a margin. The provider key limit controls further requests;
host token limits and cost estimates do not guarantee a total-dollar ceiling.
Unexpected billing, BYOK, timeouts or host/provider errors stop further runs.
It never purchases credits or changes your existing key.

Artifacts stay in a private temporary folder. OpenCode's step costs are estimates;
the report separately records OpenRouter account usage changes. Review each result
against the brief and evidence before ranking models. The cart assertion checks
logic independently; the other tasks require factual, design and style review.
Browser cases use the existing temporary browser benchmark dependencies and
headless Chromium. They do not establish native Safari/iOS behaviour.

Sources:

- OpenRouter catalogue: https://openrouter.ai/api/v1/models
- Sonnet evaluations: https://www.anthropic.com/claude-sonnet-5-5
- Airline benchmark: https://openrouter.ai/benchmarks/tau2-bench-airline#leaderboard
- Gemini: https://blog.google/innovation-and-ai/models-and-research/gemini-models/3-8-flash-and-3-8-flash-cyber/
- Host tool calls: https://openrouter.ai/docs/guides/features/tool-calling
