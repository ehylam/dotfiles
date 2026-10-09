---
name: client-drafts
description: Write concise client replies, scopes, handovers, release notes and non-technical PR descriptions using verified facts and Australian English. Use when drafting or editing for a merchant, PM, delivery lead or reader outside the dev team.
---

# Client-Facing Drafts

## Establish The Brief

Use the audience, length and specific change supplied in the request or session. Do
not quote the brief back or add an intake preamble. If a material detail is missing,
ask one short question; otherwise use the reader established in context and include
enough detail to answer their question. Do not assume a named delivery lead or merchant
audience. When a delivery lead will forward the reply, keep forwardable copy and any
useful internal notes separate.

## Check Claims Before Writing

For factual client drafts, collect sources for a private task record through
`~/.claude/scripts/workflow-check.py`. Read `WORKFLOW-CHECKS.md` in the same
directory for the commands and record format. Save and prepare the exact draft
before review and return. Reuse session evidence rather than repeating checks,
and keep artifacts in a temporary or ignored location.

Reuse the evidence already in the session. For each material claim, identify its
source and scope internally: commit/diff, task, observed behaviour or deployment
record. A task describes intent; a commit proves implementation; a browser check
proves behaviour only for the state tested. Code or a preview alone does not prove
deployment.

Open the actual source result, including the query input, success/failure and returned
records or rendered state. A cited command without its result does not prove a claim.
Brief paraphrases establish reported intent only; trace them to the original comment
for quoted requests. An empty or failed query cannot prove absence, and one sample
supports a scoped statement about that sample, not a universal rule. Use actual dates
and measurements for deadlines or timings; omit unsupported precision.

If a missing fact affects the reply, make a targeted read-only check of relevant
git/source, task details or the authorised preview. This supports the writing task;
it does not expand into implementation, a release or a whole-store audit. If the
source is unavailable, ask for it or put the uncertainty in a separate note to the
user. Exclude unsupported claims from the client draft.

For placement, visibility or market-dependent behaviour, tie evidence to the
affected market, customer type, theme and URL. A check in one market does not
establish another. Check only the variants needed to support the proposed claim;
avoid a blanket audit when the request is narrower. If variants differ, describe
them accurately or narrow the statement to what was checked.

Distinguish implemented, verified on preview and deployed. Use "live", "shipped",
"resolved" or "works across all markets" only when the evidence supports that
status and scope. Do not blame an asset, app or merchant setting without evidence
of the cause. Do not infer intent or a bug from a CSS rule alone.

## Write And Tighten

- Use plain Australian English, active voice and familiar words. Lead with the
  customer impact or the answer. Keep necessary uncertainty precise.
- No AI narration or verbose writing. Include the context, detail and explanation
  the client needs to understand the answer or act on it. Match depth to the
  question and audience; do not cut useful explanation just to shorten the draft.
- Return one final draft. No alternatives, quote-back, preamble, process narration
  or "What changed" section unless requested.
- Use plain paste-ready text, without a blockquote or code fence. Keep any useful
  evidence/uncertainty note outside it and short; name the source and tested scope
  only when it helps the user assess a material claim. Never mix internal notes into
  forwardable copy.
- For pre-scope replies, describe questions and options rather than promising
  implementation. Check merchant-controlled settings before offering development.
  Merchant instructions refer to their actual content, not internal QA test media.
- Cut generic openings, inflated promises, repetition, filler and unrequested
  editorial commentary. Keep technical detail only when useful to the reader.
  No em dashes.
- Keep hours, estimates, rates and costs out of client output. Keep assistant
  instructions, internal verification notes and sensitive information out too.
- Reread once for factual scope and once for brevity. If a material fact remains
  unverified, identify it separately to the user, outside the copyable draft.

Drafting does not authorise sending. External posting requires the user's explicit
instruction; honour authorisation already given rather than asking again.

## Checkpoint Before Returning

Save the exact draft and map each material factual claim to its evidence and
market/status scope in the private record. Give one independent reviewer the
draft, sources and audience to check factual support, omitted qualifiers,
instruction leakage and useful detail without AI narration or padding. Do not
give the reviewer a desired verdict. Reuse a worker if available. For a simple
acknowledgement with no material factual claims, reread directly for style and
scope; do not activate a checkpoint or add a worker merely for that reply.

Factual client and PM drafts require this review; routine replies and
acknowledgements without material claims need only the direct reread.
The reviewer opens the actual draft and each supporting source/result, checks that
successful evidence entails the wording and qualifiers, and reports every issue
together in one pass. A source path, valid hash or citation alone is insufficient.
Separate blocking factual errors, missing material facts and unqualified claims
from optional suggestions. Pass when no blocking items remain. Flag inferred
rates, "always"/"never" and any extrapolation from a sample. Read the source
thread and ask what recent change or comment could contradict the draft. Reread
as the recipient for tone and internal AI/tool names.
Use one full review and at most one check of changed lines. Apply explicit
reviewer-suggested fixes directly; they do not need another review. For other
factual changes, reuse the same reviewer with the diff and affected evidence.
If material errors remain, report the blocker rather than delivering under the
round limit. Report optional suggestions to the user without looping. Shortening
can remove essential qualifiers.

Complete the activated record before returning the checked draft. `complete`
includes final validation; use a separate `final` only to diagnose an issue.
Keep one review record and one hash binding it to the final draft. Supply all
relevant evidence together, including template/configuration files and successful
command outputs. Claim descriptions need not match draft prose verbatim. Do not
create a second worker review of the client reviewer.
After a pass, use `recheck` to record checks of changed lines and refresh the hash.
The author may attest wording-only edits that preserve meaning. Changes to facts,
theme names, timing, instructions, qualifications or supporting evidence require
an independent check of affected claims, even for a one-word edit. Refresh the
hash only after checking. Exact reviewer-prescribed fixes can use `recheck
--change-kind suggested-fixes`: each unresolved material finding must contain
the reviewer's explicit `suggested_fix`, and the author records which fixes were
applied and checked. Other unresolved findings require the targeted follow-up.
Report optional suggestions separately. Collect results with the runtime's
available tools (Codex native waiting, Claude notifications or TaskOutput when
available), without pending-agent IDs, duplicate collection or sleep/file polling.
Routine replies without material factual claims need only a
direct reread. Mechanical checks catch missing reviews, unresolved material
findings, unchecked changes and specific style violations; the reviewer
assesses meaning. If independent review is unavailable, state the limitation and
return any draft as unreviewed, using the documented blocked-task path. Do not
claim a passed checkpoint or manufacture a reviewer identity.
