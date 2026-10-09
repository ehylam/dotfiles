#!/usr/bin/env bash
# Read-only local checks. No logins, MCP discovery, installs or browser sessions.
set -euo pipefail

DOTFILES="${DOTFILES:-$HOME/.dotfiles}"
missing=0
check() {
  local label="$1"
  shift
  if "$@"; then
    printf '[OK] %s\n' "$label"
  else
    printf '[MISSING] %s\n' "$label" >&2
    missing=$((missing + 1))
  fi
}
linked() { [ -L "$2" ] && [ "$1" -ef "$2" ]; }
available() { command -v "$1" >/dev/null 2>&1; }
opencode_version() {
  local version
  version=$(opencode --version) || return 1
  printf '[INFO] OpenCode %s; managed experiments are audited for 1.18.34\n' "$version"
}

# Match the versioned Python installed by Brewfile without starting a shell.
for python_bin in /opt/homebrew/opt/python@3.12/libexec/bin /usr/local/opt/python@3.12/libexec/bin; do
  if [ -x "$python_bin/python3" ]; then
    export PATH="$python_bin:$PATH"
    break
  fi
done
check 'pnpm version probe' pnpm --version

for tool in brew fish starship zoxide fnm git gh nvim fzf rg jq uv python3 node npm npx pnpm rustup herdr claude codex opencode rtk; do
  check "$tool on PATH" available "$tool"
done
if command -v brew >/dev/null 2>&1; then
  check 'Brewfile packages installed' env HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_ANALYTICS=1 \
    brew bundle check --verbose --file "$DOTFILES/Brewfile"
fi

for item in ghostty kitty nvim cnvim nvim-lite helix; do
  check "$item config link" linked "$DOTFILES/.config/$item" "$HOME/.config/$item"
done
check 'Starship config link' linked "$DOTFILES/.config/starship.toml" "$HOME/.config/starship.toml"
for item in config.fish config-osx.fish config-linux.fish config-windows.fish fish_plugins completions conf.d functions; do
  check "Fish $item link" linked "$DOTFILES/.config/fish/$item" "$HOME/.config/fish/$item"
done
for item in .gitconfig .gitignore; do
  check "$item link" linked "$DOTFILES/$item" "$HOME/$item"
done
check 'Machine-local Git identity exists' test -f "$HOME/.gitconfig-local"
for source in .claude/scripts/apple-qa.sh .agents/skills/inspect/SKILL.md; do
  check "$source source exists" test -f "$DOTFILES/$source"
done

if command -v python3 >/dev/null 2>&1; then
  check 'Python supports TOML (3.11+)' python3 -c 'import tomllib'
  check 'Durable assistant config and shared skill links' env DOTFILES="$DOTFILES" \
    bash "$DOTFILES/.agents/skills/sync-llm/scripts/sync-llm.sh" --check --local-config
  check 'Herdr workflow menu' python3 "$DOTFILES/.config/herdr/whichkey.py" --check
fi

if command -v node >/dev/null 2>&1; then
  check 'Node WebSocket support and shared inspect diff packages' node -e '
    if (Number(process.versions.node.split(".")[0]) < 20) {
      console.error("inspect requires Node 20+"); process.exit(1);
    }
    if (typeof WebSocket !== "function") {
      console.error("inspect URL measurements require Node 22+ with global WebSocket support"); process.exit(1);
    }
    const path = require("node:path");
    const deps = path.join(process.env.XDG_DATA_HOME || path.join(require("node:os").homedir(), ".local", "share"), "inspect");
    const resolve = require("node:module").createRequire(path.join(deps, "probe.cjs"));
    resolve.resolve("pixelmatch"); resolve.resolve("pngjs");
  '
fi

chrome_available() {
  local browser
  for browser in "${CHROME_PATH:-}" \
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
    '/Applications/Chromium.app/Contents/MacOS/Chromium' \
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'; do
    [ -n "$browser" ] && [ -x "$browser" ] && return 0
  done
  return 1
}
check 'Chrome/Chromium available for inspect' chrome_available

if command -v opencode >/dev/null 2>&1; then
  check 'OpenCode version probe' opencode_version
fi

printf '\nManual/account checks (not proven by this audit):\n'
printf '  Claude/Codex/GitHub and OpenCode provider login; MCP credentials; Codex hook trust\n'
printf '  Herdr/assistant plugins: rerun installer after login; remote plugins are outside --local-config\n'
printf '  Native Apple QA: full Xcode + compatible iOS runtime + Technology Preview; run apple-qa.sh preflight\n'
printf '  Project tests/preview access and native interaction assertions; smoke checks do not prove acceptance\n'
if [ "$missing" -ne 0 ]; then
  printf '\n%d local installation check(s) failed.\n' "$missing" >&2
  exit 1
fi
printf '\nLocal installation checks passed; account and native interaction checks remain separate.\n'
