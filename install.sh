#!/usr/bin/env bash
set +e
set -uo pipefail
trap 'exit 130' INT
trap 'exit 143' TERM

# ==============================================================================
# .dotfiles bootstrap script
# Safe to re-run - checks before installing/overwriting
# ==============================================================================

DOTFILES="${DOTFILES:-$HOME/.dotfiles}"
CONFIG="$HOME/.config"
BACKUP_DIR="$HOME/.dotfiles-backup/$(date +%Y%m%d-%H%M%S)-$$"
SHOPIFY_DEV_MCP_VERSION="1.14.0"
PLAYWRIGHT_MCP_VERSION="0.0.76"
CHROME_DEVTOOLS_MCP_VERSION="1.2.0"
OPENCODE_VERSION="1.18.34"
FAILED_STAGES=()
SKIPPED_STAGES=()
STAGE_STATUS=0

case "${1:-}" in
  --check)
    [ "$#" -eq 1 ] || { echo 'Usage: install.sh [--check|--help]' >&2; exit 2; }
    exec bash "$DOTFILES/check-install.sh"
    ;;
  --help|-h)
    echo 'Usage: install.sh [--check|--help]'
    echo '--check: read-only local installation audit; no installs, logins or browser sessions'
    echo 'DOTFILES_BREW_UPGRADE=1: upgrade existing Brewfile packages'
    echo 'DOTFILES_REMOTE_SYNC=0: defer remote Herdr/assistant plugin setup'
    exit 0
    ;;
  '') ;;
  *) echo 'Usage: install.sh [--check|--help]' >&2; exit 2 ;;
esac

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[SKIP]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }
failed_stage() { FAILED_STAGES+=("$1"); error "$1"; }
skipped_stage() { SKIPPED_STAGES+=("$1"); warn "$1"; }

# Invoke directly, never as an if/! condition: Bash otherwise disables errexit
# inside functions. Only the stage exits on failure; the coordinator continues.
run_stage() {
  local label="$1"
  shift
  (set -e; "$@")
  STAGE_STATUS=$?
  if [ "$STAGE_STATUS" -eq 0 ]; then
    success "$label"
  else
    failed_stage "$label (exit $STAGE_STATUS)"
  fi
  return 0
}

read_secret() {
  read -r -s -p "$1" "$2"
  printf '\n' >&2
}

write_local_secret() (
  umask 077
  [ ! -L "$1" ] || { error 'Credential file must not be a symlink'; return 1; }
  printf '%s=%q\n' "$2" "$3" > "$1"
  chmod 600 "$1"
)

backup_existing() {
  local dest="$1" backup="$BACKUP_DIR/${1#"$HOME"/}"
  mkdir -p "$(dirname "$backup")"
  mv "$dest" "$backup"
  info "Backed up existing $dest to $backup"
}

# Back up a file/dir before symlinking
backup_and_link() {
  local src="$1"
  local dest="$2"

  [ -e "$src" ] || { error "Link source missing: $src"; return 1; }

  if [ -L "$dest" ]; then
    local current_target
    current_target=$(readlink "$dest")
    if [ "$current_target" = "$src" ]; then
      warn "$dest already linked"
      return
    fi
    backup_existing "$dest"
  elif [ -e "$dest" ]; then
    backup_existing "$dest"
  fi

  # Ensure parent directory exists
  mkdir -p "$(dirname "$dest")"
  ln -s "$src" "$dest"
  success "Linked $dest -> $src"
}

link_fish_config() {
  local fish_dir="$CONFIG/fish"
  local item runtime name

  if [ -L "$fish_dir" ]; then
    backup_existing "$fish_dir"
  elif [ -e "$fish_dir" ] && [ ! -d "$fish_dir" ]; then
    backup_existing "$fish_dir"
  fi

  mkdir -p "$fish_dir"

  for runtime in "$DOTFILES/.config/fish"/fish_variables*; do
    [ -e "$runtime" ] || continue
    name=$(basename "$runtime")
    if [ -e "$fish_dir/$name" ]; then
      rm "$runtime"
      warn "Removed duplicate Fish runtime file from dotfiles: $runtime"
    else
      mv "$runtime" "$fish_dir/$name"
      warn "Moved Fish runtime file to local config: $fish_dir/$name"
    fi
  done

  for item in config.fish config-osx.fish config-linux.fish config-windows.fish fish_plugins completions conf.d functions; do
    [ -e "$DOTFILES/.config/fish/$item" ] || continue
    backup_and_link "$DOTFILES/.config/fish/$item" "$fish_dir/$item"
  done
}

sync_local_llm_config() {
  DOTFILES="$DOTFILES" bash "$DOTFILES/.agents/skills/sync-llm/scripts/sync-llm.sh" --apply --local-config
}

install_opencode() {
  local installed
  if command -v opencode >/dev/null 2>&1; then
    if ! installed=$(opencode --version); then
      error 'OpenCode is on PATH but its version probe failed'
      return 1
    fi
    if [ "$installed" = "$OPENCODE_VERSION" ]; then
      success "OpenCode $installed already installed"
    else
      warn "OpenCode $installed retained; managed experiments require audited $OPENCODE_VERSION"
    fi
  else
    npm install -g "opencode-ai@$OPENCODE_VERSION" || return
    success "OpenCode $OPENCODE_VERSION installed"
  fi
}

finish_llm_setup() {
  local scope=()
  if [ "${DOTFILES_REMOTE_SYNC:-1}" = "0" ]; then
    scope=(--local-config)
    warn 'Remote plugin setup deferred; rerun the installer after authenticating'
  fi
  if ! DOTFILES="$DOTFILES" bash "$DOTFILES/.agents/skills/sync-llm/scripts/sync-llm.sh" --apply ${scope[@]+"${scope[@]}"}; then
    return 1
  fi
  DOTFILES="$DOTFILES" bash "$DOTFILES/.agents/skills/sync-llm/scripts/sync-llm.sh" --check ${scope[@]+"${scope[@]}"}
}

install_cli() {
  local tool="$1" package="$2"
  if command -v "$tool" >/dev/null 2>&1; then
    warn "$tool already installed"
  else
    npm install -g "$package"
  fi
}

install_zsh_plugin() {
  local name="$1"
  if [ -d "$ZSH_CUSTOM/plugins/$name" ]; then
    warn "$name already installed"
  else
    git clone "https://github.com/zsh-users/$name" "$ZSH_CUSTOM/plugins/$name"
  fi
}

setup_codex_credential() {
  local file="$1" key="$2" prompt="$3" value
  [ -f "$DOTFILES/.codex/$file.example" ] || return 0
  if [ -f "$CODEX_DIR/$file" ]; then
    warn "$CODEX_DIR/$file already exists"
    return 0
  fi
  mkdir -p "$CODEX_DIR"
  read_secret "$prompt" value
  if [ -n "$value" ]; then
    write_local_secret "$CODEX_DIR/$file" "$key" "$value"
  else
    warn "Skipping $file credentials; set up $CODEX_DIR/$file later"
  fi
}

# ==============================================================================
echo ""
echo "============================================"
echo "  .dotfiles installer"
echo "============================================"
echo ""

# ------------------------------------------------------------------------------
# 1. Xcode Command Line Tools
# ------------------------------------------------------------------------------
info "Checking Xcode Command Line Tools..."
setup_xcode() {
  if xcode-select -p &>/dev/null; then
    warn "Xcode CLI tools already installed"
  else
    xcode-select --install
    echo "Press any key after Xcode CLI tools finish installing..."
    read -n 1 -s -r
    xcode-select -p >/dev/null
  fi
}
run_stage 'Xcode Command Line Tools' setup_xcode

# ------------------------------------------------------------------------------
# 2. Homebrew
# ------------------------------------------------------------------------------
info "Checking Homebrew..."
install_homebrew() {
  local script
  if command -v brew &>/dev/null; then
    warn "Homebrew already installed"
  else
    script=$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)
    /bin/bash -c "$script"
  fi
}
run_stage 'Homebrew' install_homebrew

# Publish Homebrew's PATH in the coordinator, not the isolated install stage.
if ! command -v brew >/dev/null 2>&1; then
  for brew_bin in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [ -x "$brew_bin" ]; then
      if brew_env=$(SHELL=/bin/bash "$brew_bin" shellenv) && eval "$brew_env"; then
        break
      else
        failed_stage 'Homebrew shell environment'
      fi
    fi
  done
fi

# ------------------------------------------------------------------------------
# 3. Brewfile
# ------------------------------------------------------------------------------
info "Running Brewfile..."
if [ -f "$DOTFILES/Brewfile" ] && command -v brew >/dev/null 2>&1; then
  if [ "${DOTFILES_BREW_UPGRADE:-0}" = "1" ]; then
    run_stage 'Brewfile packages' brew bundle --file "$DOTFILES/Brewfile"
  else
    run_stage 'Brewfile packages' brew bundle --no-upgrade --file "$DOTFILES/Brewfile"
  fi
else
  failed_stage 'Brewfile packages require Homebrew and a source Brewfile'
fi

# Use the generic executables supplied by the versioned Python formula.
if command -v brew >/dev/null 2>&1 && python_prefix=$(brew --prefix python@3.12); then
  export PATH="$python_prefix/libexec/bin:$PATH"
fi

CONFIG_READY=0
run_stage 'Python TOML support (3.11+)' python3 -c 'import tomllib'
[ "$STAGE_STATUS" -eq 0 ] && CONFIG_READY=1

# ------------------------------------------------------------------------------
# 6. Symlinks
# ------------------------------------------------------------------------------
info "Creating symlinks..."

if [ "$CONFIG_READY" -eq 1 ]; then

# Fish
run_stage 'Fish config links' link_fish_config

# Terminal emulators
run_stage 'Ghostty config link' backup_and_link "$DOTFILES/.config/ghostty" "$CONFIG/ghostty"
run_stage 'Kitty config link' backup_and_link "$DOTFILES/.config/kitty" "$CONFIG/kitty"

# Starship prompt config
run_stage 'Starship config link' backup_and_link "$DOTFILES/.config/starship.toml" "$CONFIG/starship.toml"

# Neovim (all 3 variants for the nvims switcher)
run_stage 'Neovim config link' backup_and_link "$DOTFILES/.config/nvim" "$CONFIG/nvim"
run_stage 'Cnvim config link' backup_and_link "$DOTFILES/.config/cnvim" "$CONFIG/cnvim"
run_stage 'Nvim-lite config link' backup_and_link "$DOTFILES/.config/nvim-lite" "$CONFIG/nvim-lite"

# Helix
run_stage 'Helix config link' backup_and_link "$DOTFILES/.config/helix" "$CONFIG/helix"

# Git
run_stage 'Git config link' backup_and_link "$DOTFILES/.gitconfig" "$HOME/.gitconfig"
run_stage 'Git ignore link' backup_and_link "$DOTFILES/.gitignore" "$HOME/.gitignore"

# Sync owns durable assistant, Herdr, RTK, Ponytail and shell configuration.
run_stage 'Local assistant configuration' sync_local_llm_config

else
  skipped_stage 'Configuration links and local assistant sync: configuration source unavailable'
fi

# Git identity (machine-specific, not tracked)
setup_git_identity() {
if [ ! -f "$HOME/.gitconfig-local" ]; then
  info "Setting up git identity for this machine..."
  echo ""
  read -r -p "  Git name: " GIT_NAME
  read -r -p "  Git email: " GIT_EMAIL
  read -r -p "  GitHub username: " GH_USER
  cat > "$HOME/.gitconfig-local" <<EOF
[user]
	name = ${GIT_NAME}
	email = ${GIT_EMAIL}
[github]
	user = ${GH_USER}
EOF
  success "Git identity saved to ~/.gitconfig-local"
else
  warn "~/.gitconfig-local already exists"
fi
}
run_stage 'Machine-local Git identity' setup_git_identity

# ------------------------------------------------------------------------------
# 7. Herdr workspace runtime
# ------------------------------------------------------------------------------
info "Herdr is the workspace runtime; legacy tmux config is left untouched."

# ------------------------------------------------------------------------------
# 8. Fish shell setup
# ------------------------------------------------------------------------------
info "Setting up Fish shell..."

FISH=$(command -v fish || echo "/opt/homebrew/bin/fish")

if [ -x "$FISH" ]; then
  allow_fish_shell() {
    # Add fish to allowed shells if not already there
    if ! grep -q "$FISH" /etc/shells; then
      info "Adding fish to /etc/shells (requires sudo)..."
      echo "$FISH" | sudo tee -a /etc/shells >/dev/null
    fi
  }
  run_stage 'Fish login shell availability' allow_fish_shell
else
  failed_stage "Fish shell not found - install it first"
fi

# ------------------------------------------------------------------------------
# 9. ZSH setup (Oh My Zsh + plugins)
# ------------------------------------------------------------------------------
info "Setting up ZSH..."

OMZ_DIR="$HOME/.oh-my-zsh"
if [ -d "$OMZ_DIR" ]; then
  warn "Oh My Zsh already installed"
else
  info "Installing Oh My Zsh..."
  install_oh_my_zsh() {
    local script
    script=$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)
    RUNZSH=no KEEP_ZSHRC=yes sh -c "$script"
  }
  run_stage 'Oh My Zsh' install_oh_my_zsh
fi

# ZSH plugins
ZSH_CUSTOM="${ZSH_CUSTOM:-$OMZ_DIR/custom}"

if [ -d "$OMZ_DIR" ]; then
  run_stage 'Zsh autosuggestions' install_zsh_plugin zsh-autosuggestions
  run_stage 'Zsh syntax highlighting' install_zsh_plugin zsh-syntax-highlighting
else
  skipped_stage 'Zsh plugins: Oh My Zsh unavailable'
fi

# ------------------------------------------------------------------------------
# 10. Rust
# ------------------------------------------------------------------------------
info "Checking Rust..."
if command -v rustup &>/dev/null; then
  success "Rust already installed"
else
  info "Installing Rust via rustup..."
  install_rust() {
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  }
  run_stage 'Rust' install_rust
  if [ "$STAGE_STATUS" -eq 0 ] && [ -f "$HOME/.cargo/env" ]; then
    source "$HOME/.cargo/env" || failed_stage 'Rust shell environment'
  fi
fi

# ------------------------------------------------------------------------------
# 11. pnpm
# ------------------------------------------------------------------------------
info "Checking pnpm..."
run_stage 'pnpm' install_cli pnpm pnpm

# ------------------------------------------------------------------------------
# 12. AI Tools
# ------------------------------------------------------------------------------
echo ""
info "Setting up AI tools..."

# Claude Code
run_stage 'Claude Code' install_cli claude @anthropic-ai/claude-code

# Codex CLI
run_stage 'Codex CLI' install_cli codex @openai/codex

# OpenCode powers the model picker and managed experiments.
run_stage 'OpenCode' install_opencode

# Durable Codex config was linked/rendered by the shared local sync above.
CODEX_DIR="$HOME/.codex"

if [ "$CONFIG_READY" -eq 1 ]; then
  run_stage 'GitHub MCP credential setup' setup_codex_credential github-mcp.env CODEX_GITHUB_PERSONAL_ACCESS_TOKEN \
    '  GitHub personal access token (or leave blank to skip): '
  run_stage 'Context7 MCP credential setup' setup_codex_credential context7.env CONTEXT7_API_KEY \
    '  Context7 API key (or leave blank to skip): '
else
  skipped_stage 'MCP credentials: configuration source unavailable'
fi

# ------------------------------------------------------------------------------
# 13. Claude Code - Global MCP Servers
# ------------------------------------------------------------------------------
info "Setting up global MCP servers..."

if [ "$CONFIG_READY" -eq 1 ] && command -v claude &>/dev/null; then
  register_claude_mcp() {
    local scope="$1"
    local name="$2"
    shift 2

    claude mcp remove "$name" --scope "$scope" >/dev/null 2>&1 || true
    claude mcp add "$name" --scope "$scope" -- "$@" >/dev/null
  }

  run_stage 'Claude Shopify MCP registration' register_claude_mcp user shopify-dev-mcp npx -y "@shopify/dev-mcp@$SHOPIFY_DEV_MCP_VERSION"
  run_stage 'Claude Playwright MCP registration' register_claude_mcp user playwright npx -y "@playwright/mcp@$PLAYWRIGHT_MCP_VERSION" --isolated
  if [ "${DOTFILES_SPECIALIST_MCPS:-0}" = "1" ]; then
    run_stage 'Claude Chrome DevTools MCP registration' register_claude_mcp user chrome-devtools npx "chrome-devtools-mcp@$CHROME_DEVTOOLS_MCP_VERSION"
  fi
  run_stage 'Claude Context7 MCP registration' register_claude_mcp user context7 "$DOTFILES/.codex/scripts/context7-mcp.sh"
  run_stage 'Claude GitHub MCP registration' register_claude_mcp user github-mcp "$DOTFILES/.codex/scripts/github-mcp.sh"

  PROJECT_MCP_DIR="$HOME/Documents/dev"
  if [ -d "$PROJECT_MCP_DIR" ]; then
    info "Setting up Documents/dev project MCP wrappers..."
    register_project_mcp() {
      cd "$PROJECT_MCP_DIR"
      register_claude_mcp project "$@"
    }
    run_stage 'Project Context7 MCP registration' register_project_mcp context7 "$DOTFILES/.codex/scripts/context7-mcp.sh"
    run_stage 'Project GitHub MCP registration' register_project_mcp github-mcp "$DOTFILES/.codex/scripts/github-mcp.sh"
  else
    warn "~/Documents/dev not found - skipping project MCP wrapper setup"
  fi
else
  skipped_stage 'Claude MCP registration: Claude CLI or configuration source unavailable'
fi

# ------------------------------------------------------------------------------
# Complete general durable/plugin setup using only the filtered installation source.
info "Completing assistant config, shared skills and Herdr/plugin setup..."
if [ "$CONFIG_READY" -eq 1 ]; then
  run_stage 'Assistant/plugin sync' finish_llm_setup
  run_stage 'Inspect diff dependency setup' bash "$DOTFILES/.claude/scripts/setup-inspect-diff.sh"
else
  skipped_stage 'Assistant/plugin sync and inspect setup: configuration source unavailable'
fi

# 14. Neovim - first launch plugin install
# ------------------------------------------------------------------------------
info "Bootstrapping Neovim plugins (headless)..."
if [ "$CONFIG_READY" -eq 1 ] && command -v nvim &>/dev/null; then
  bootstrap_nvim_config() {
    local appname="$1"
    shift

    [ "$HOME/.config/$appname" -ef "$DOTFILES/.config/$appname" ] || {
      error "Neovim config '$appname' link unavailable; refusing to bootstrap another config"
      return 1
    }
    NVIM_APPNAME="$appname" NVIM_SKIP_PACK_AUTO_UPDATE=1 nvim --headless "$@"
  }

  run_stage 'Neovim plugin bootstrap' bootstrap_nvim_config nvim "+qa"
  run_stage 'Cnvim plugin bootstrap' bootstrap_nvim_config cnvim "+qa"
  run_stage 'Nvim-lite plugin bootstrap' bootstrap_nvim_config nvim-lite "+Lazy! sync" "+qa"
else
  skipped_stage 'Neovim plugin bootstrap: Neovim or configuration source unavailable'
fi

# ------------------------------------------------------------------------------
# 15. macOS defaults (key repeat, SwiftBar)
# ------------------------------------------------------------------------------
# Fastest values System Settings offers. Takes effect after logging out and back in.
info "Setting macOS key repeat..."
set_key_repeat() {
  defaults write -g KeyRepeat -int 2
  defaults write -g InitialKeyRepeat -int 15
}
run_stage 'macOS key repeat (log out and back in to apply)' set_key_repeat

# SwiftBar: plugins live in the dotfiles; "Run in Terminal" actions open Ghostty.
setup_swiftbar() {
  defaults write com.ameba.SwiftBar PluginDirectory -string "$DOTFILES/.config/swiftbar/plugins"
  defaults write com.ameba.SwiftBar Terminal -string Ghostty
}
if [ "$CONFIG_READY" -eq 1 ]; then
  run_stage 'SwiftBar configuration (restart SwiftBar to apply)' setup_swiftbar
else
  skipped_stage 'SwiftBar configuration: configuration source unavailable'
fi

# ==============================================================================
# Done
# ==============================================================================
echo ""
echo "============================================"
echo '  Checking local installation'
echo "============================================"
echo ""

run_stage 'Local installation checks' env DOTFILES="$DOTFILES" bash "$DOTFILES/check-install.sh"

if [ -d "$BACKUP_DIR" ]; then
  info "Existing files were backed up to: $BACKUP_DIR"
fi

echo ""
echo "Remaining manual steps:"
echo "  1. Restart your terminal (or run: exec fish)"
echo "  2. After Fish configuration checks pass, select it as your login shell if desired (chsh -s $FISH)"
echo "  3. Open Neovim and run :Copilot auth to authenticate GitHub Copilot"
echo "  4. Run 'claude' to set up Claude Code (API key / login)"
echo "  5. Run 'codex' to set up Codex CLI login"
echo "  6. Run 'gh auth login'; connect OpenCode providers through its /connect command"
echo "  7. Add credentials for the general MCP servers you use (Context7/GitHub)"
echo "  8. Review Codex hooks through /hooks when it asks for trust"
echo "  9. Native Apple QA: install full Xcode, a compatible iOS runtime and Safari Technology Preview"
echo "     Then run: bash ~/.claude/scripts/apple-qa.sh preflight (availability only)"
echo "     Follow ~/.claude/scripts/APPLE-BROWSER-QA.md for activation and native checks"
echo " 10. Open herdr; Ctrl-s, Space opens the general workflow menu"
echo "     Client interaction assertions belong in each project's own tests"
echo ""

if [ "${#SKIPPED_STAGES[@]}" -ne 0 ]; then
  warn 'Stages skipped because prerequisites were unavailable:'
  printf '  - %s\n' "${SKIPPED_STAGES[@]}"
fi
if [ "${#FAILED_STAGES[@]}" -ne 0 ]; then
  error 'Installation has unresolved stages:'
  printf '  - %s\n' "${FAILED_STAGES[@]}"
  exit 1
fi
success 'Local installation checks passed. Complete the manual/account steps above before using affected workflows.'
