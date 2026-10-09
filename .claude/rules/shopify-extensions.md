---
paths:
  - "**/extensions/**"
  - "**/*.graphql"
  - "**/shopify.extension.toml"
  - "**/shopify.app*.toml"
---

# Functions / App Extensions

- Functions: latest stable API, deterministic `run`, validate `input.graphql`
- Handle empty carts, zero qty, missing metafields. Verify `combinesWith`
- New Customer Accounts (Polaris UI Extensions) for new builds
- Shopify CLI is pinned in `functions/package.json`, don't trust the global
