---
name: parity
description: Verify visual changes against a Figma or Pencil design, screenshot, mockup, or reference website using inspect.mjs measurements and an evidence checklist. Use for design-match QA, visual fixes, and requests to match, mirror, or replicate visual or behavioural details.
---

# Parity Check

Use this procedure for design-match QA, including after implementation or refinement.
Do not declare parity until every required detail has passing evidence.

## Reference Routing

Record the exact reference, version/export date when known, component/node/frame,
represented viewport and state. Keep local reference hashes with the QA evidence.

| Reference | Evidence path |
|---|---|
| Figma | Use `figma-diff` for one node or `figma-qa` for a mapping, backed by `inspect.mjs`. Resolve the exact node and extracted intent, not a nearby text layer. |
| Pencil | Read the exact `.pen` file and node/frame through available Pencil tooling; retain extracted layout, typography, tokens and an export. Use `inspect.mjs` on the corresponding rendered element and parent. |
| Screenshot / mockup / design export | Record the original image dimensions, CSS viewport, export/device scale and crop. Compare a corresponding PNG capture with `inspect.mjs diff`, plus target measurements and visual inspection. |
| Reference website | Use `website-diff` and `inspect.mjs` for both rendered sides, with isolated browser contexts when state could cross over. |

If design tooling is unavailable, state it and use an existing validated mapping,
extracted spec or supplied export. Ask for missing intent rather than inventing it.
A bitmap cannot establish CSS font family, hidden states, interactions or responsive
rules by itself. Separate parity at the supplied viewport/state from responsive and
behavioural checks; do not extrapolate a desktop mockup to a mobile design.

## Image Comparison

For a PNG matching an `inspect` viewport preset and the target component bounds:

```bash
~/.codex/scripts/inspect.mjs diff \
  --image-a /absolute/path/reference.png \
  --url-b '<preview-url>' --a '<component-selector>' \
  --viewports desktop --max-diff-pct <agreed-percent> \
  --out /absolute/path/qa-run --format markdown
```

Use the Claude script path in Claude Code. Check the `inspect` skill and `INSPECT.md`
for supported flags. For a 1440px frame, use `--viewports desktop --viewport-size
1440x1000` rather than treating 1280px as equivalent; the override retains the preset's
DPR and input mode. When other capture settings are required, use the configured
browser at the reference viewport/scale and compare saved PNGs with `--image-a` /
`--image-b`; record the actual capture geometry, not the diff's preset label.
Measurements at other viewports are separate responsive evidence.
If exact-geometry measurements are required but unavailable, mark that check BLOCKED.
If `diff` cannot resolve project or shared `pixelmatch` / `pngjs`, mark pixel checks
BLOCKED and report `setup-inspect-diff.sh` as the setup needed; measurements can still run.

Export other formats to PNG without changing the composition; retain the original.
Any scale conversion or component crop needs known source geometry and a recorded
reason. Never resize or crop merely to force a pass. Dimension mismatches fail parity,
even though the tool can report pixel statistics over the common region.

## Procedure

1. **Enumerate required details** from the brief and resolved reference, within the affected scope:
   - Layout: width, height, padding, margin, gap, alignment
   - Typography: font-family, font-size, font-weight, line-height, letter-spacing, colour
   - Visual: background, border, border-radius, box-shadow, opacity
   - State: default, hover, focus, active, disabled, selected
   - Variants: every option (e.g. every swatch including white-border / out-of-stock / sold-out cases)
   - Viewports: 375, 768, 1280 (or whatever the project uses)
   - Behaviour: animation timing/easing, scroll, click, keyboard

2. **Measure the target with `inspect.mjs`**, not ad hoc browser snippets: `typography`,
   `box`, `styles`, `layout`, and `distance` for direct inter-element gaps. Measure
   the matching element AND its parent layout (`display`, `gap`, `padding`,
   `justify-content`, `align-items`). Compare with extracted design values, known
   image geometry or the measured reference website; do not claim computed CSS from
   an image. Record tolerances before judging results, with any dynamic exclusions
   justified. Use screenshots/diffs alongside numeric evidence and Playwright for
   actual interactions, following `playwright-lite` for browser coverage.

3. **Produce a checklist table**:

   | # | Detail / viewport / state | Reference | Current | Result | Evidence |
   |---|---|---|---|---|---|
   | 1 | mobile card padding | 16px 12px | 12px 12px | FAIL | extracted spec + inspect box report |
   | 2 | price font-size, desktop | 14px | 14px | PASS | extracted spec + inspect typography report |

4. **Recheck after authorised fixes**. Preserve intentional constraints; follow
   `playwright-lite` checkpoints before changing them. Re-run the exact failing
   measurements, diffs and interactions, recording before/after evidence.

5. **Report** using the revision-bound `qa-report.md` format in `playwright-lite`.
   Save the checklist and evidence outside Git; summarise findings and paths.
   Overall PASS requires every required row to pass. Missing reference, unknown
   scale, unavailable tools or unverifiable intent means BLOCKED for the affected
   check, never an assumed match. Changed source or reference makes affected results
   STALE until rechecked.

## Hard rules

- Visual inspection alone never closes measurable layout or typography checks.
  A passing pixel threshold alone does not establish all design or behaviour requirements.
- Do not silently substitute a weaker tool when required proof is unavailable.
- Wishlist hearts, hidden-on-hover elements and other intentional UX are not bugs;
  confirm intent before "fixing". An audit alone does not authorise edits.
