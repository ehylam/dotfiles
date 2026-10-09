---
paths:
  - "**/*.liquid"
  - "**/sections/**"
  - "**/snippets/**"
  - "**/blocks/**"
  - "**/templates/**/*.json"
  - "**/config/settings_schema.json"
---

# Liquid / Theme

- Sections self-contained (own schema/styles/scripts). No `theme.liquid` edits unless required
- Dawn conventions. Section-scoped CSS via `asset_url | stylesheet_tag`
- `Shopify.designMode` for editor JS. Validate JSON template block IDs
- No hardcoded prices/currencies/customer strings (use `| t`)
- Metafields/metaobjects for structured data, not tags
- Semantic HTML; WCAG 2.1 AA min (DDA); `| escape` UGC
- Vanilla CSS/JS unless project diverges; CSS custom properties + BEM (or local convention)
- `defer`/module scripts, functions <50 lines, early returns, explicit error handling
- Validate via real site navigation, not synthetic POSTs
