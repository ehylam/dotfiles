---
name: website-diff
description: Compare a reference website against a target website with pixelmatch screenshots and computed-style evidence. Use when the user asks for website-to-website, site-to-site, live-vs-preview, reference-vs-dev, URL-to-URL visual parity, or pixelmatch checks between two rendered websites.
---

# Website Diff

Use this skill for website-to-website visual parity checks. It is a wrapper workflow over `inspect.mjs diff` for one-off element comparisons and `figma-qa.mjs` reference-site mode for repeatable mappings.

## Command Paths

- Codex inspect wrapper: `~/.codex/scripts/inspect.mjs`
- Claude inspect script: `~/.claude/scripts/inspect.mjs`
- Codex Figma/reference QA wrapper: `~/.codex/scripts/figma-qa.mjs`
- Claude Figma/reference QA script: `~/.claude/scripts/figma-qa.mjs`

## Workflow

1. Identify the reference URL and target URL.
2. Resolve the element selectors with browser tooling or user-provided selectors. If either selector is ambiguous, ask for the selector instead of guessing.
3. For a one-off visual diff, run:

   ```bash
   ~/.codex/scripts/inspect.mjs diff \
     --url-a <REFERENCE_URL> \
     --url-b <TARGET_URL> \
     --a '<REFERENCE_SELECTOR>' \
     --b '<TARGET_SELECTOR>' \
     --viewports mobile,tablet,desktop \
     --threshold 0.1 \
     --max-diff-pct 1 \
     --out .figma-qa/visual-diffs/<slug> \
     --format markdown
   ```

   If both sites use the same selector, omit `--b`. If the target selector needs a different container, pass `--scope` for the reference side and `--scope-b` for the target side.

4. For multiple sections or recurring QA, create or update a `figma-qa` mapping using `referenceBaseUrl` and `visualChecks`:

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
             "id": "hero-pixels",
             "referenceSelector": ".legacy-hero",
             "selector": "section.hero",
             "viewports": ["mobile", "tablet", "desktop"],
             "threshold": 0.1,
             "maxDiffPct": 1
           }
         ]
       }
     ]
   }
   ```

5. Pair pixel evidence with computed-style checks when the reason for drift matters. Use `figma-qa` checks in reference-site mode, or use `$inspect` subcommands (`styles`, `box`, `typography`, `layout`) for targeted follow-up.
6. Summarise mismatch percentage, compared dimensions, dimension mismatch/cropping, and diff PNG paths. Mention any selector assumptions.

## Guardrails

- Default to mobile, tablet, and desktop unless the user explicitly narrows scope.
- Prefer element clips over full-page diffs. Full-page diffs are noisy with dynamic content, lazy loading, sticky bars, and personalization.
- Treat pixel diffs as visual evidence, not root cause. Use computed styles to explain why the pixels differ.
- Do not run production-changing actions. This skill is read-only.
