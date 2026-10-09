#!/usr/bin/env bash
# Project navigator for herdr: pick a live workspace or a zoxide project dir.
# Live workspaces focus; directories create a new workspace named after the dir.

set -euo pipefail

blue=$'\033[34m'
dim=$'\033[2m'
reset=$'\033[0m'

list() {
    # Live workspaces first, tagged w:<id>.
    herdr workspace list | jq -r '.result.workspaces[] | "\(.workspace_id)\t\(.label)"' \
        | while IFS=$'\t' read -r id label; do
            printf '%s●%s %s\tw:%s\n' "$blue" "$reset" "$label" "$id"
        done

    # zoxide-backed project dirs, tagged d:<path>.
    zoxide query --list 2>/dev/null | while IFS= read -r dir; do
        printf '%s  %s%s\td:%s\n' "$dim" "$dir" "$reset" "${dir/#\~/$HOME}"
    done
}

sel=$(list | fzf --no-sort --ansi --delimiter=$'\t' --with-nth=1 \
    --border --border-label ' projects ' --prompt '> ' \
    --header 'enter: focus or create workspace' \
    --bind 'tab:down,btab:up' | cut -f2) || exit 0
[ -n "$sel" ] || exit 0

case "$sel" in
    w:*) herdr workspace focus "${sel#w:}" >/dev/null ;;
    d:*) dir=${sel#d:}
         herdr workspace create --cwd "$dir" --label "$(basename "$dir")" --focus >/dev/null ;;
esac
