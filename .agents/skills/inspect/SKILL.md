---
name: inspect
description: Use the local inspect.mjs CLI to measure rendered pages across mobile, tablet, and desktop viewports. Use for design-match QA against Figma, Pencil, screenshots or mockups; URL inspection; spacing, typography, computed styles, flex/grid and box-model checks; live/preview comparison; and pixel-level visual diffs.
---

# Inspect

Use the local `inspect.mjs` CLI for precise rendered-page measurements instead of ad hoc browser snippets when a task needs numeric spacing, typography, layout, or box-model evidence.

For QA against Figma, Pencil, screenshots or mockups, follow the shared `parity`
skill for reference extraction, geometry, tolerances and the acceptance checklist.
Measure the target element and parent here; an exit-0 probe is not a design-match verdict.

## Command Path

- Codex: `~/.codex/scripts/inspect.mjs`
- Claude Code: `~/.claude/scripts/inspect.mjs`
- Backwards-compatible distance alias: `measure-distance.mjs`

Read `~/.claude/scripts/INSPECT.md` only when you need full flag details or output schema. Do not paste that document back to the user.

## Routing

Map the user's request to a subcommand:

- `distance`: gap, spacing, or distance between two elements.
- `typography`: font family, size, weight, line height, letter spacing, or text rendering.
- `layout`: flex/grid setup, column count, child placement, or parent layout context.
- `box`: margin, padding, border, radius, or box model.
- `styles`: arbitrary computed CSS properties or unclear inspection requests.
- `batch`: multiple checks against one settled page. Prefer this for orchestrators or site-wide QA.
- `diff`: pixel-level visual comparison of two states (URL A vs URL B). Use when numbers match but the render might not, or to confirm a fix visually. See Visual Diff below.

Default to all three viewports unless the user explicitly asks for a narrower check. Default to `--format text` for conversational answers, `--format markdown` for reports, and `--format json` for downstream tooling.

For exact design geometry, select one preset and add `--viewport-size WIDTHxHEIGHT`
(e.g. `--viewports desktop --viewport-size 1440x1000`). This overrides dimensions,
not the preset's DPR or input mode; keep other responsive checks separate.

## Locator Strategy

Prefer selectors the user provides. If the selector fails, try a broader CSS union or visible text lookup before giving up. Use `--scope` when the same element appears in multiple regions such as mobile navigation, desktop navigation, footer, and main content.

For Shopify preview comparisons, use the live URL as `--url-a` and the preview URL as `--url-b`. If a preview is password-gated, ask once and pass `--storefront-password`.

## Page State and Stability

- Preserve locale, overlays and motion by default. `--hide-overlays` applies broad CSS selectors and can hide real content with cookie/consent/chat names. Prefer a deliberate interaction or a targeted `--init-script` when a banner must be dismissed. Use `--reduce-motion` only for an intentional reduced-motion comparison; it also suppresses animations and transitions. Both options alter the page and must be stated alongside the evidence. Legacy `--no-hide-overlays` and `--no-reduce-motion` remain accepted.
- Every URL run uses Chromium, including mobile/tablet runs with Safari user-agent strings. It cannot verify Safari/WebKit behaviour. Reports include `browserEngine` and `pagePreparation`; even default preparation loads lazy images and scrolls for hydration.
- **Cart or account pages need state.** Pass `--init-script` to prime it. For a Shopify cart:

  ```js
  await fetch('/cart/add.js', { method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: VARIANT_ID, quantity: 1 }) });
  await new Promise(r => setTimeout(r, 800));
  ```

  No variant ID from the user? Read one from `/products/<handle>.js` (first sitemap product is fine) and bake the integer in. Do not ask the user to look it up.
- **"Is this flaky?", "double-check", "verify"**: add `--stability-passes 2` or `3`. Otherwise keep one pass, since passes multiply wall-clock time.

## Visual Diff (`diff`)

`diff` is the pixel layer on top of the numeric subcommands: it screenshots two states at the same viewport, reports the mismatched-pixel count and percentage, and writes `<viewport>-{a,b,diff}.png` for eyeballing.

- Requires `--url-a` and `--url-b` (e.g. live vs preview), or PNG image inputs through `--image-a` / `--image-b`. Clip to one element with `--a`/`--a-text` (recommended, most robust); use `--b`/`--b-text` and `--scope-b` when URL B uses different markup. Omit locators for the visible viewport, or use `--full-page` for the whole document. Captures of differing size are cropped to the common top-left region for pixel statistics, but any dimension mismatch fails a supplied `--max-diff-pct` gate.
- `--threshold <0..1>` tunes per-pixel sensitivity (default 0.1). `--max-diff-pct <N>` turns it into a pass/fail gate. `--out <DIR>` chooses where PNGs land (default: a fresh OS-temp dir, never the repo).
- Loads `pixelmatch` + `pngjs` from the current project first, then `${XDG_DATA_HOME:-~/.local/share}/inspect`, then script-local imports. Run `bash ~/.claude/scripts/setup-inspect-diff.sh` once for pinned shared dependencies outside client repos. Measurement commands stay dependency-free; QA never downloads packages, and missing diff dependencies block pixel checks.
- This is the quick local complement to the agency `visual-regression` skill (the CI/PR gate) and `figma-qa` (design-to-site). Reach for `diff` during the fix loop; leave the gate to `visual-regression`.

## Figma Spacing Checks

When a spacing request references Figma nodes, resolve each node before measuring:

- Read Figma metadata for both nodes and identify whether each target is a section/frame, container, component, or descendant text/icon.
- Measure the rendered element matching the named Figma node itself, not a child label or hydrated text inside it, unless the user explicitly asks for that child.
- If a Figma parent contains internal padding before the visible text, measure both the outer wrapper and the visible child when useful, and clearly label which gap answers the request.
- For design-to-code spacing, compare outer box to outer box by default, such as gallery frame bottom to recommendation section wrapper top.
- If a text locator is only a proxy for a larger Figma node, state that before using it and confirm the wrapper selector with `styles` or `box`.

## Invocation

URL inspection requires Node 22+ with built-in WebSocket support. Check `node -v`
when the project pins an older runtime; use an installed compatible Node for the
CLI. Missing WebSocket support fails before Chrome starts. Local PNG-only diffs
can still run on Node 20 without Chrome or WebSocket.

Run the CLI in the foreground with a long enough timeout for all viewports:

```bash
~/.codex/scripts/inspect.mjs <subcommand> <flags>
```

Use the Claude path instead when operating inside Claude Code. Allow 180s or more: multi-viewport runs take 2 to 3 minutes on pages with heavy lazy hydration. Run in the foreground, since the output is needed before interpreting.

The CLI bounds Chrome startup, WebSocket connection, CDP requests and remote-image
fetches internally. Socket closure rejects pending requests. Normal failures,
SIGINT and SIGTERM clean up only the Chrome process and profile created by this
run, with bounded TERM/KILL escalation. An outer timeout is an optional backup:

```bash
gtimeout --kill-after=15s 180s node ~/.codex/scripts/inspect.mjs styles \
  --url https://example.com --a main --viewports desktop --format text
```

Use `timeout` on systems with GNU coreutils under that name. Increase the limit
for multiple URLs/viewports or stability passes, and allow 15s after TERM for
cleanup. A forced SIGKILL of the CLI prevents its cleanup from running.

Example, live vs preview cart spacing with a primed cart:

```bash
~/.claude/scripts/inspect.mjs distance \
  --url-a https://www.example.com/cart \
  --url-b 'https://www.example.com/cart?preview_theme_id=12345' \
  --a '.payment-icons, ul.list-reset' \
  --b '.recommendations h3, [class*="recommendation" i] h3' \
  --init-script 'await fetch("/cart/add.js",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({id:VARIANT_ID,quantity:1})}); await new Promise(r=>setTimeout(r,800));' \
  --format markdown
```

## Interpretation

Read all viewport rows and warnings before answering. Call out occlusion, off-screen elements, sticky/fixed positioning, transforms, SVG painted-content bounds, and `FLAP` drift when present.

Missing selectors, measurement/setup errors, invalid schema checks and failed pixel gates exit 1 while retaining the JSON report. Treat any such result as failed verification. Exit 0 means the requested probes completed and any supplied gates passed; measurements alone do not establish acceptance criteria or complete storefront QA.

Lead with the answer, then include the measurement evidence. Summarise long output rather than pasting raw JSON or large tables.

- When A and B differ, lead with the property that drifted, not the table: "font-weight on `.go-pdp-price` is `600` on live and `400` on preview, desktop only; mobile matches."
- An empty delta table means no drift between A and B. Say so explicitly: it is good news, not a missing result.
- `FLAP` means the reading is unstable: re-run with a longer `--wait-ms`, or report the element as flaky.

## Guardrails

- Do not use `--keep-browser`.
- Use `--svg-canvas-bounds` when checking an icon against a fixed slot (e.g. `width: 24px`) rather than its painted bounds. Confirm the expected bounds before interpreting the measurement.
- Do not invent flags. Check `~/.claude/scripts/INSPECT.md` when unsure.
