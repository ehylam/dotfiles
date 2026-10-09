# Figma↔Site QA Toolkit

Cross-reference a Figma design system against a live storefront. Surfaces
drift between design intent and rendered reality per section, per viewport,
with foundation-token awareness so you see *which* token was used vs which
was specified.

## What's in the toolkit

| File | Purpose |
|---|---|
| `~/.claude/scripts/inspect.mjs` | The measurement engine — measures rendered computed styles. See `INSPECT.md`. |
| `~/.claude/scripts/figma-qa.mjs` | Site-wide orchestrator. Reads a mapping JSON, calls `inspect.mjs` per target, diffs against embedded design intent, can pixel-diff Figma reference PNGs against the rendered theme, emits a markdown report. |
| `~/.codex/scripts/figma-qa.mjs` | Codex wrapper that delegates to the canonical Claude orchestrator. |
| `~/.agents/skills/figma-qa/WORKFLOW.md` | `figma-qa` skill workflow. Drives Claude through the Figma MCP extraction phase, then runs the orchestrator and summarises. |
| `~/.agents/skills/figma-diff/WORKFLOW.md` | `figma-diff` skill workflow for one-off "this Figma node vs this rendered element" checks. No mapping file required. |
| `$figma-qa` / `$figma-diff` | Shared skills for Codex and Claude discovery. Codex can run existing mappings; assisted extraction needs an exposed Figma MCP or user-provided intent. |

## Two-board / three-board design system model

The toolkit assumes the typical Figma structure:

- **Foundations board** — colours, typography styles, spacing scale,
  breakpoints, transitions, shadows. These become *tokens* in the mapping.
- **Components board** — small reusable elements (buttons, badges,
  product cards, icons). Each maps to one or more live DOM nodes.
- **Sections board** — full-width page sections (hero, featured-products,
  testimonials, footer). Each maps to a CSS selector at one URL.

The mapping JSON cross-references these. Foundations live under
`foundations.colors / .typography / .spacing / .breakpoints`. Each
component/section becomes a `target` in `targets[]` with one or more
`checks`.

## Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Phase 1 — Set up mapping (one-time, manual + assisted)          │
│                                                                 │
│   /figma-qa  → Claude extracts foundations + design intent from │
│                Figma MCP, populates figma-qa.json               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Phase 2 — Run the audit (repeatable, automated)                 │
│                                                                 │
│   figma-qa.mjs --input figma-qa.json                            │
│     → per target, per viewport:                                 │
│       1. inspect.mjs batch against mapped live elements         │
│       2. diff rendered properties against intent                │
│       3. annotate with foundation-token matches                 │
│     → emit markdown + JSON reports                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Phase 3 — Interpret (in Claude or by the user)                  │
│                                                                 │
│   /figma-qa summarises the report: kinds of drift, root causes, │
│   and per-section breakdown. Lead with token-level findings.    │
└─────────────────────────────────────────────────────────────────┘
```

## Reference-site comparison mode

Use `referenceBaseUrl` when the source of truth is an existing site rather
than extracted Figma intent. The runner measures the reference site and the
dev site through the same mapping, then diffs the dev rendering against the
reference measurement.

```jsonc
{
  "site": "Example",
  "referenceBaseUrl": "https://www.example.com",
  "baseUrl": "https://dev.example.com",
  "viewports": ["mobile", "tablet", "desktop"],
  "targets": [
    {
      "id": "home-hero",
      "url": "/",
      "checks": [
        {
          "id": "heading",
          "selector": ".hero__title",
          "subcommand": "typography"
        }
      ],
      // Optional pixel-level visual checks. With referenceBaseUrl, this
      // compares the reference-site capture against the dev-site capture.
      "visualChecks": [
        {
          "id": "hero-section-pixels",
          "selector": "section.hero",
          "referenceSelector": ".legacy-hero",
          "viewports": ["desktop"],
          "threshold": 0.1,
          "maxDiffPct": 1
        }
      ]
    }
  ]
}
```

If the reference site uses different markup, set `referenceUrl` on the
target or `referenceSelector` / `referenceScope` on the check. The same
reference fields work on `visualChecks`; omit `figmaScreenshot` and the
pixel check will compare `referenceBaseUrl` to `baseUrl`. If the same
selector is intentionally valid on both sites, set `referenceSameLocator:
true` on the check when running in strict mode.

## Strict no-assumptions mode

For a design at an exact width, add `--viewports desktop --viewport-size 1440x1000`
(using the actual reference geometry). The override reaches numeric and pixel checks,
retains preset DPR/input mode and is recorded in the Markdown/JSON reports. It requires one
explicit preset; run responsive presets separately. Relative screenshot paths are
resolved from the command's working directory.

The generic component recipe is in `~/.claude/scripts/qa/component/README.md`.
Its thresholds are diagnostic proposals, not approved client tolerances. Generated
drift reports do not replace the revision-bound QA checklist in `playwright-lite`.

Use `--strict-mapping` when the audit must fail closed instead of inferring
anything from defaults.

```bash
figma-qa.mjs --input figma-qa.json --strict-mapping
```

Strict mode requires:

- explicit `viewports` at the mapping or target level
- explicit `url` on every target, with `""` allowed for the base URL
- explicit `subcommand` on every check
- explicit `intent` or `properties` for Figma/design-intent audits
- explicit `properties` for reference-site audits
- explicit `referenceSelector` / `referenceAText`, or `referenceSameLocator:
  true`, for reference-site audits

## Mapping JSON schema

```jsonc
{
  // Friendly name for reports
  "site": "K9 Natural AU",

  // Live site root. URLs in targets are resolved relative to this.
  "baseUrl": "https://au.k9felinenatural.com",

  // Optional source-of-truth site for reference-vs-dev comparisons.
  "referenceBaseUrl": "https://www.example.com",

  // Viewports to run by default (per-target override possible)
  "viewports": ["mobile", "tablet", "desktop"],

  // For traceability + extraction. Set once when you create the mapping.
  "figmaFileKey": "1LYuTXPM9PYp197Yl1p9Ad",

  "foundations": {
    // Optional pointer to the Figma boards (used by /figma-qa to know
    // where to re-extract tokens / catalog components + sections from).
    "boards": {
      "foundations": "1479:11316",
      "sections":    "<node id>",
      "components":  "<node id>"
    },

    // Named tokens. The orchestrator uses these to annotate drift with
    // "rendered uses <token X>; design specifies <token Y>".
    "colors": {
      "natural-white": "#FFFFFF",
      "olive-black":   "#3D3939",
      "light-cream":   "#F8F6F2"
    },

    // Each typography token is a complete style — fontFamily/Size/Weight/
    // LineHeight/LetterSpacing. The orchestrator can match by fontSize
    // alone to suggest "this rendered size matches the H2-Desktop token".
    "typography": {
      "h2-desktop": {
        "fontFamily": "Noto Serif",
        "fontSize":   "48px",
        "fontWeight": 400,
        "lineHeight": 1.1,
        "letterSpacing": "0"
      }
    },

    // Spacing scale in px. The orchestrator can flag rendered gaps/padding
    // that don't match any value in this set (= a hardcoded one-off).
    "spacing": { "xs": 4, "sm": 8, "md": 16, "lg": 24, "xl": 32, "2xl": 48 },

    // Breakpoints in px. Used to label viewport columns in reports.
    "breakpoints": { "mobile": 390, "tablet": 768, "desktop": 1280 }
  },

  "targets": [
    {
      "id": "hero-desktop-video",
      "label": "Homepage hero — desktop video variant",
      // Figma node id for cross-referencing back to the source.
      "figmaNode": "3707:18089",
      // Where the section lives in production (relative or absolute).
      "url": "/",
      // Override site viewports if this target only applies to one device.
      "viewports": ["desktop"],
      "checks": [
        {
          "id": "hero-heading",
          // CSS selector identifying the live element.
          "selector": "h2.hero__title.rte",
          // Optional: restrict locator search to a parent (avoids picking
          // the same selector in a different region).
          "scope": "section.background-video-section",
          // Pick the subcommand. Defaults to "typography" when intent
          // includes font-* / color / text-*; "box" for margin/padding/
          // border; "layout" for display/flex-*/grid-*.
          "subcommand": "typography",
          // The design intent. Values use the same shape inspect.mjs
          // outputs (px-suffixed strings for lengths, hex for colours,
          // numeric strings for fontWeight).
          "intent": {
            "fontFamily": "Noto Serif",
            "fontSize": "48px",
            "fontWeight": "400",
            "lineHeight": "52.8px",
            "letterSpacing": "0",
            "color": "#FFFFFF",
            "textAlign": "center"
          },
          // Optional fields:
          // "properties": "font-size,font-weight,color"    // restrict the styles subcommand
          // "initScript": "await fetch('/cart/add.js',{...});"  // for cart-state-dependent targets
          // "aText": "Click here"                             // locate by text
          // "aIndex": 1                                       // pick Nth match
        }
      ]
    }
  ]
}
```

## How drift is interpreted

The orchestrator normalises before comparing:

- **Colours** — `rgb(255,255,255)` ↔ `#FFFFFF` ↔ `#ffffff` are equal.
- **Lengths** — bare numbers (`48`) get `px` suffix appended (`48px`).
- **Font family** — first family in the stack only; quotes stripped; case-insensitive.
- **Line-height** — px values from `getComputedStyle` are kept as-is;
  unitless values are formatted to 2 decimals (`1.10`).
- **Weights / alignments** — exact string match.

When the rendered colour matches a token in `foundations.colors` AND the
designed colour matches a different token, the report annotates with
`rendered uses **light-cream** token; design specifies **natural-white**`.
This is the most actionable framing — it points at a token-mapping bug
rather than a one-off colour change.

### Near-match tokens

When a colour isn't an exact match for any token but falls within an
sRGB distance threshold (default 15; configurable via
`--near-match-threshold`), the report annotates it with the nearest
token: `#f5f3ef (≈ light-cream Δ4.2)`. This catches "almost a token"
values that are usually rendering bugs (premultiplied alpha, slightly
wrong hex). Tune the threshold lower to be stricter (5 = very close
only) or higher to catch broader near-misses.

### Spacing and font-size tokens

Spacing properties (`paddingTop`, `marginRight`, `gap`, `rowGap`,
`columnGap`, etc.) and `fontSize` are also matched against
`foundations.spacing` and `foundations.typography` respectively. When
a rendered spacing value matches a spacing token, the report annotates
with `**md** token`; same for font sizes against typography tokens.

### Per-viewport intent

A check's `intent` can be a single shared block OR include per-viewport
overrides:

```jsonc
"intent": {
  "fontFamily": "Noto Serif",   // shared across all viewports
  "fontWeight": "400",          // shared
  "color": "#FFFFFF",           // shared
  "mobile":  { "fontSize": "32px" },   // mobile-only
  "desktop": { "fontSize": "48px" }    // desktop-only
}
```

Use this for responsive designs where the same component renders with
different typography or spacing at different breakpoints.

## Site-level foundations conformance

After all per-target diffs, the orchestrator walks every rendered style
and asks: is this value declared in the foundations token set?

Values that aren't tokens are flagged as "rogue" — hardcoded one-offs
that break the design-system contract even when the design itself was
followed correctly for individual components.

```text
## Foundations conformance: 73%
Across all rendered styles in this run: 22/30 unique values are
declared in the foundations token set.

### Rogue colours (3)
| Value     | Used | Closest token            | First context        |
| #f5f3ef   | 8×   | light-cream (#f8f6f2, Δ4)| hero-heading (desktop)|
| #2a2a2a   | 12×  | olive-black (#3d3939, Δ23)| nav-link (mobile)    |
```

Three breakdowns are emitted: rogue colours (with nearest-token
suggestion), rogue font sizes, and rogue spacings. Skip the whole pass
with `--skip-conformance`.

## Validate-only mode

For CI: `figma-qa.mjs --input mapping.json --validate` parses the JSON,
checks the schema, prints any errors/warnings, and exits 0 (valid) or 1
(invalid) without launching Chrome. Use this as a fast pre-flight before
spending minutes on the actual run.

## Stability passes

Pass `--stability-passes 2` (or higher) to ask `inspect.mjs` to measure
each check multiple times. If rects or styles differ between passes,
the per-check entry surfaces a `FLAP:` warning so you know the
measurement isn't trustworthy and the underlying element is flaky.
Costs N× wall clock per target.

## Figma reference screenshots in the report

If a target has a `figmaScreenshot` field pointing at a local path or
URL, the markdown report embeds it under the target's header so the
visual reference sits next to the drift table. Extraction:

```js
// in the /figma-qa command flow, before populating the mapping:
const shot = await mcp__claude_ai_Figma__get_screenshot({ fileKey, nodeId });
// save the file locally and put its path on the target as figmaScreenshot.
```

## Pixel-level visual checks

Use `visualChecks` when you want a screenshot-level score for how closely
the rendered theme matches a Figma node or reference site. The check
compares a saved Figma PNG, or a reference-site URL capture, against a
rendered theme screenshot using `inspect.mjs diff`, which uses Mapbox
`pixelmatch` with `pngjs` for PNG decoding.

Pixel checks are best for section or component shape, image crop, visual
weight, border radius, icon placement, and overall composition. Keep
computed-style checks for exact CSS values, because pixel diffs can be
affected by fonts, image compression, anti-aliasing, content differences,
animation state, and dynamic merchant data.

Example target:

```jsonc
{
  "id": "home-hero",
  "label": "Homepage hero",
  "figmaNode": "3707:18089",
  "figmaScreenshot": {
    "desktop": ".figma-qa/screenshots/home-hero-desktop.png",
    "mobile": ".figma-qa/screenshots/home-hero-mobile.png"
  },
  "url": "/",
  "visualChecks": [
    {
      "id": "hero-section-pixels",
      "selector": "section.hero",
      "viewports": ["desktop", "mobile"],
      "threshold": 0.1,
      "maxDiffPct": 1
    }
  ]
}
```

Website-to-website example using `referenceBaseUrl`:

```jsonc
{
  "referenceBaseUrl": "https://www.example.com",
  "baseUrl": "https://dev.example.com",
  "targets": [
    {
      "id": "home-hero",
      "url": "/",
      "visualChecks": [
        {
          "id": "hero-section-pixels",
          "referenceSelector": ".legacy-hero",
          "selector": "section.hero",
          "referenceScope": ".main-content",
          "scope": "main",
          "viewports": ["mobile", "tablet", "desktop"],
          "threshold": 0.1,
          "maxDiffPct": 1
        }
      ]
    }
  ]
}
```

Run with a stable output folder for the captured reference, rendered, and
diff PNGs:

```bash
~/.claude/scripts/figma-qa.mjs \
  --input figma-qa.json \
  --visual-diff-out .figma-qa/visual-diffs \
  --report figma-qa-report.md \
  --json-report figma-qa-report.json
```

Global defaults:

- `--visual-threshold 0.1`: pixelmatch sensitivity, where lower is stricter.
- `--visual-max-diff-pct 1`: fail a visual check above this mismatch percentage.

Per-check `threshold` and `maxDiffPct` override the global defaults.

## Working with the boards

### Foundations extraction (one-time per project)

`mcp__claude_ai_Figma__get_variable_defs` returns Figma variables defined
on a board — these are the authoritative token names + values. If the
project doesn't use Figma variables, fall back to
`mcp__claude_ai_Figma__get_design_context` and parse the
"These styles are contained in the design: …" block from the response.

### Components / sections cataloguing

`mcp__claude_ai_Figma__get_metadata` on each board returns the frame's
direct children. For each section/component you care about, add one
`target` to `targets[]` with the figma node id, the live URL/selector,
and a check per measurable property cluster (typography, box, layout).

### Re-extracting after design changes

When the Figma file changes, re-run `/figma-qa` and let Claude re-fetch
intent for each target. The mapping file's structural data (URLs,
selectors, target ids) stays; only the `intent` blocks get refreshed.

## Performance

Each target is one Chrome launch via `inspect.mjs` (~3s startup + ~1s per
viewport). For 30 targets × 3 viewports that's roughly 5 minutes
sequentially. Use `--concurrency 4` to run four at a time and cut wall
clock by ~3-4x. Concurrency above 4 starts to thrash Chrome on a typical
laptop.

## Limitations

- **Manual node↔selector mapping.** The Figma MCP doesn't give you a CSS
  selector — only the design tree. You write the selector once per
  component when adding it to `targets[]`.
- **Hidden production state.** Cart, account, search-results pages need
  an `initScript` to put the site into the right state before measuring.
- **Token matching is exact.** The token-annotation feature only fires
  when the rendered hex matches a foundation token exactly. Near-matches
  aren't flagged (yet).
- **Auto-layout vs CSS gap.** Figma auto-layout's `itemSpacing` maps to
  CSS `gap` *or* margin — the orchestrator diffs `gap`. If the live theme
  uses margin instead, the diff says "design specifies gap: 16px, rendered
  has gap: 0" and you'll need to look at the children's margins manually.

## Commands at a glance

```bash
# One-shot check — single Figma node vs single rendered element
/figma-diff "compare figma node 3707:18089 to h2.hero__title.rte on https://au.k9felinenatural.com/"

# Site-wide audit using a mapping file
/figma-qa            # reads ./figma-qa.json (or asks)

# Direct script invocation (no Claude orchestration)
~/.claude/scripts/figma-qa.mjs --input figma-qa.json \
  --report figma-qa-report.md --json-report figma-qa-report.json

# Codex wrapper invocation
~/.codex/scripts/figma-qa.mjs --input figma-qa.json \
  --report figma-qa-report.md --json-report figma-qa-report.json
```
