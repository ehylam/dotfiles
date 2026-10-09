# ===== Basic Settings =====
set fish_greeting ""
set -gx EDITOR nvim
set -gx NVIM_APPNAME cnvim

if set -q CODEX_SANDBOX; or set -q CODEX_CI
    set -q TMPDIR; or set -gx TMPDIR /tmp
    set -gx RTK_DB_PATH "$TMPDIR/rtk-codex-history.db"
end

# ===== Aliases =====
alias ls "ls -p -G"
alias la "ls -A"
alias ll "ls -l"
alias lla "ll -A"
alias g git
command -qv nvim && alias vim nvim

# ===== PATH Setup (order matters - most specific first) =====
# Local bin directories. fish_add_path dedupes, so nested shells don't stack copies.
fish_add_path -g ~/.local/bin ~/bin

# pnpm
set -gx PNPM_HOME $HOME/Library/pnpm
if not contains $PNPM_HOME $PATH
    set -gx PATH $PNPM_HOME $PATH
end

# Go
set -gx GOPATH $HOME/go
if not contains $GOPATH/bin $PATH
    set -gx PATH $GOPATH/bin $PATH
end

# Rust/Cargo
if not contains $HOME/.cargo/bin $PATH
    set -gx PATH $HOME/.cargo/bin $PATH
end
test -f "$HOME/.cargo/env.fish" && source "$HOME/.cargo/env.fish"

# Android SDK
set -gx ANDROID_SDK_ROOT $HOME/Library/Android/sdk
if not contains $ANDROID_SDK_ROOT/emulator $PATH
    set -gx PATH $ANDROID_SDK_ROOT/emulator $PATH
end
if not contains $ANDROID_SDK_ROOT/platform-tools $PATH
    set -gx PATH $ANDROID_SDK_ROOT/platform-tools $PATH
end

# Ruby
if not contains /opt/homebrew/opt/ruby/bin $PATH
    set -gx PATH /opt/homebrew/opt/ruby/bin $PATH
end
# Ruby gems — resolve the gem bin dir once, then cache it in a universal var
# so shell startup doesn't spawn ruby every time. After upgrading ruby, run:
#   set -e -U gem_user_bin
if not set -q -U gem_user_bin
    set -U gem_user_bin (ruby -e 'puts Gem.user_dir + "/bin"' 2>/dev/null)
end
if test -n "$gem_user_bin"; and not contains $gem_user_bin $PATH
    fish_add_path -g $gem_user_bin
end

# ===== Platform-specific Config =====
switch (uname)
    case Darwin
        set -l config_file (dirname (status --current-filename))/config-osx.fish
        test -f $config_file && source $config_file
    case Linux
        set -l config_file (dirname (status --current-filename))/config-linux.fish
        test -f $config_file && source $config_file
    case '*'
        set -l config_file (dirname (status --current-filename))/config-windows.fish
        test -f $config_file && source $config_file
end

# ===== Tool Initialisations =====
if status is-interactive
    command -qv zoxide && zoxide init fish | source
    command -qv starship && starship init fish | source
end

# ===== Local Config =====
set -l LOCAL_CONFIG "$HOME/.config/fish-local.fish"
test -f $LOCAL_CONFIG && source $LOCAL_CONFIG

# ===== Neovim Configuration Functions =====
function nvim-default
    env NVIM_APPNAME=nvim nvim $argv
end

function nvim-cnvim
    env NVIM_APPNAME=cnvim nvim $argv
end

function nvim-lite
    env NVIM_APPNAME=nvim-lite nvim $argv
end

function nvims
    # NOTE: the `nvim` command itself runs cnvim (NVIM_APPNAME=cnvim above).
    # "nvim" here means the plain .config/nvim config.
    set items nvim cnvim nvim-lite
    set selected_config (printf "%s\n" $items | fzf --prompt=" Neovim Config = " --height=50% --layout=reverse --border --exit-0)

    switch $selected_config
        case nvim
            nvim-default $argv
        case cnvim
            nvim-cnvim $argv
        case nvim-lite
            nvim-lite $argv
        case '*'
            echo "Invalid selection"
    end
end

# bun
set --export BUN_INSTALL "$HOME/.bun"
fish_add_path "$BUN_INSTALL/bin"

# opencode
fish_add_path "$HOME/.opencode/bin"

# Qwen Code installs to ~/.local/bin, already added at the top of this file.

# kimi-code
fish_add_path -g "$HOME/.kimi-code/bin"
