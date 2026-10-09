# Reusable Component QA

Use for any project's rendered UI review: Figma, Pencil, screenshot/mockup or an
approved reference site. This recipe is read-only. Findings do not authorise fixes,
form submissions, settings changes, publishing or deployment.

## Prepare The Mapping

Start from `mapping.template.json` and `inspect-checks.template.json`. Save the
completed mapping at the project's established QA location, or outside Git if none
exists. Keep exports, screenshots, reports, traces and auth outside Git.

The mapping deliberately fails strict validation until completed. Replace every
`REPLACE_` field and supply the actual base URL and extracted `intent` objects;
do not infer design values from the preview. Add/remove checks to fit the affected
scope, including sibling elements and relevant parent containers.

- Resolve the exact reference/node, version, viewport and state. For local exports,
  retain original dimensions, CSS viewport, export/device scale, crop and SHA-256.
- Record reference approval and tolerance approval in the QA plan: approver/date,
  scope, numerical values and justified dynamic exclusions. Pending approval means
  diagnostic comparison only, not client acceptance. Do not replace a design with
  the current preview screenshot just to establish a passing baseline.
- Use `$parity` for reference extraction. The Figma runner also accepts extracted
  Pencil intent and PNG exports through its existing `figmaScreenshot` field. For
  reference websites, use `referenceBaseUrl` with explicit reference locators and
  properties, following `FIGMA-QA.md` and `$website-diff`.
- Only assert values the reference proves. A bitmap does not prove CSS font family,
  hidden states or responsive rules. Figma AUTO line height is not a numeric CSS
  requirement. Verify font aliases using loaded font/asset evidence; different
  names alone do not establish a font mismatch.
- Preserve preview/theme, locale, market, cookies, scroll and component state.
  Where needed, use a task-specific `initScript` to assert build identity without
  mutation. If inspect cannot reproduce a required authenticated/stateful view,
  keep browser evidence and mark the missing measurements BLOCKED.

## Tolerances

Choose tolerances before judging, per property and required state. No client-wide
threshold is supplied by this template. Suggested diagnostic starting points are
1 CSS px for fractional dimensions/direct distances, exact specified typography
and colours after normalisation, and a 1% pixel gate with sensitivity 0.1.
These are proposals, not approved acceptance criteria.

Use per-check `tolerance` maps for the chosen numeric properties, not a broad
`--default-tolerance` that might excuse unrelated font or spacing drift. Set
`maxDiffPct` and `threshold` on each visual check, or pass the CLI equivalents.
Dimension mismatches fail independently when a pixel gate is supplied. Pixel
percentage covers the common region when dimensions differ, not the full frame.
Do not resize, crop or mask actual differences to force a pass.

## Run And Retain Evidence

Run from a directory containing the reference export, or use absolute PNG paths.
Relative image paths resolve from the command's working directory, not the mapping.
Use the actual reference geometry below, not a nearby viewport preset. The exact
override keeps preset DPR/input mode; if those differ from the export, capture
saved PNGs through the owned browser at the correct scale and use `inspect diff`.
Run additional responsive presets separately, without the exact-size override.

```bash
# Set these from the resolved QA plan, not from this template.
# mapping, checks, target, viewport_size, pixel_sensitivity, pixel_gate
run=$(mktemp -d "${TMPDIR:-/tmp}/component-qa.XXXXXX")
printf 'Evidence: %s\n' "$run"

node "$HOME/.codex/scripts/figma-qa.mjs" \
  --input "$mapping" --strict-mapping --validate \
  --viewports desktop --viewport-size "$viewport_size"

node "$HOME/.codex/scripts/figma-qa.mjs" \
  --input "$mapping" --strict-mapping --skip-conformance \
  --viewports desktop --viewport-size "$viewport_size" --fail-on any \
  --visual-threshold "$pixel_sensitivity" --visual-max-diff-pct "$pixel_gate" \
  --visual-diff-out "$run/pixels" \
  --report "$run/drift-report.md" --json-report "$run/drift-report.json"

node "$HOME/.codex/scripts/inspect.mjs" batch \
  --url "$target" --batch-file "$checks" \
  --viewports desktop --viewport-size "$viewport_size" --format json \
  > "$run/measurements.json"
```

Use the Claude script paths inside Claude Code. Run commands separately in shells
using `set -e`: exit 1 may be an expected mismatch with valid retained evidence.
A successful measurement command means probes completed, not that criteria passed.

The runner compares styles, not direct distance fields or relative element offsets.
The separate inspect batch is required for those rows. Compare `distance.horizontal`
or `distance.vertical` as appropriate, and use measured `a.rect` coordinates for
relative offsets. Inspect both elements and parent layout; do not infer physical
gaps from width arithmetic or CSS margins alone. Keep interaction, keyboard/focus,
console and relevant network checks in the browser.

Preview bars and consent banners can affect pixels. Use real dismiss controls only
when the comparison state calls for it, then recheck preview identity and geometry.
Record any preparation; broad overlay suppression or reduced motion is not neutral.
Treat pixel mismatch as supporting evidence alongside properties and composition,
not as a diagnosis by itself. New image/copy may be approved content rather than a bug.

## Report

Use the revision-bound `qa-report.md` format in `$playwright-lite`; link the drift
report, raw inspect output and viewed PNGs. Record source identity before/after,
exact URLs/theme/market, actual browser/viewport/DPR, reference and mapping hashes,
commands, criteria/tolerances and approval status. Unknown remote source revision
must be explicit. Each required row needs PASS, FAIL or BLOCKED and an artifact.

Report the automated subset separately from manual distance, font, composition,
state and interaction rows. Overall PASS requires every required row on the current
tested state and resolved acceptance criteria. A desktop reference is not mobile
parity; Chromium emulation is not native Safari/iOS. Include task-required native
Apple checks or their exact blocker. Close owned browsers when done. Later source,
content, preview or reference changes make affected evidence STALE until rechecked.
