# OPENSPEC:START
# OpenSpec shell completions configuration
fpath=("$HOME/.oh-my-zsh/custom/completions" $fpath)
# OPENSPEC:END

# export PATH=$HOME/bin:/usr/local/bin:$PATH
#echo source ~/.bash_profile
DISABLE_AUTO_TITLE=true

if [ -x /opt/homebrew/bin/brew ]; then
  eval "$(SHELL=/bin/zsh /opt/homebrew/bin/brew shellenv)"
elif [ -x /usr/local/bin/brew ]; then
  eval "$(SHELL=/bin/zsh /usr/local/bin/brew shellenv)"
fi

# Add local ~/scripts to the PATH
export PATH="$HOME/scripts:$PATH"

export PATH="$HOME/.local/share/nvim/mason/bin:$PATH"

# Set XDG config home
export XDG_CONFIG_HOME="$HOME/.config"

# Default Neovim config (matches fish)
export NVIM_APPNAME=cnvim

if [ -n "${CODEX_SANDBOX:-}${CODEX_CI:-}" ]; then
  # Skip interactive framework setup in Codex sandboxes. Oh My Zsh, Starship,
  # and node managers write cache/session files outside the workspace.
  export RTK_DB_PATH="${TMPDIR:-/tmp}/rtk-codex-history.db"
  return 0
fi

# fnm (matches fish; auto-switches Node on cd via .nvmrc/.node-version)
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --use-on-cd --shell zsh)"
fi

export ZSH="$HOME/.oh-my-zsh"

plugins=(git zsh-autosuggestions zsh-syntax-highlighting web-search)
source $ZSH/oh-my-zsh.sh

# Starship
eval "$(starship init zsh)"

# Zoxide
eval "$(zoxide init zsh)"

export LANG=en_US.UTF-8

# other Aliases shortcuts
alias c="clear"
alias e="exit"

# Herdr
alias a="herdr"

alias lg="lazygit"

[[ "$TERM_PROGRAM" == "kiro" ]] && . "$(kiro --locate-shell-integration-path zsh)"

# Shopify Hydrogen alias to local projects
alias h2='$(npm prefix -s)/node_modules/.bin/shopify hydrogen'

# Added by Antigravity
export PATH="$HOME/.antigravity/antigravity/bin:$PATH"

# bun completions
[ -s "$HOME/.bun/_bun" ] && source "$HOME/.bun/_bun"

# bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
