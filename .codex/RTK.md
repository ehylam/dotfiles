# RTK

RTK is available as a token-saving shell proxy.

Prefer RTK for noisy shell output such as `rtk git status`, `rtk git diff`, `rtk grep "pattern" .`, `rtk read path/to/file`, and broad test runs.

Do not use filtered RTK output as the only evidence for Shopify storefront QA, Playwright/Chrome visual checks, Shopify CLI preview flows, console/network inspection, screenshots, or logs that need exact wording. Use raw commands or `rtk proxy <cmd>` for those paths.

If RTK reports a failure, truncates relevant output, or points to a tee log, inspect the raw artifact before making a claim.
