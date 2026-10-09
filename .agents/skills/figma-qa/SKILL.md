---
name: figma-qa
description: Run or prepare Figma-to-rendered-site QA and reference-site-to-dev-site QA using the local figma-qa.mjs orchestrator and inspect.mjs measurements. Use when the user asks for Figma QA, Figma diff, design-to-site drift, reference-site parity, design-system conformance, token drift, or site-wide visual QA from a mapping file.
---

# Figma QA

Use this skill for Figma design-system QA or reference-site parity QA against a live storefront. The canonical orchestrator lives at `~/.claude/scripts/figma-qa.mjs`; Codex uses `~/.codex/scripts/figma-qa.mjs`, a wrapper that delegates to the same implementation. The orchestrator can also run pixel-level Figma screenshot vs rendered theme checks and website-to-website visual checks through `visualChecks`.

## Modes

- Existing mapping file: run the script directly in either Codex or Claude Code.
- Assisted mapping or intent extraction: use Figma MCP tools if available. The full extraction workflow lives in `WORKFLOW.md` next to this file (and `../figma-diff/WORKFLOW.md` for one-off node checks).
- No Figma MCP available: do not fabricate design intent. Ask the user for a completed mapping file, Figma-extracted values, or run the mapping setup in Claude Code.
- Connection/auth failure: report the failing tool and available evidence, stop repeating
  the same failing request, and use an existing validated mapping or supplied extracted
  intent. Without either, measure the site only and label design parity unverified.

## Files

- Extraction workflow: `WORKFLOW.md` (this skill's folder)
- Full toolkit guide: `~/.claude/scripts/FIGMA-QA.md`
- Canonical script: `~/.claude/scripts/figma-qa.mjs`
- Codex wrapper: `~/.codex/scripts/figma-qa.mjs`
- Measurement engine: `inspect.mjs` via the `$inspect` skill

Read `~/.claude/scripts/FIGMA-QA.md` when you need the mapping schema, flags, token-conformance behaviour, or report interpretation details.

## Workflow

1. Locate a mapping file: `figma-qa.json`, `.figma-qa/mapping.json`, or `qa/figma-qa.json`.
   Confirm Figma tool availability with one metadata/read request before planning live
   extraction. A missing server and an inaccessible file are different blockers.
2. If no mapping exists, use `~/.claude/scripts/qa/component/README.md` and its
   incomplete templates for reusable checks. Follow the project's QA location;
   otherwise keep the completed mapping outside Git. Resolve exact reference intent
   and approval/tolerances before acceptance; ask only for missing inputs.
3. Validate the mapping before long runs:

   ```bash
   ~/.codex/scripts/figma-qa.mjs --input <mapping> --validate
   ```

   Use `--strict-mapping` when the audit should fail instead of relying on inferred subcommands, reference locators, properties, target URLs, or viewports.

   Use the Claude path instead inside Claude Code.

4. Run the audit:

   ```bash
   ~/.codex/scripts/figma-qa.mjs \
     --input <mapping> \
     --visual-diff-out .figma-qa/visual-diffs \
     --report figma-qa-report.md \
     --json-report figma-qa-report.json
   ```

5. When a target includes a saved Figma screenshot, or the mapping includes `referenceBaseUrl`, add or preserve `visualChecks` so the run reports pixelmatch mismatch percentage and diff PNGs.
6. Summarise the report by root cause: token mismatches, rogue foundation values, typography drift, spacing drift, layout drift, visual pixel drift, and per-section failures.

## Guardrails

- Do not invent Figma values. Missing `intent` means the run can measure but cannot prove drift.
- For truncation or responsive CSS, inspect the authored `clamp()` or line-clamp rule,
  breakpoint, content and reference intent before changing it. An intentional clamp is
  not a defect merely because a computed value or full text differs at one viewport.
- Keep concurrency at `4` or lower unless the user accepts local Chrome thrash.
- Use `--filter` and single viewport runs for iteration, then rerun the full viewport set before calling the audit complete.
- Treat pixel diffs as visual evidence, not as the only source of truth. Pair them with computed-style checks for exact fonts, spacing, colours, and layout.
- Show the report path in the final answer.
