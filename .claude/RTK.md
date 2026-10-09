# RTK

RTK is installed as a token-saving shell proxy for noisy development output.

Use RTK for compact shell evidence:

```bash
rtk git status
rtk git diff
rtk grep "pattern" .
rtk read path/to/file
rtk npm test
rtk playwright test
rtk gain
```

Do not use filtered RTK output as the only evidence for Shopify storefront QA, Playwright/Chrome visual checks, Shopify CLI preview flows, console/network inspection, screenshots, or logs that need exact wording. Use raw tools or `rtk proxy <cmd>` for those paths.

If RTK reports a failure, truncates relevant output, or points to a tee log, inspect the raw artifact before making a claim.
