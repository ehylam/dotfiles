# .dotfiles

macOS development environment configuration: Fish/Zsh, Starship, three Neovim
configs, Helix, Ghostty/Kitty, Herdr, RTK, and Claude Code / Codex / OpenCode
config with shared skills and hooks.

## Quick Start

```sh
xcode-select --install
git clone <this repo> ~/.dotfiles
~/.dotfiles/install.sh
```

The installer sets up Homebrew packages/fonts, shell/editor config, Claude,
Codex, pinned OpenCode, shared skills, Herdr integrations/plugins and inspect
comparison dependencies. It finishes with local checks and a manual/account
checklist. Each stage stops on its own errors while independent stages continue.
It is safe to re-run.

Check an existing installation without installing packages, logging in,
contacting MCP servers or launching browsers:

```sh
~/.dotfiles/install.sh --check
```

Defer remote Herdr/assistant plugin setup until you have logged in:

```sh
DOTFILES_REMOTE_SYNC=0 ~/.dotfiles/install.sh
```

## Credentials

No API keys or tokens live in this repo. MCP wrappers read credentials from
local, untracked files:

- `~/.codex/github-mcp.env` (see `.codex/github-mcp.env.example`)
- `~/.codex/context7.env` (see `.codex/context7.env.example`)

Set your Git email in `~/.gitconfig-local` (included by `.gitconfig`, not tracked):

```ini
[user]
	email = you@example.com
```

## Native Apple QA

Install full Xcode and a compatible iOS runtime, plus Safari Technology Preview
(`brew install --cask safari-technology-preview`), then run
`bash ~/.claude/scripts/apple-qa.sh preflight`. See
[Native Apple QA](.claude/scripts/APPLE-BROWSER-QA.md).
