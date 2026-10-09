---
name: playwright-lite
description: Run token-conscious Playwright or browser QA without weakening validation. Use when Codex needs to reproduce, inspect, or validate browser-visible behaviour with Playwright, Browser, Chrome, or Playwright CLI while keeping context small, especially for Shopify storefront QA, task fixes, preview-vs-live checks, console/network inspection, screenshots, traces, and automated Playwright test runs.
---

# Playwright Lite

Use this skill to reduce browser-QA token usage by scoping evidence, saving bulky artifacts to files, and summarising only the facts needed for the fix loop.

This skill does not lower the QA bar. For Shopify storefront reviews, task fixes, theme previews, checkout-adjacent flows, multi-market behaviour, responsive issues, or client acceptance criteria, run the same validation you would normally run. Optimise output volume, not coverage.

## Tool Preference

1. Configured Playwright MCP for interactive browser QA.
2. The Chrome connector/plugin when the task needs the user's authenticated session.
3. `~/.codex/scripts/inspect.mjs` through `$inspect` for precise rendered measurements.
4. Project-owned Playwright tests for repeatable journeys.
5. Chrome DevTools MCP on demand for specialist debugging.

If a required browser tool is missing or down, state that before using a fallback.
`agent-browser` is an optional fast exploration path when installed. The local transport
benchmark (`~/.claude/scripts/benchmark-browsers-results.json`) found lower latency,
but compact snapshots omitted revealed text; a noncompact scoped fallback recovered it.
Count that fallback and use DOM/screenshot evidence for content checks. Scoped Playwright
returned less text on that fixture and remains the acceptance-QA default. Agent-browser
0.38.1 requires Node 24; the benchmark's temporary install does not put it on the PATH.
Do not assume `playwright-cli` is installed or invent its flags.
The 2 October 2026 trial of Playwright CLI 0.1.22 passed the fixture journeys and
trace probe, but was slower and returned more evidence text than scoped MCP.
The pinned trial installs only in an OS temporary directory. Keep the configured
MCP default; use installed CLI help and explicit owned sessions for optional CLI work.

Parallel workers use separate owned browser sessions. Keep Playwright's
configured `--isolated` mode; give agent-browser an explicit session per worker
and run instead of its default session. Target and reference need separate
contexts when preview cookies or market/cart state could cross over. Shared
Chrome tabs or CDP attachment do not isolate cookies. Coordinate access to an
authenticated user tab and run native Apple checks serially.

## Default Evidence Loop

Navigate to the exact URL and viewport, then inspect the affected region. Request only
relevant console errors, failed requests, selectors and element state. Save bulky
snapshots, screenshots and traces to files; return the observations and artifact paths.
Expand coverage when the task or failure requires it. Close automation browsers when done.

For rendered changes, complete the required browser journeys and target/parent
measurements on the current source before committing or opening a PR. A build,
theme check, static review or successful navigation alone does not satisfy this
requirement. If rendered QA is blocked, report the gap and keep the change
uncommitted unless the user explicitly authorises an unverified checkpoint.
The transcript commit hook checks tool completion, not semantic QA coverage;
the task's acceptance evidence remains the source of truth.

Every QA or review of rendered UI changes must include scoped `$inspect` measurements
of the affected element and parent layout at the required viewports, even without a
design reference. Retain the command and output in the run's evidence directory and
compare against task acceptance criteria or the approved baseline; do not invent design
values. Use browser checks for interaction, focus and state. If inspect cannot reproduce
the required session/state, report the missing measurements as BLOCKED and retain the
browser evidence without claiming complete UI validation. Explicitly static-only reviews
must report rendered UI as unverified.

For Safari defects or changes to responsive sizing, sticky/scroll behaviour,
touch interaction, native form controls or browser APIs, include a targeted Safari
check and Mobile Safari check when mobile is affected. Use the on-demand native
path in `~/.claude/scripts/APPLE-BROWSER-QA.md`; it creates its own simulator and
cleans up only owned resources. Mobile Chromium emulation and Playwright WebKit
do not establish native Safari or iOS results. If Apple automation is blocked,
report the exact missing check and setup requirement rather than claiming parity.
Use `bash ~/.claude/scripts/apple-qa.sh preflight`, then `desktop` for Technology
Preview MCP or `ios` for Mobile Safari XCTest. The wrapper selects an available
iOS runtime unless explicitly supplied; run native checks serially. Production
desktop Safari WebDriver remains blocked and Technology Preview must be labelled
separately. The helper provides fixture journeys and real-URL smoke checks.
Desktop acceptance beyond smoke needs a reviewed MCP `--journey` module. For fade,
autoplay or visual assertions use `--visible` and the journey's `requireVisible`
at the relevant states; hidden MCP pages leave foreground behaviour BLOCKED.
Mobile Safari accepts reviewed `--ios-journey` JSON steps for native taps, waits,
scroll-to-label, scoped overlay dismissal, assertions and per-step screenshots,
or project-specific XCTest suites. Desktop journeys expose open-shadow queries
and scoped overlay dismissal. Use the Apple QA document's action schema and
timeout diagnostics; skipped optional steps are not interaction proof.
Without a manifest, URL mode only checks text existence, including offscreen
text, and rejects Node journeys/CSS selectors. Native screenshots need crop/layout
review; they do not expose computed CSS or prove exact image positioning.
Never execute an unreviewed worker reply as a journey. See the Apple QA document
for each transport's API and ownership/cleanup. Do not count fixtures or smoke
checks as client interaction validation.

Theme-editor live changes need their own authorised editor session and dedicated
test media. Do not alter an existing merchant image's focal point merely to unblock
QA; duplicating a theme does not establish media isolation. Record editor update,
reload, desktop/mobile image choice and fit-viewport states separately when required.
Use supplied acceptance criteria for the intended crop/height rather than inventing
values. Report passed rows alongside missing native/editor checks, not one blanket
browser PASS when required rows remain BLOCKED.

Dedicated test media is an internal QA requirement. Merchant handover steps use the
merchant's own content and the actual feature controls. Before changing approved dev
theme content, record its original state and owned test changes. Before handover,
restore only those owned changes when the current state still matches what this run
set and authorised store access permits the restoration. If someone changed it since,
or restoration access is blocked, leave it and report the remaining cleanup separately.
Do not overwrite merchant edits or change shared media to obtain a passing check.

Browser Use is optional RAM offloading, not the default QA path. The measured
synthetic run reduced local owned-process RSS but was much slower and did not
forward console events in that setup. Check required capabilities before relying
on it, and stop the owned cloud session through the provider API afterwards.

## Shopify Storefront Guardrails

For Shopify, Liquid theme, Hydrogen storefront, app extension, or tracked task QA:

- Preserve required coverage: use the task's reproduction steps, client comments, acceptance criteria, affected markets/locales, and relevant live/preview URLs.
- Use 375, 768, and 1280 px viewports for responsive storefront issues unless the task specifies otherwise.
- For visual changes with a Figma, Pencil, screenshot, mockup or website reference,
  follow `$parity`: use `$inspect` for target/parent measurements and the appropriate
  reference extraction and pixel comparison. Keep interaction QA in the browser;
  a screenshot or unasserted measurement alone is not proof of a design match.
- Reuse `$viewport-schema-qa` for repeated viewport, parent-layout, gap and rendered
  JSON-LD checks. Preserve the task's affected markets and do not extrapolate between them.
- Before a CSS fix, inspect the matched source rule and parent layout. Check intentional
  `clamp()`, line clamping, breakpoints and content against the expected behaviour;
  reproduce the defect and keep a before/after measurement rather than removing constraints
  because they look suspicious.
- Before changing or removing a CSS constraint, prepare a task checkpoint using
  `~/.claude/scripts/workflow-check.py` and its adjacent `WORKFLOW-CHECKS.md`.
  Record the file, target/property, expected behaviour, design or acceptance source,
  and measurements of the element and parent. After the fix, bind the repeated
  measurements to the current file and run final validation. Browser evidence can
  come from the appropriate engine; a Chrome measurement does not establish Safari parity.
- For password-gated storefronts, ask once and reuse the value during the run.
- For cart, checkout, customer account, pricing, inventory, market, locale, analytics, search, or merchandising issues, do not rely on a shallow snapshot alone. Capture targeted console and network evidence and validate the full user flow.
- For visual regressions, save screenshots or diffs as artifacts and summarise the mismatch, dimensions, viewport, selector, and path.
- If the issue cannot be reproduced, do not guess. Report the exact URL, viewport, steps attempted, current result, and missing blocker.

## Automated Test Runs

Use concise output first:

```bash
npx playwright test --reporter=line --max-failures=1
npx playwright test --last-failed --reporter=line
npx playwright test --project=chromium --grep "<relevant test or flow>"
```

Prefer Playwright config that keeps artifacts without flooding stdout:

```ts
use: {
  trace: "on-first-retry",
  screenshot: "only-on-failure",
  video: "retain-on-failure",
},
reporter: "line",
```

Use `rtk playwright test` or `rtk test npx playwright test` only for broad noisy runs. If a test fails, inspect the Playwright artifact, trace, screenshot, or focused rerun before making claims.

## Escalation Rules

Escalate beyond lite mode when the evidence is insufficient:

- Full screenshot when visual inspection is the issue.
- Trace when a flow fails, flakes, navigates unexpectedly, or depends on timing.
- Raw console or network logs when the filtered view hides the failing request, payload, status, or stack.
- Full viewport or full-page capture when sticky bars, lazy loading, modals, or scroll state are the suspected cause.
- Multi-browser or multi-market validation when the task, client, or repo convention requires it.

Never let token saving suppress a client requirement, a failing assertion, a checkout-adjacent concern, or a security/privacy signal.

## QA Evidence Report

Use the task brief's QA plan, or derive the affected targets, acceptance criteria
and required browsers from the standalone task. Mark missing inputs pending.
Create a fresh run directory under its QA evidence path, or an OS temporary
directory outside Git. Keep credentials and authentication state out of reports.
Save bulky evidence there and write `qa-report.md` in this format:

```markdown
# QA: <task or comparison>
Run: <timestamp and absolute evidence directory>
Source: <repo/worktree, branch, tested HEAD and dirty state; affected file SHA-256 hashes>
Target: <exact URL per market, preview/theme ID, locale and relevant session state>
Reference: <exact URL/node, Pencil file/node, image path/hash or acceptance source; version, viewport/state, image scale/crop when relevant; or not applicable>
Browsers: <actual engine/version/profile; native, emulated or cloud>

| Criterion / steps | Market / URL | Viewport / browser | Expected | Before -> after | Result | Evidence |
|---|---|---|---|---|---|---|
| <reproduction or regression check> | <affected target> | <actual geometry and engine> | <expected result> | <observed behaviour or numeric values> | PASS / FAIL / BLOCKED | <artifact paths or command result> |

Diagnostics: <relevant console/network findings, or unavailable with reason>
Verdict: <PASS / FAIL / BLOCKED / STALE; remaining checks and blockers>
```

For remote-only checks, record the known theme/build identity and say when the
source revision cannot be established. An uncommitted fix needs affected tracked
and untracked file hashes as well as HEAD; a commit alone cannot identify it.
Capture source identity before and after the run. If it changes during checks,
repeat the affected checks before passing. After a fix, record the new identity
alongside after evidence. Later source, build, content or preview changes make
the affected results STALE until rechecked.

Every required criterion needs evidence for each affected market, viewport and
browser. FAIL means an observed mismatch; BLOCKED means required proof could not
be obtained. Overall PASS requires all required rows to pass on the current
tested state. Report both failures and blockers when both exist. A synthetic
fixture, successful click response or screenshot alone does not prove the actual
acceptance journey. Native iOS navigation is not evidence of successful touch.

For recurring regressions, reuse the project's Playwright suite and add a focused
journey when appropriate, including affected keyboard/focus behaviour. Save
failed-run traces and screenshots and link Dev MCP review findings to this
report when those reviews are part of the task.

Summarise the result, before/after behaviour, evidence paths and any missing
checks in final or handover notes; do not dump browser trees. Close owned browser
and cloud sessions, and detach from user-owned browsers without quitting them.
