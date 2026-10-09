# /figma-qa — site-wide Figma↔rendered QA

You are driving a site-wide QA pass between a Figma design system and a
running storefront. The goal is to surface drift between design intent and
rendered reality across every page section + shared component.

The orchestrator is `~/.claude/scripts/figma-qa.mjs`. It reads a mapping
JSON, calls `inspect.mjs` per target, diffs computed styles against the
embedded design intent, can pixel-diff saved Figma screenshots against
rendered theme elements, and emits a markdown report.

Full feature doc: `~/.claude/scripts/FIGMA-QA.md`. Schema for the mapping
file: header of `~/.claude/scripts/figma-qa.mjs`.

## Your job

1. Locate / build the project's mapping file (`figma-qa.json`).
2. Fill in any missing design intent by calling Figma MCP tools.
3. Invoke `figma-qa.mjs` to run the diffs.
4. Summarise the report to the user — lead with the *kind* of drift (token
   mismatches, weight bumps, spacing off-spec) before dumping the table.

## Step 1 — Mapping file

Look in the current working directory for one of:

- `figma-qa.json`
- `.figma-qa/mapping.json`
- `qa/figma-qa.json`

If none exists: **don't ask the user to hand-write it.** Run the bootstrap
flow below to scaffold it from the Figma boards in seconds. Required
fields:

```jsonc
{
  "site": "Project name",
  "baseUrl": "https://staging.example.com",
  "viewports": ["mobile", "tablet", "desktop"],
  "figmaFileKey": "<file key from any figma.com/design/<key>/... URL>",
  "foundations": {
    "boards": {
      "foundations": "<node id, e.g. 1479:11316>",
      "sections":    "<node id>",
      "components":  "<node id>"
    },
    "colors":     { /* name → hex */ },
    "typography": { /* name → { fontFamily, fontSize, fontWeight, lineHeight, letterSpacing } */ },
    "spacing":    { /* name → number (px) */ },
    "breakpoints": { /* name → number (px) */ }
  },
  "targets": [
    {
      "id": "hero-desktop-video",
      "label": "Homepage hero",
      "figmaNode": "3707:18089",
      "url": "/",
      "viewports": ["desktop"],
      "checks": [
        {
          "id": "hero-heading",
          "selector": "h2.hero__title.rte",
          "subcommand": "typography",
          "intent": { "fontFamily": "Noto Serif", "fontSize": "48px", "fontWeight": "400",
                       "lineHeight": "52.8px", "letterSpacing": "0", "color": "#FFFFFF",
                       "textAlign": "center" }
        }
      ]
    }
  ]
}
```

Convert node IDs from URL form (`6969-322965`) to API form (`6969:322965`)
when you write them into the mapping.

### Bootstrap flow (when figma-qa.json doesn't exist yet)

This is the fastest path to a working mapping. Skip step 2 below if you
run the bootstrap — it incorporates extraction.

1. Ask the user for three node IDs from their Figma file:
   - The **foundations** board (typography, colours, spacing tokens)
   - The **sections** board (full-width page sections)
   - The **components** board (small reusable elements like buttons)

   Format examples:
   - URL: `figma.com/design/<file>/?node-id=1479-11316`
   - API id: `1479:11316`

   Also ask for the live `baseUrl` for the storefront.

2. Extract foundation tokens:
   - `mcp__claude_ai_Figma__get_variable_defs` for the foundations node.
   - If variables aren't defined, `mcp__claude_ai_Figma__get_design_context`
     and parse the "These styles are contained in the design" block.
   - Distil into `foundations.colors`, `foundations.typography`,
     `foundations.spacing`, `foundations.breakpoints`. Use names like
     `natural-white`, `olive-black`, `md`, etc.

3. Enumerate sections and components:
   - `mcp__claude_ai_Figma__get_metadata` on the sections board — every
     direct child frame is a section candidate.
   - Same on the components board.
   - For each, create a stub `target` entry:

     ```jsonc
     {
       "id": "<short kebab-case name from the frame name>",
       "label": "<frame name>",
       "figmaNode": "<frame id>",
       "url": "<TODO: live URL — leave as '/' if unknown>",
       "checks": [
         {
           "id": "<id>-typography",
           "selector": "<TODO: CSS selector on the live site>",
           "subcommand": "typography",
           "intent": {} // TODO: populate via get_design_context
         }
       ]
     }
     ```

4. Write the file to `figma-qa.json` (or the user's preferred path).
   Save it with `selector` and `intent` left as `TODO` placeholders.

5. Validate the structure:

   ```bash
   ~/.claude/scripts/figma-qa.mjs --input figma-qa.json --validate
   ```

   This catches schema bugs before the user starts filling selectors.

6. Tell the user: "I've scaffolded N section + M component targets. Each
   has a `TODO` selector and empty `intent`. Open the file and add the
   live CSS selector per row. Then run `/figma-qa` again to auto-extract
   the design intent for each Figma node."

7. On the second run, for every target whose `intent` is empty or
   missing, call `mcp__claude_ai_Figma__get_design_context` and parse the
   typography / colour / layout values into the check's `intent`.

8. Also call `mcp__claude_ai_Figma__get_screenshot` for each target and
   save it locally; set `target.figmaScreenshot` to the saved path so
   the report embeds the visual reference.
   If the user wants Figma visual parity scoring, add a `visualChecks`
   entry for the mapped section/component selector:

   ```jsonc
   {
     "id": "hero-section-pixels",
     "selector": "section.hero",
     "viewports": ["desktop"],
     "threshold": 0.1,
     "maxDiffPct": 1
   }
   ```

   If the mapping uses `referenceBaseUrl` instead of Figma screenshots,
   add `visualChecks` without `figmaScreenshot`; use `referenceSelector`
   / `referenceScope` when the reference site markup differs:

   ```jsonc
   {
     "id": "hero-section-pixels",
     "referenceSelector": ".legacy-hero",
     "selector": "section.hero",
     "viewports": ["desktop"],
     "threshold": 0.1,
     "maxDiffPct": 1
   }
   ```

Two-pass workflow keeps the user in control of selector mapping (the
only step Figma can't help with) while automating everything else.

## Step 2 — Extract foundations + design intent

If the mapping file is missing `foundations.colors` / `.typography` / etc.,
extract them from the Figma foundations board:

1. `mcp__claude_ai_Figma__get_variable_defs` with `fileKey` and the
   foundations board `nodeId` — returns token names → values for any
   Figma variables defined in that board.
2. `mcp__claude_ai_Figma__get_design_context` on the foundations board —
   returns CSS values in code form when there are no Figma variables.
3. Distil into the `foundations` block of the mapping JSON, keyed by
   sensible names (`natural-white`, `olive-black`, `light-cream`, etc.).

For each target that's missing `checks[*].intent`, fetch design intent:

1. `mcp__claude_ai_Figma__get_design_context` with the target's `figmaNode`.
2. The response includes a `These styles are contained in the design: …`
   block listing typography styles by name + numeric values. Map those to
   the relevant check's `intent`.
3. The response also returns React/Tailwind code. Use it to identify the
   colour, padding, gap, and layout values for `box` / `layout` checks.

For Code Connect prompts: pass `disableCodeConnect: true` to bypass mapping
setup unless the user explicitly wants to map components.

Don't skip extraction silently. If a check has no `intent` field, the script
has nothing to diff against — it'll report the rendered values but not flag
drift. Tell the user when this happens and offer to fill it in.

## Step 3 — Run the orchestrator

```bash
~/.claude/scripts/figma-qa.mjs \
  --input <PATH_TO_MAPPING> \
  --report figma-qa-report.md \
  --json-report figma-qa-report.json
```

Optional flags:

| Flag | When to use |
|---|---|
| `--filter <substring>` | Iterate on a single section while developing the mapping |
| `--viewports m` | Single viewport during fast iteration |
| `--concurrency N` | Speed up large mappings (≥10 targets). Stay ≤4 to avoid Chrome thrash |
| `--storefront-password STR` | Shopify password gate |
| `--stability-passes N` | Run N times per check; flag flaky elements |
| `--default-tolerance N` | px tolerance on numeric drift (overridden by per-check `tolerance`) |
| `--baseline previous.json` | Diff against an earlier `--json-report` (new/fixed/persistent breakdown) |
| `--junit out.xml` | Emit JUnit XML for CI dashboards |
| `--sarif out.json` | Emit SARIF for GitHub Code Scanning |
| `--visual-diff-out DIR` | Keep Figma/reference-site, rendered, and diff PNGs in a stable folder |
| `--visual-threshold N` | Default pixelmatch threshold for `visualChecks` |
| `--visual-max-diff-pct N` | Default mismatch percentage gate for `visualChecks` |
| `--fail-on drift\|partial\|any` | Hard-fail (exit 2) when CI should block on property or visual drift |
| `--validate` | Schema-check the mapping file and exit (no Chrome launched) |
| `--print-schema` | Dump the mapping JSON schema for editor autocomplete |

Timeout: 5 minutes for sites with <20 targets, 10+ minutes for larger
mappings. Use foreground (need the output before continuing).

## Step 4 — Summarise the report

Read the markdown report. Structure the summary back to the user like this:

```
N targets · M total checks · X passed · Y drift

Key issues:
  • <token-level summary, e.g. "5 checks use light-cream where design specifies natural-white">
  • <weight-level summary, e.g. "Headings rendering 600 weight; designs specify 400">
  • <spacing summary, e.g. "Card gap 12px on mobile; design specifies 16px">

Per-section drift:
  hero-desktop-video — 3 properties drifted
  product-card     — 2 properties drifted on mobile only
  footer-columns   — clean ✓
```

Lead with the kind of drift, not the table. Group by root cause when
possible (e.g. "5 colour drifts all collapse to: rendered using light-cream
token where design specifies natural-white").

Always show the report path so the user can open the full table.

## Anti-patterns

- Don't fabricate intent values. If you can't extract them from Figma,
  flag the gap and ask.
- Don't reuse stale extracted intent. If the mapping file is more than ~3
  days old, offer to re-fetch from Figma.
- Don't run more than ~4 targets in parallel — Chrome contexts thrash
  under heavier concurrency.
- Don't dump the full markdown report verbatim if it's long. Summarise.

## When to suggest `/figma-diff`

If the user only cares about one element ("just check the hero heading"),
suggest `/figma-diff` instead — it's a single-shot check without the
mapping-file overhead.

The user's request (URLs, node ids, mapping file path) is the input.
