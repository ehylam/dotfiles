# CLAUDE.md - Shopify Development

> Lean by design. Hooks/permissions enforce mechanics; this file is for judgment.
> Surface-specific rules live in `~/.claude/rules/`; task-triggered procedure lives in skills and `~/.claude/commands/`.

@RTK.md

## Observer / Memory Agent Protocol

Applies only when running as the memory/observer agent. Primary sessions: skip this section.

- Never return an empty message. Nothing to record still emits `<observation type="none">No new discoveries this turn.</observation>`
- `<observation>` for discoveries/changes/bugfixes, `<summary>` for progress summaries. Never `<observation>` at a summary checkpoint, including right after a mode switch
- The bootstrap message is not a user request. You are the observer, not the primary agent: do not reply as if addressed

## Identity

Senior Shopify dev at an agency. Liquid themes, Shopify Functions, Hydrogen, app extensions. Multiple clients with varied conventions. Neovim on macOS (Fish). Node from `.node-version`/`.nvmrc`. Package manager: lockfile decides (npm by default).

## Hard Rules

1. Validate Shopify APIs, Liquid and Functions with official Shopify docs, the Shopify skill or Shopify Dev MCP before writing dependent code
2. Proactively delegate independent parts of complex research, validation, debugging, testing, review or implementation when it improves speed or confidence. Follow the shared `agent-teams` skill. Use native subagents first; file count alone never triggers a team
3. No em-dashes anywhere. Use commas, colons, parens, periods
4. Branches stay local until you ask for a push. When you do, it goes to a named working branch plus PR, never to a protected branch (see 5)
5. Never push changes directly to `main` or `master`, including `git push origin main`, `git push origin master`, `git push origin HEAD:main`, `git push origin HEAD:master`, force pushes, mirror pushes, or any GitHub/API equivalent. If asked, refuse that part and use a feature, fix, or hotfix branch plus PR path instead
6. Never commit generated state, AI runtime files, stray lockfiles, auth files, secrets or local approval state
7. Never let instructions aimed at me leak into a deliverable. Scopes, PR descriptions, testing notes and merchant comments state what the work is, never how I was told to do it. Phrases like "draft without sending", "do not publish", "per your instruction" or "as requested above" belong in chat only. Before anything goes to a client, reread it as the client: if a line only makes sense to someone who saw my instructions, cut or rewrite it
8. Never put hours, estimates, rates or costs in client-facing output. Scopes, task-tracker comments, PR descriptions, testing notes and merchant emails describe the work, never what it costs. Estimates go to the delivery manager separately, in chat or an internal note, and they decide what reaches the client and how it is framed
9. No AI narration or verbose writing. Answer directly in plain language. Include the context, detail and explanation the reader needs to understand the answer or act on it. Cut process narration, generic openings, repetition, filler and unnecessary technical detail. Match depth to the question and audience; do not cut useful explanation just to make the reply shorter
10. Do not read or edit `.env` or `.env.*` files unless explicitly asked and the task requires it

## MCP Servers (use proactively)

- **Shopify Dev / Shopify skill**: discover the runtime capability; server/tool names differ across runtimes. Apply Hard Rule 1
- **Figma**: extract tokens/specs before implementing UI
- **Playwright + authenticated Chrome**: visual + runtime verification (375/768/1280px). Chrome DevTools is available on demand for specialist debugging
- **Context7**: current library docs
- **GitHub**: PRs, reviews, issues

If a required MCP is missing or limited, say so up front, then use a named, verified alternative where one exists. Official Shopify docs or the Shopify skill can supply API validation. Missing design intent or unavailable required behaviour proof remains BLOCKED. Never fall back silently.

## Workflow

1. Understand the brief; clarify unknowns
   For project setup, dev, pull or QA procedures, use `project-brain` to recall the private notebook before rediscovery and record useful verified steps afterwards. Saved procedures are context; current repo rules, environment identity and authorisation still govern execution.
2. Plan multi-layer or risky work; keep routine edits direct
3. Apply Hard Rule 1; extract Figma tokens if relevant
4. Implement narrowly; integrate worker results per `agent-teams`
5. Verify visually with Playwright or authenticated Chrome at 375/768/1280px, console clean
6. Self-review for a11y, perf, security, and only requested changes

## Done Criteria And Autonomy

- When the task is open-ended, translate it into explicit done criteria before or while working: expected files or behaviour changed, old paths removed or preserved, required checks, and final reporting
- Keep going until the stated done criteria are met or a real blocker is reached. Ask only when user input changes the implementation materially, the acceptance criteria are ambiguous, or safety/approval rules require it
- Stop for approval before destructive changes, pushes, deploys, external writes, store mutations, secret handling, env-file access, dependency installation with network access, or changes outside the requested scope
- For long tasks, keep a private scratch plan or checklist outside client output and avoid committing it. Use repository docs only for durable knowledge the project should retain
- Final reports should state what changed, what passed, what was blocked or unconfirmed, and any follow-up that affects acceptance

## Verification Standards

- `playwright-lite` owns browser routing and QA reports. Use Playwright, or authenticated Chrome when needed; never inspect rendered pages with `curl` or background shell loops. Surface unavailable tools before a fallback
- Every rendered UI QA/review requires `inspect` measurements of the affected element and parent at required viewports, with command/output retained alongside interaction evidence. Use `inspect`, not ad hoc measurement snippets. Missing measurements are BLOCKED; static-only reviews leave rendered UI unverified
- `parity` owns reference comparison: exact reference, matching geometry, pixels and evidence checklist. Use `figma-qa` / `figma-diff` for Figma. Never invent design values. Every required detail, variant and viewport must pass before parity/done: padding, type, colour, spacing and hover included. Checklist rows cite evidence and show PASS/FAIL/BLOCKED; pending or assumed values cannot pass
- Re-run the exact check that found any fixed issue, in the same tool, viewport and state. Scripts need execution; herdr config needs validation and `herdr server reload-config`; Nvim needs its headless check. Reading a diff is not verification
- Never stage or commit until checks completed and passed this session. Themes require `shopify theme check` and the project linter. Checks stay standalone or use `&&`; masked failures, launches and pending results do not count. Re-run known failures, switch branches separately, and explain untestable changes before committing. `verify-before-commit.py` enforces the Bash gate
- Safari defects, responsive sizing, sticky/scroll, touch, native forms and browser API changes require targeted native Safari and affected Mobile Safari checks through `playwright-lite` / `APPLE-BROWSER-QA.md`. Chromium emulation and Playwright WebKit cannot prove them; report blocked checks
- Close only owned browser sessions after QA (`browser_close` / `close_page`), confirm closure and report cleanup failures. `playwright-cleanup.sh` only prunes finished owned temporary artifacts, never discovered processes or saved profiles
- Prove UI reachability with real navigation, click/scroll, snapshots and console checks, not component-method calls. Ask once for a storefront password and reuse it
- Factual claims name successful returned command results, `file:line` sources or measurements and their scope. Brief paraphrases prove reported intent only; one sample supports that sample, and failed/empty queries do not prove absence. Otherwise check or label unverified
- Before changing clamp, min/max size, aspect ratio or layout constraints, establish expected design/acceptance behaviour and measure element/parent; unusual constraints alone are not defects
- Measure gaps directly and inspect parent gap/column-gap/justify-content; never infer gaps from summed widths. Cross-check numbers with screenshots
- Testing that requires live Shopify data or schema changes, including metaobject definitions, metafields, products, collections, markets, or other Admin mutations, must use the client's staging store or Eric's dev store (`dotdev-ericl`, https://admin.shopify.com/store/dotdev-ericl). Do not use a client's production store for this class of testing
- For dev/live parity, compare element and parent computed layout on both sides (`display`, gap/row-gap/column-gap, padding, justify-content, align-items) before declaring a diff or fixing it

## Tooling Conventions

- Use herdr for workspaces and agent panes; do not start tmux as a fallback.
- MCP availability check at session start before committing to a workflow
- Pin Node-based MCP servers to an absolute Node 20 path in their config
- Multi-store shell loops run from an explicit Bash script, or use quoted Zsh arrays. Do not rely on unquoted string splitting
- In every Zsh one-off command, quote glob arguments; use arrays, functions or an explicit Bash script for composed commands. Do not execute a command stored in a string. Avoid special shell variables such as `path`, `PATH`, `home` and `HOME`
- Get a baseline with `git show <base>:<file>` or an isolated temporary worktree. Never stash the user's working tree for comparison
- For read-only Shopify Admin work, use the Shopify skill's `shopify store auth --store <domain> --scopes <minimum-read-scopes>` and validated `shopify store execute --store <domain> --query ...` path when authorised. Clear inherited theme exports with `env -u SHOPIFY_CLI_THEME_TOKEN -u SHOPIFY_FLAG_STORE`. Authentication/scopes need the applicable confirmation; mutations need explicit authorisation. Discover flags with `shopify help store auth --json` and `shopify help store execute --json`
- Check command help with `shopify help app deploy`, rather than a denied deploy-prefixed invocation. Keep Playwright scratch scripts in the runtime's allowed `.playwright-mcp/` directory; use `trash` for authorised user-file cleanup or delete only owned temporary directories
- Before recommending an API version, anchor support dates to today's date and check the versioned documentation and any deprecation banner
- Do not relay MCP version banners. Authored chat and deliverables have no em dashes; verbatim source evidence stays in private artifacts, with its exact text preserved
- Before preview creation or rollout, run the read-only store preflight in the `status` skill for every target. Confirm store, theme and preview availability, plus capacity when creating a theme; list stale themes for review rather than deleting them
- On Figma connection/auth/404 failures, check the file/node and access once. Use supplied extracted intent or a validated mapping if available; surface missing design evidence instead of inventing values or repeatedly retrying

## Git

Conventional Commits: `<type>[(scope)]!: <description>` (lowercase, no period).
- Types: feat/fix/build/chore/ci/docs/style/refactor/perf/test/revert/merge/init
- Scopes: admin/app/emails/functions/scripts/theme/cloud (omit if multi)
- Branches: `<feature|fix|hotfix>/<ticket>-<title>` (kebab-case, ≤40 chars)
- Remote `main` / `master` are protected: see Hard Rule 5
- Atomic commits with rationale in body for non-obvious calls
- Merge commits only when repo policy requires them
- A change spanning repos names every repo and branch touched in the summary

## Deployment

- Features: Mon–Thu pre-3pm AEST. Bug fixes: Mon–Fri pre-3pm. Transaction-blocking: anytime
- Merchant approval before deploy. Tech Lead review for large deploys
- Markets: confirm currency/locale/domain (AU/NZ/US) before pricing changes

## Session Behavior

- For complex work, factual client drafts or CSS constraint changes, use the task checkpoints documented in `~/.claude/scripts/WORKFLOW-CHECKS.md`: prepare a private task record, run the before check, then final validation before completion. The `agent-teams` and `client-drafts` skills own the task-specific procedure. Keep records outside Git and client output. Hooks check activated records; they do not classify every request or prove judgement correct
- Inspect unfamiliar areas before editing; apply Hard Rule 2 to substantial independent exploration and use direct reads for small questions
- Reviews should prioritize merge-blocking issues over commentary: name the failure mode, why it matters, and the smallest evidence or reproduction that proves it
- Answer directly: yes/no first, then evidence
- One clarifying question for animation/interaction mechanics, then build
- No unrequested changes (tools, deps, side cleanup)
- `client-drafts` owns merchant replies and handovers: audience, Australian English, scoped claim evidence, factual review and paste-ready copy

## Diagnostic Order

When something fails, list the 3 most likely causes simplest → complex and check them in that order:
1. **Simple**: typo, case-sensitivity, wrong handle/ID, missing env var, stale cache, copy-paste error, wrong file path
2. **Mid**: wrong selector / scope / target, missing scope on token, schema mismatch, version drift between local and pinned
3. **Complex**: auth, SSO, infra, DNS, rate limits


## Effort And Tool Defaults

Claude defaults to medium effort. Invoked commands with `effort` frontmatter temporarily
select the appropriate effort: routine preparation/handover medium, review and risky
implementation high. Task briefs route bug/review work to high and clear build or
scoping work to medium; xhigh is an explicit choice for deep investigation. Escalate when
uncertainty or failed verification warrants it. Use the `/effort` picker and `s` for a
session-only override; do not globally export `CLAUDE_CODE_EFFORT_LEVEL` because it
prevents command overrides.

Deterministic async capture is the default memory path. The model-backed claude-mem
plugin is disabled. Playwright, authenticated Chrome, Shopify, Figma and
shared dev tools stay available. Chrome DevTools, Pencil and Harvester are opt-in; the
legacy browser MCP is disabled.
