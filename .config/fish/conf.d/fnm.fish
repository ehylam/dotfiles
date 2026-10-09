# Select the project version before its first command and synchronously on cd.
if set -q CODEX_SANDBOX; or set -q CODEX_CI
    # Codex sandboxes cannot create fnm multishell symlinks in ~/.local/state.
    return
end

if command -v fnm >/dev/null
    functions -e __auto_fnm
    fnm env --use-on-cd --resolve-engines=false --shell fish | source
end
