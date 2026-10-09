# `inspect.mjs` for Codex

Codex uses `~/.codex/scripts/inspect.mjs`, which delegates to the canonical
dotfiles implementation at `~/.claude/scripts/inspect.mjs`.

Read `~/.claude/scripts/INSPECT.md` for the full command reference, flags,
output formats, viewports, and examples.

Backwards-compatible alias:

```bash
~/.codex/scripts/measure-distance.mjs ...args
```

This is equivalent to:

```bash
~/.codex/scripts/inspect.mjs distance ...args
```
