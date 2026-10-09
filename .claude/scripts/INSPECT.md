# `inspect.mjs` — Playwright-style page inspection CLI

A Node CLI that drives headless Chrome via CDP to measure spacing,
read computed styles, inspect flex/grid layouts, and check the box model of
any element on any URL, across mobile/tablet/desktop viewports.

Designed for Claude Code & Codex agents to invoke without writing browser
automation code. Honest about what it found (per-element warnings on
occlusion, sticky/fixed elements, SVG painted vs canvas bounds, etc.) and
quiet when there's nothing surprising.

**Claude location:** `~/.claude/scripts/inspect.mjs` (symlinked from `~/.dotfiles/.claude/scripts/`)
**Codex location:** `~/.codex/scripts/inspect.mjs` (wrapper that delegates to the canonical Claude script)
**Backwards-compat alias:** `measure-distance.mjs` -> `inspect.mjs distance`
**Requires:** Node 22+ with built-in WebSocket, and Chrome or Chromium for URL runs.
Missing WebSocket support fails before Chrome starts. Local PNG-only diffs also work
on Node 20 without WebSocket or Chrome. Measurements need no npm deps.
For pixel diffs, install pinned shared dependencies once:

```bash
bash ~/.claude/scripts/setup-inspect-diff.sh
```

This installs `pixelmatch` and `pngjs` under `${XDG_DATA_HOME:-~/.local/share}/inspect`,
outside client repos and dotfiles. Project dependencies take precedence; script-local
imports remain a fallback. No packages are downloaded during inspection. The
dotfiles installer runs this setup when provisioning a new machine; rerun it
separately if dependency setup failed. Verify with
`node ~/.claude/scripts/test_inspect_diff.mjs` (generated PNG evidence stays in OS temp).
Transport regressions: `node ~/.claude/scripts/test_inspect_transport.mjs` (local
HTTP fixtures). Browser and signal cleanup: `node ~/.claude/scripts/test_inspect_chrome.mjs`
(owned headless Chrome, temporary profiles).
Password navigation regression: `node ~/.claude/scripts/test_inspect_password.mjs`
(loopback password forms, immediate/cached and delayed redirects, rejection and
timeout, target/parent measurements at all three viewports). Password submission
returns from page evaluation before submitting, then waits in Node for a new
main-frame document. Rejected passwords report a locked-page error; a stalled
submission is bounded by `--timeout-ms`.

URL runs use Chromium, including mobile/tablet runs with Safari user-agent
strings. These are viewport emulations, not Safari/WebKit validation.
Locale handling, overlays and motion are preserved by default. Preparation
still makes lazy images eager and scrolls bottom/middle/top for hydration.
Reports disclose the engine and configured preparation. Use browser journeys
and explicit acceptance criteria alongside measurements for storefront QA.

Transport operations are bounded: Chrome startup has a 12s readiness deadline,
WebSocket connection 10s, and CDP commands 30s (evaluations allow their configured
page timeout plus 1s). Socket errors and closure reject pending commands immediately.
Remote PNG fetches, including response bodies, use `--timeout-ms`. Shutdown allows
2s for `Browser.close`, then sends SIGTERM and, after 2s, SIGKILL only to the owned
Chrome process. SIGINT and SIGTERM run the same cleanup. Chrome uses an automatically
assigned debugging port read from its private profile, so other browser sessions
are not used or killed.

For an outer wall-clock limit, GNU `timeout` (`gtimeout` on Homebrew macOS) can act
as a backup. Leave time after TERM for cleanup; this is separate from navigation:

```bash
gtimeout --kill-after=15s 180s node ~/.codex/scripts/inspect.mjs styles \
  --url https://example.com --a main --viewports desktop --format text
```

Increase the outer limit for multiple URLs, viewports or stability passes. Do not
use `--keep-browser` for QA. A forced SIGKILL of the CLI cannot run cleanup.

---

## Subcommands

### `distance` — gap between two elements

```bash
inspect.mjs distance --url <URL> --a <CSS_A> --b <CSS_B>
```

Output:
- `A.rect`, `B.rect` — viewport-anchored coordinates
- `distance.vertical` — `B.top − A.bottom` (positive = A above B)
- `distance.horizontal` — `B.left − A.right`
- `distance.centreToCentreVertical/Horizontal` — useful for centred-on-axis comparisons
- `sameAncestor` — descriptor of the nearest shared ancestor (useful for sanity checking)

### `typography` — text/font computed styles

```bash
inspect.mjs typography --url <URL> --a <CSS>
```

Output: `fontFamily`, `fontSize`, `fontWeight`, `fontStyle`, `fontStretch`,
`lineHeight`, `letterSpacing`, `wordSpacing`, `textAlign`, `textTransform`,
`textDecorationLine/Color/Style`, `textIndent`, `textShadow`, `whiteSpace`,
`overflowWrap`, `wordBreak`, `color`, `verticalAlign`,
`fontFeatureSettings`, `fontVariationSettings`, `fontKerning`,
`fontOpticalSizing`, plus:
- `firstFontFamily` — the leading entry in `font-family`
- `firstFontFamilyLoaded` — `document.fonts.check(...)` boolean. `false` means
  the page is rendering in a fallback font.
- `text` — first 240 chars of the element's text (for sanity)

### `layout` — flex/grid setup + children

```bash
inspect.mjs layout --url <URL> --a <CSS>
```

Output:
- Container's `display`, full flex or grid config (`flexDirection`, `flexWrap`,
  `justifyContent`, `alignItems`, `alignContent`, `gap`/`rowGap`/`columnGap`,
  or `gridTemplateColumns/Rows/Areas`, `gridAutoFlow`)
- Per-child: rect, `order`, `flexBasis/Grow/Shrink`, `alignSelf`,
  `gridRow/Column/Area`, margins
- `interChildGaps` — measured rect-to-rect gaps in render order; tells you the
  *actual* visual gap, useful when `gap` interacts with margins

### `box` — margin/padding/border breakdown

```bash
inspect.mjs box --url <URL> --a <CSS>
```

Output: DevTools-style box model.
- `margin`, `padding`, `border.width/style/color/radius` (per side)
- `boxes.margin / border / padding / content` — width and height at each box level

### `styles` — arbitrary computed CSS

```bash
inspect.mjs styles --url <URL> --a <CSS> [--properties p1,p2,…]
```

Default property set: a curated layout/box/flex/grid/type/misc bundle. Use
`--properties` (comma-separated, kebab-case or camelCase) to focus on just
what you need.

### `schema` - rendered JSON-LD syntax and declared types

```bash
inspect.mjs schema --url <URL> --required-types Product,BreadcrumbList
```

Parses all rendered `application/ld+json` scripts, including arrays and `@graph`.
Reports malformed blocks, invalid type declarations and missing required types.
`--required-types` is optional and should reflect the page's actual requirements.
An invalid result exits 1. This is a syntax/type-presence check, not Schema.org
semantic validation or Google rich-results eligibility.

Batch checks can use `{"id":"jsonld","subcommand":"schema","requiredTypes":["Product"]}`
without a selector. A failed schema check makes that batch exit 1.

### `batch` — multiple checks in one page load

```bash
inspect.mjs batch --url <URL> --batch-file checks.json
```

The batch subcommand reuses one Chrome page per viewport and runs many
checks against that settled page. This is the fast path for site-wide QA
or reference-site comparisons.

`checks.json` can be either an array or an object with a `checks` array:

```jsonc
{
  "checks": [
    {
      "id": "hero-heading",
      "subcommand": "typography",
      "selector": ".hero__title",
      "scope": ".hero"
    },
    {
      "id": "hero-layout",
      "subcommand": "layout",
      "selector": ".hero"
    }
  ]
}
```

Each check accepts `selector`/`aText`, `scope`, `properties`, `aIndex`,
`subcommand`, and the distance-specific `selectorB`/`bText` fields.

### `diff` — pixel-level visual comparison

```bash
inspect.mjs diff \
  --url-a <LIVE_URL> \
  --url-b <PREVIEW_URL> \
  --a <CSS> \
  --max-diff-pct 0.5 \
  --format markdown
```

For Figma-vs-theme checks, use a saved Figma PNG as one side and a
rendered URL capture as the other:

```bash
inspect.mjs diff \
  --image-a .figma-qa/screenshots/hero-desktop.png \
  --url-b https://example.com \
  --a 'section.hero' \
  --viewports desktop \
  --threshold 0.1 \
  --max-diff-pct 1 \
  --out .figma-qa/visual-diffs/hero \
  --format markdown
```

For website-to-website checks with different markup, use `--a` for the
reference-side element and `--b` for the target-side element:

```bash
inspect.mjs diff \
  --url-a https://www.example.com \
  --url-b https://dev.example.com \
  --a '.legacy-hero' \
  --b 'section.hero' \
  --scope '.main-content' \
  --scope-b 'main' \
  --viewports mobile,tablet,desktop \
  --threshold 0.1 \
  --max-diff-pct 1 \
  --out .figma-qa/visual-diffs/home-hero \
  --format markdown
```

Output includes mismatch percentage, compared dimensions, dimension
mismatch warnings, and paths to the reference, rendered, and diff PNGs.
Pixel statistics compare the common top-left region. Any dimension mismatch
fails a supplied `--max-diff-pct` gate, even if that region matches perfectly.

---

## Common flags (all subcommands)

| Flag | Default | Meaning |
|---|---|---|
| `--url <URL>` | — | Single-page measurement |
| `--url-a <URL>` `--url-b <URL>` | — | Compare two URLs. `diff` emits a pixel report; other subcommands run against both and emit a delta block. Aliases: `--url-live` / `--url-preview` |
| `--image-a <PATH_OR_URL>` `--image-b <PATH_OR_URL>` | — | Use a PNG image as either side of `diff`, useful for Figma screenshot vs rendered theme comparisons |
| `--a <CSS>` / `--selector-a <CSS>` | — | Primary locator (required) |
| `--b <CSS>` / `--selector-b <CSS>` | — | Secondary locator for `distance`; optional target-side locator for `diff` URL B when markup differs |
| `--a-text <STR>` / `--b-text <STR>` | — | Locate by visible text (case-insensitive, picks smallest matching element) |
| `--a-index N` / `--b-index N` | `0` | Pick the Nth visible match if the locator hits multiple |
| `--scope <CSS>` | `document` | Restrict locator search to inside this container (avoids picking the mobile-menu copy vs the desktop-nav copy of the same element) |
| `--scope-b <CSS>` | `--scope` | Target-side locator scope for `diff` URL B when markup differs |
| `--viewports mobile,tablet,desktop` | all three | Subset of viewports to run |
| `--viewport-size <WIDTHxHEIGHT>` | preset geometry | Exact geometry for one selected preset, e.g. `--viewports desktop --viewport-size 1440x1000`; retains that preset's DPR, touch and user agent; dimensions 1-16384 |
| `--init-script <JS>` | — | Awaited after navigation, before measurement. Use for cart priming, banner dismissal, login |
| `--wait-ms <N>` | `2500` | Extra settle wait after fonts/images |
| `--timeout-ms <N>` | `30000` | Navigation, page evaluation and remote PNG-fetch timeout |
| `--storefront-password <STR>` | — | Auto-unlocks Shopify password-protected previews |
| `--format json\|markdown\|text` | `json` | Output format |
| `--label <STR>` | — | Free-form label echoed into the output |
| `--reduce-motion` | off | Opt in to `prefers-reduced-motion: reduce` and animation/transition suppression |
| `--hide-overlays` | off | Opt in to broad cookie/consent/chat/preview-bar CSS suppression; may also hide real content with matching names |
| `--no-reduce-motion` / `--no-hide-overlays` | accepted | Legacy flags that disable the corresponding opt-in |
| `--stability-passes N` | `1` | Run subcommand N times; flag drift between passes |
| `--svg-canvas-bounds` | off | Measure `<svg>` elements as their canvas bounds instead of painted content |
| `--batch-file <PATH>` | — | JSON checks array for `batch` |
| `--keep-browser` | off | Leave headless Chrome running on exit (for debugging) |

---

## Viewports

| Name | Width × Height | DPR | Touch | Hover | Pointer |
|---|---:|---:|---|---|---|
| mobile | 375 × 844 | 2 | yes | `none` | `coarse` |
| tablet | 768 × 1024 | 2 | yes | `none` | `coarse` |
| desktop | 1280 × 1000 | 1 | no | `hover` | `fine` |

Plus per-viewport `prefers-color-scheme: light`, `orientation` (portrait for
mobile/tablet, landscape for desktop), and a mobile/desktop UA string.
`prefers-reduced-motion: reduce` is requested only with `--reduce-motion`.

---

## Output formats

### `--format json` (default)

```jsonc
{
  "subcommand": "distance",
  "browserEngine": "Chromium", // null for PNG-only diffs
  "pagePreparation": {
    "reduceMotion": false, "hideOverlays": false, "initScript": false,
    "eagerImages": true, "scrollForLazyHydration": true, "localeOverride": false
  },
  "generatedAt": "2026-05-14T07:00:00.000Z",
  "label": "...",
  "locators": { "a": "selector: .foo", "b": "selector: .bar" },
  "targets": [
    {
      "label": "page",  // or "A"/"B" when comparing
      "url": "https://...",
      "viewports": {
        "mobile":  { /* per-subcommand result */ },
        "tablet":  { /* ... */ },
        "desktop": { /* ... */ }
      }
    }
  ]
}
```

Per-element dump (`a`, `b`):

```jsonc
{
  "descriptor": "p.font-semibold.text-lg.go-pdp-price",
  "tag": "p",
  "rect":       { "top": …, "right": …, "bottom": …, "left": …, "width": …, "height": … },
  "rectSource": "border-box" | "svg-painted-content",
  "canvasRect": { /* present only when rectSource is svg-painted-content (or --svg-canvas-bounds set) */ },
  "warnings":   ["element has position: fixed — …", "svg painted content …"],
  "parent":     { "descriptor": "...", "styles": { /* gap, flex, grid, padding, margin */ } }
}
```

### `--format markdown` / `--format text`

Human-readable tables for distance (per-viewport rows with `Vertical` /
`Horizontal` columns) and key-value blocks for typography/box/layout. When
comparing two URLs, both formats emit a final delta table.
All formats disclose `browserEngine` and `pagePreparation`. Preparation
fields describe the configured transformations; PNG-only diffs use `null`.

---

## Correctness features (baked in)

Things that have caused false positives in screenshot-diff tools and that
this script actively guards against:

| Risk | Mitigation |
|---|---|
| Fallback font instead of webfont | `await document.fonts.ready` before measurement + `document.fonts.check()` boolean per measurement |
| Lazy images shifting layout post-measure | All `loading="lazy"` flipped to eager, then await completion |
| IntersectionObserver-hydrated widgets not rendered | Scroll to bottom → middle → top before measuring |
| Carousels rotating between rect read and screenshot | `--stability-passes` reveals drift; optional `--reduce-motion` changes animation/transition behaviour |
| Cookie / consent / preview-bar overlays pushing layout | Preserved by default; dismiss deliberately with `--init-script` or opt in to broad `--hide-overlays` CSS suppression |
| `@media (hover)` / `@media (pointer)` mis-resolving on mobile | Set per-viewport via `Emulation.setEmulatedMedia` (`hover`, `any-hover`, `pointer`, `any-pointer`) |
| `@media (orientation)` mis-resolving | Set explicitly per viewport |
| Reduced-motion variant needs verification | Set to `reduce` only with `--reduce-motion`; disclose the changed state |
| Locale formatting changed by the tool | Native `Intl.DateTimeFormat` and `Intl.NumberFormat` are preserved, including explicit locale arguments and static methods |
| Stale layout from queued style/layout work | Forced layout flush (`void document.documentElement.offsetHeight`) before every measurement |
| Element visually occluded by an overlay | `elementFromPoint(centerX, centerY)` check → warning when the topmost element isn't the located one |
| Element off-screen | Warning when the centre is outside the current viewport (scroll-position dependent) |
| `position: sticky/fixed` / `transform: …` elements | Per-element warning explains the rect is scroll- or transform-dependent |
| Flaky carousels / popups / late-arriving widgets | `--stability-passes N` reruns the measurement, diffs the rects/styles, emits `FLAP` warnings on drift |
| Multiple matches → wrong element on different viewports | `--a-index N`, `--scope <CSS>`, or `--a-text` for disambiguation |
| `<svg>` canvas reporting empty padding as part of its rect | Painted-content union of `path/rect/circle/ellipse/line/polygon/polyline/text/use/image/foreignObject/g` (opt-out: `--svg-canvas-bounds`) |

---

## SVG painted vs canvas bounds

When the located element is an `<svg>`, `getBoundingClientRect()` returns
the **canvas** dimensions — i.e. the `width`/`height` / `viewBox` rectangle.
The visually painted content is usually smaller. By default the script
walks the SVG's graphic descendants and uses the **union of their painted
rects** as the measurement rect.

```text
| Viewport | A rect                          | Vertical | Horizontal | Note                                     |
| ---      | ---                             | ---:     | ---:       | ---                                      |
| desktop  | (svg-painted-content) 76,76 30×30 | -29px  | 56px       | svg painted content (30×30) is smaller than its canvas (102×102); measuring against painted bounds. Use --svg-canvas-bounds to override. |
```

JSON output exposes both `rect` (painted) and `canvasRect` (full SVG box)
when they differ, so downstream tools can pick.

---

## Locator strategies

- **CSS selector** (`--a 'p.go-pdp-price'`): exact, fast, can match multiple → use `--a-index N`.
- **CSS union** (`--a '.nosto-title, [class*="recommendations" i] h3'`): try several patterns at once. The first visible match wins. Useful when comparing markup that differs between live and preview themes.
- **Visible text** (`--a-text "Add to cart"`): walks the DOM, picks the smallest visible element whose direct text contains the needle. Case-insensitive. Best when CSS classes differ but copy is stable.
- **Scoped** (`--scope 'main, [role="main"]'`): restrict the search root. Essential when the same selector matches both the mobile menu and the desktop nav (or the global footer's payment icons vs the cart page's).

---

## Common workflows

### Verify a typography fix didn't regress across viewports

```bash
inspect.mjs typography --url https://staging.example.com/products/handle \
  --a 'h1.product-title' --format text
```

### Confirm spacing between two elements matches the live site

```bash
inspect.mjs distance \
  --url-a https://www.example.com/cart \
  --url-b https://www.example.com/cart?preview_theme_id=12345 \
  --a '.payment-icons' --b '.recommendations h3' \
  --init-script 'await fetch("/cart/add.js",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({id:VARIANT_ID,quantity:1})})' \
  --format markdown
```

### Audit a product-grid's flex/grid setup

```bash
inspect.mjs layout --url https://example.com/collections/all \
  --a '.product-grid' --format text
```

### Check the box model of a CTA button at every viewport

```bash
inspect.mjs box --url https://example.com \
  --a '.cta-primary' --stability-passes 2 --format text
```

### Catch flaky elements before drawing conclusions

```bash
inspect.mjs distance --url https://example.com \
  --a '.hero h1' --b '.hero .cta' \
  --stability-passes 3 --format text
# Look for "FLAP: distance varied across passes" in the output.
```

---

## Limitations (documented, not fixed)

- **`mask` / `clip-path`** — `getBoundingClientRect` returns *unclipped* bounds; the painted-bounds union may slightly over-estimate.
- **SVG used as a CSS `background-image`** — out of scope; only inline `<svg>` content is measurable.
- **CSS `dvh` / `svh` / `lvh`** — depend on URL-bar visibility in real Safari; emulation doesn't simulate it.
- **Element occlusion check** — only checks the element's centre point. An element partially covered at the edges is not flagged.
- **Container queries (`@container`)** — should work, but if a container resized mid-tick the children may need an extra frame to re-evaluate. Use `--wait-ms 5000` if you suspect this.
- **Storefront-side rendering engines that differ** (SearchSpring vs Tagalys vs Nosto on the same page) — markup will diverge; use union locators or `--a-text`.

---

## Exit codes

- `0` - requested probes completed and any supplied gates passed. Measurements alone do not prove acceptance criteria or complete storefront QA.
- `1` - a viewport/check reports an error, an init script fails, a schema check is invalid, a pixel gate fails, Chrome fails to launch, or an exception escapes. Structured results remain on stdout when available.

---

## See also

- `~/.claude/scripts/measure-distance.mjs` - Claude thin alias to `inspect.mjs distance` (backwards-compat).
- `~/.codex/scripts/measure-distance.mjs` - Codex thin alias to `inspect.mjs distance` (backwards-compat).
