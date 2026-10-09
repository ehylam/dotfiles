---
name: figma-diff
description: Run a one-off comparison between a Figma node and a rendered site element. Use when the user asks for figma-diff, to compare one Figma node to one CSS selector, or to sanity-check a single component without a full figma-qa mapping file.
---

# Figma Diff

Use this skill for a single Figma node versus a single rendered element. For multi-target audits, use `$figma-qa`.

## Requirements

The user needs to provide or imply:

- Figma URL with `node-id`
- Live URL
- CSS selector or visible text for the rendered element
- Optional viewport and property focus
- Optional request for pixel-level visual comparison

If Figma MCP tools are not available in the current runner, do not make up design values. Ask the user for the extracted design intent, or ask them to run the `figma-diff` skill in Claude Code, where Figma MCP is connected.

## Workflow

1. Parse the Figma file key and node id. Convert URL node ids like `1234-5678` to API form `1234:5678`.
2. Extract design intent with Figma MCP if available. Follow `WORKFLOW.md` in this skill's folder for the exact MCP calls.
3. Pick the most diagnostic `inspect.mjs` subcommand:
   - `typography` for font, weight, line-height, colour, and text alignment.
   - `box` for padding, margin, border, radius, and sizing.
   - `layout` for flex/grid structure and gaps.
   - `styles --properties ...` for focused property checks.
4. Run the rendered measurement through `$inspect`.
5. If a Figma screenshot is available and the user wants visual parity, save the screenshot and run:

   ```bash
   ~/.codex/scripts/inspect.mjs diff \
     --image-a <figma-screenshot.png> \
     --url-b <live-url> \
     --a <selector> \
     --viewports <viewport> \
     --max-diff-pct <threshold> \
     --format markdown
   ```

6. Normalise colours, font-family, lengths, and weights before comparing.
7. Lead with the kind of drift, then show a compact property table and any pixel mismatch percentage.

## Guardrails

- Do not fabricate missing Figma values.
- Prefer SVG painted bounds for icon checks. Only use `--svg-canvas-bounds` when checking the declared icon slot.
- Pixel diffs are sensitive to content, image crop, fonts, and anti-aliasing. Use them alongside property-level measurements, not instead of them.
- Summarise the Figma MCP output; do not paste the full response.
