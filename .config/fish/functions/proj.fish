function proj --description 'Focus a herdr workspace or open a project directory; pick if no arg'
    if not command -q herdr
        printf 'proj requires herdr in PATH.\n' >&2
        return 127
    end
    if not set -q HERDR_ENV; or test "$HERDR_ENV" != 1
        printf 'Run proj inside herdr.\n' >&2
        return 1
    end
    if test (count $argv) -gt 1
        printf 'Usage: proj [workspace-id | directory]\n' >&2
        return 2
    end
    if test (count $argv) -eq 0
        command bash "$HOME/.config/herdr/project-picker.sh"
    else if test -d "$argv[1]"
        set -l directory (path resolve -- "$argv[1]")
        command herdr workspace create --cwd "$directory" --label (path basename -- "$directory") --focus >/dev/null
    else
        command herdr workspace focus "$argv[1]" >/dev/null
    end
end
