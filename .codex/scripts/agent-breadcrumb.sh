#!/usr/bin/env bash
# Share pane ownership logic with Claude, keeping Codex's breadcrumb store separate.
AGENT_BREADCRUMB_DIR="$HOME/.codex/state/agent-breadcrumbs" \
  exec bash "$HOME/.dotfiles/.claude/scripts/agent-breadcrumb.sh" "$@"
