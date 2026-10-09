# Figma QA for Codex

Codex uses `~/.codex/scripts/figma-qa.mjs`, which delegates to the canonical
dotfiles implementation at `~/.claude/scripts/figma-qa.mjs`.

Read `~/.claude/scripts/FIGMA-QA.md` for the full mapping schema, flags,
workflow, and report interpretation guidance.

Direct audit rerun:

```bash
~/.codex/scripts/figma-qa.mjs --input figma-qa.json \
  --report figma-qa-report.md \
  --json-report figma-qa-report.json
```

Codex can run audits from an existing mapping file. Assisted extraction from
Figma requires an available Figma MCP server; if it is not exposed in the
current Codex session, ask the user for a completed mapping file or use
Claude Code's `/figma-qa` flow to build it.
