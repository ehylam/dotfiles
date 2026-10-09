---
name: sync-llm
description: Synchronize Claude Code, Codex, opencode, and herdr local setup from the dotfiles source of truth. Use when the user asks to sync, repair, compare, or install LLM assistant configuration across Claude Code, Codex, and opencode, including global instructions, config symlinks, hooks, helper scripts, shared skills, and herdr plugins.
---

# Sync LLM

## Overview

Use this skill to keep Claude Code, Codex, and opencode aligned around the same dotfiles-managed LLM setup without copying runtime state, auth, logs, sessions, caches, or secrets.

## Quick Start

Run the deterministic sync script from the skill directory:

```bash
bash ~/.agents/skills/sync-llm/scripts/sync-llm.sh --apply
```

For a non-mutating audit:

```bash
bash ~/.agents/skills/sync-llm/scripts/sync-llm.sh --check
```

For all durable local config and skill links without integrations, remote
plugins or credential-backed MCP discovery, add `--local-config` to `--apply`
or `--check`. The smaller `--bootstrap-config` scope still covers only
Claude/OpenCode config. `install.sh --check` uses the local scope and reports
account, plugin and native-browser prerequisites separately.

`install.sh` also delegates durable config rendering and links to this local
scope. Sync is the single owner of Claude/Codex/OpenCode config, shared skills,
Herdr settings, RTK, Ponytail and shell startup links; the installer supplies
packages and account setup around it.


## What Gets Synced

- Claude Code durable config: `~/.claude/CLAUDE.md`, `settings.json`, `commands`, `hooks`, and `scripts` from `~/.dotfiles/.claude`.
- Codex durable config: generated `~/.codex/config.toml` from `~/.dotfiles/.codex/config.user.toml` plus the project-safe `~/.dotfiles/.codex/config.toml`, with `AGENTS.md`, `hooks.user.json` (linked as live `hooks.json`), `scripts`, and the three effort `*.config.toml` profiles linked from `~/.dotfiles/.codex`.
- Inspect CLI: Claude owns the canonical `inspect.mjs` browser-measurement CLI and Codex gets wrappers in `~/.codex/scripts`, plus the shared `inspect` skill for both assistants.
- Figma QA toolkit: Claude owns the canonical `figma-qa.mjs` orchestrator and Figma slash commands; Codex gets a wrapper in `~/.codex/scripts`, plus shared `figma-qa` and `figma-diff` skills.
- opencode durable config: `~/.config/opencode/opencode.json` and local plugins linked from `~/.dotfiles/.config/opencode`. Global instructions and skills need no config, since opencode reads `~/.claude/CLAUDE.md` and `~/.agents/skills` natively; path-scoped rules are wired through the `instructions` glob. Credentials in `~/.local/share/opencode/auth.json` are never synced.
- herdr: `config.toml` linked from `~/.dotfiles/.config/herdr`, plus plugins installed from the `plugins.txt` manifest of `owner/repo` sources. Plugin trees are fetched from GitHub rather than vendored; set `SYNC_HERDR_PLUGINS=0` to skip.
- Native herdr integrations for Claude, Codex and OpenCode are installed with herdr's own installer after durable config is linked. Generated integration scripts remain outside dotfiles; the hook entries remain in the managed settings.
- Shell startup guards: minimal dotfiles-managed zsh startup files are linked so Codex login shells stay quiet even when fish is the interactive shell.
- Shared user skills: dotfiles-managed skills in `~/.dotfiles/.agents/skills` are linked into `~/.agents/skills`.
- Claude skill visibility: every skill in `~/.agents/skills` is linked into `~/.claude/skills` so Claude Code and Codex see the same user skill set.
- Claude project MCP wrappers: `~/Documents/dev/.mcp.json` entries for Context7 and GitHub MCP are checked or repaired to use the dotfiles wrappers without storing tokens in project config.
- Playwright registrations: Claude's user entry and existing project overrides use
  the Codex package pin and `--isolated`. Custom browser/config arguments are kept;
  attached or persistent sessions require review before changing ownership.

## What Must Not Be Synced

- Do not sync `auth.json`, session/history databases, logs, caches, model caches, app state, `.tmp`, or generated runtime files.
- Do not put API tokens in dotfiles. Keep local credentials in files such as `~/.codex/github-mcp.env`.
- Do not overwrite a real non-symlinked file without backing it up first.

## Review Workflow

1. Run `--check` first when the user asks for a review or drift report.
2. Run `--apply` when the user asks to sync, install, repair, or make the setup match dotfiles.
3. After syncing, verify key links with `ls -la ~/.codex ~/.claude ~/.agents/skills` as needed.
4. Validate Codex config with `codex debug prompt-input "noop"` if Codex config or hooks changed.
5. Validate the skill structure with the skill creator validator when the skill itself changes.

If the script reports a broken symlink or missing local secret file, fix only the durable link or local secret path. Do not copy secrets into the dotfiles repository.

## Retiring A Managed Codex MCP

Keep the server's table in `.codex/config.toml` and add `enabled = false`.
The source value wins over a live `enabled = true` during rendering, while
local model choices, trust, app-managed servers and credential files are retained.
Deleting the source table alone does not retire a server because live-only tables
are deliberately preserved. Re-enable it by setting `enabled = true` in the source.
This affects Codex only; registrations in other assistants need their own explicit
change. [Official OpenAI configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

Review with `--check --local-config` before an authorised local apply. Do not
delete live config, OAuth state or credential files to remove a managed server.

For configuration-only changes without remote plugin updates or credential-backed router refresh:

```bash
SYNC_HERDR_PLUGINS=0 SYNC_PONYTAIL_PLUGINS=0 bash ~/.agents/skills/sync-llm/scripts/sync-llm.sh --apply
```
