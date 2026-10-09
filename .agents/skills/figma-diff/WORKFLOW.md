# /figma-diff — one-shot Figma node ↔ rendered element

Quick comparison of a single Figma node against a single rendered element
on a live URL. No mapping file required. Good for sanity-checking one
specific component without setting up a full `/figma-qa` workflow.

For multi-component site-wide audits, use `/figma-qa` instead.

## What the user provides

The user passes some combination of:

- A Figma URL with a node-id (`figma.com/design/<file>/...?node-id=<id>`)
- A live URL
- A CSS selector for the rendered element
- Optional: viewport(s), subcommand hint
- Optional: request for pixel-level visual comparison

If any of these is missing and you can infer it from earlier conversation
context, do so. Otherwise ask.

## Workflow

1. **Parse Figma URL** — extract `fileKey` and `nodeId` (convert
   `1234-5678` → `1234:5678` for the API).

2. **Extract design intent**

   ```
   mcp__claude_ai_Figma__get_design_context
       fileKey=<key> nodeId=<id> clientLanguages=html,css clientFrameworks=vanilla
       disableCodeConnect=true
   ```

   Parse the response:
   - The "These styles are contained in the design: …" block lists named
     typography styles + values (font-family, weight, size, line-height,
     letter-spacing).
   - The generated React/Tailwind code contains rendered colours, paddings,
     gaps, and `data-node-id` attributes pointing at sub-elements.
   - The screenshot in `<output_image>` is the ground-truth visual.

3. **Run inspection against the live element**

   Pick the right subcommand based on what's most diagnostic for this
   component:

   - Typography drift suspected → `typography`
   - Spacing / layout drift suspected → `box` or `layout`
   - Specific property drift → `styles --properties prop1,prop2,...`

   ```bash
   ~/.claude/scripts/inspect.mjs <subcommand> \
     --url <LIVE_URL> --a <SELECTOR> \
     --viewports <viewports> --format json
   ```

4. **Diff and present**

   If the user asks for visual parity or the screenshot is the clearest
   evidence, save the Figma screenshot locally and run a pixel-level check:

   ```bash
   ~/.claude/scripts/inspect.mjs diff \
     --image-a <figma-screenshot.png> \
     --url-b <LIVE_URL> \
     --a <SELECTOR> \
     --viewports <viewport> \
     --threshold 0.1 \
     --max-diff-pct 1 \
     --format markdown
   ```

   For each property in the Figma intent, compare to the rendered value
   (normalise colours to hex lowercase, font-family to the first family
   in the stack, sizes to px). Emit a small drift table:

   ```
   | Property      | Design        | Rendered         | Notes |
   | font-weight   | 400 (Regular) | 600 (Semibold)   | 2 weight steps heavier than spec |
   | color         | #FFFFFF       | #F8F6F2          | rendered uses Light Cream token; design specifies Natural White |
   | letter-spacing| 0             | -0.5px           | tightened tracking not in design |
   ```

   Lead with the *kind* of drift. If the rendered colour matches a
   foundations token (e.g. one the user previously listed) but the
   design specifies a different token, say so — that's the most
   actionable framing.

## Code Connect

Skip Code Connect setup by passing `disableCodeConnect: true`. If the user
explicitly asks "can you map this to my code", run
`mcp__claude_ai_Figma__get_code_connect_suggestions` instead.

## Examples

User: "Compare the hero heading in figma.com/design/abc/?node-id=3707-18089
to h2.hero__title.rte on https://au.k9felinenatural.com/"

1. fileKey=`abc`, nodeId=`3707:18089`
2. `get_design_context` → "Desktop/Headings/H2: Noto Serif Regular 48 / 1.1 / 0",
   colour `#FFFFFF`, text-align center
3. `inspect.mjs typography --url 'https://au.k9felinenatural.com/' --a 'h2.hero__title.rte' --viewports desktop`
4. Drift: font-weight 400→600, colour `#FFFFFF`→`#F8F6F2`, letter-spacing 0→-0.5px

User: "Check the CTA button spacing in this Figma node"

1. Extract intent — padding, gap, height
2. `inspect.mjs box --url … --a '.cta-primary'`
3. Show margin/padding/border drift.

## Don't

- Don't make up Figma values. If extraction returns no style block for a
  given property (e.g. the node is purely a wrapper), say so — don't fill
  the gap with assumptions.
- Don't run `--svg-canvas-bounds` when comparing an icon — the painted
  bounds match the designer's perception. Only override if you can
  justify why.
- Don't use pixel mismatch percentage alone as the verdict when copy,
  images, fonts, or dynamic content differ legitimately. Pair it with
  property measurements and note the cause.
- Don't paste the whole `get_design_context` response back. Distil it.

The user's request (URLs, node ids, mapping file path) is the input.
