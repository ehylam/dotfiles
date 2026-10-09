---
name: viewport-schema-qa
description: Reuse rendered viewport and JSON-LD checks for storefront QA. Use for responsive layout, typography or schema validation across affected pages and markets; use project suites for interactive journeys and Figma QA for design parity.
---

# Viewport And Schema QA

Reuse `~/.claude/scripts/inspect.mjs` (Codex wrapper: `~/.codex/scripts/inspect.mjs`).
One `batch` run settles each page once per viewport, then measures all checks.
Default viewports are 375, 768 and 1280 px. Save task-specific checks in the project's
existing QA folder, and generated reports in an ignored location or temporary directory.

```json
{"checks":[
  {"id":"heading","subcommand":"typography","selector":".hero h1"},
  {"id":"parent","subcommand":"layout","selector":".hero"},
  {"id":"gap","subcommand":"distance","selector":".hero h1","selectorB":".hero p"},
  {"id":"jsonld","subcommand":"schema","requiredTypes":["Product"]}
]}
```

Replace the example selectors and required types with the task's actual requirements.
Schema checks are optional when the page is not expected to contain JSON-LD.

```bash
node ~/.claude/scripts/inspect.mjs batch --url 'https://example.com/products/item' \
  --batch-file qa/checks.json --format json > /tmp/viewport-qa.json
node ~/.claude/scripts/inspect.mjs schema --url 'https://example.com/products/item' \
  --required-types Product --format json > /tmp/schema-qa.json
```

For comparisons, pass `--url-a` and `--url-b`. Run each affected market's actual URL;
record resolved URL, viewport, state and result. Delegate independent targets/checks
with `$agent-teams` using isolated browser state when useful. Do not share a mutable cart.
Ask once for a storefront password and reuse it via the supported password flag or
`STOREFRONT_PASSWORD`. Authentication failures are blocked checks, not passes.

Read the report's viewport errors, console/network failures and every check. JSON-LD
syntax or missing required types makes the schema CLI/batch exit nonzero. Measurement
values alone do not assert visual correctness: compare them with supplied expectations
or a verified reference, and inspect screenshots when appearance is the requirement.
Schema inspection parses rendered JSON-LD, handles arrays and `@graph`, reports declared
types and malformed blocks. It does not validate Schema.org semantics, Google eligibility,
pricing or market-specific correctness. Use authoritative validators and observed data
for those claims.

Before changing CSS, read the authored rule and its intended breakpoint behaviour.
Distinguish numeric `clamp()` sizing from text line clamping; inspect parent layout and
direct gaps, reproduce the unwanted behaviour, then rerun the same checks after the fix.
For constraint changes, activate the private task checkpoint described in
`~/.claude/scripts/WORKFLOW-CHECKS.md` before editing and final-check the repeated
measurements afterwards. The source and measurements establish the recorded intent;
the checkpoint cannot decide whether an unusual CSS rule is a bug.
Keep an intentional clamp when it matches the design. Use `$figma-qa` with a real mapping
or extracted intent; a failed Figma connection does not license guessed values.
The inspector closes its own temporary browser. Never pass `--keep-browser` for QA.
Its mobile viewports still use Chromium. Route required Safari/Mobile Safari
checks through `$playwright-lite` and `~/.claude/scripts/APPLE-BROWSER-QA.md`;
record those engines separately from this inspector's measurements.
