function claude --wraps=claude --description "Claude Code with completion bell"
    command bash -c '
        if [ -f "$HOME/.codex/figma.env" ]; then
            set -a
            source "$HOME/.codex/figma.env" || exit $?
            set +a
        fi
        exec claude "$@"
    ' -- $argv
    set -l result $status
    printf '\a'
    return $result
end
