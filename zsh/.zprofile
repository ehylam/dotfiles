# Dotfiles-managed zsh login profile.
# Keep this file minimal: interactive shell setup belongs in ~/.zshrc.

if [ -x /opt/homebrew/bin/brew ]; then
  eval "$(SHELL=/bin/zsh /opt/homebrew/bin/brew shellenv)"
elif [ -x /usr/local/bin/brew ]; then
  eval "$(SHELL=/bin/zsh /usr/local/bin/brew shellenv)"
fi

for python_bin in /opt/homebrew/opt/python@3.12/libexec/bin /usr/local/opt/python@3.12/libexec/bin; do
  if [ -x "$python_bin/python3" ]; then
    export PATH="$python_bin:$PATH"
    break
  fi
done
unset python_bin

if [ -n "${CODEX_SANDBOX:-}${CODEX_CI:-}" ]; then
  export RTK_DB_PATH="${TMPDIR:-/tmp}/rtk-codex-history.db"
fi
