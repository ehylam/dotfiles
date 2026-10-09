# Keep a herdr workspace label in step with the project the shell cd's into.
# The label follows the git repo root (else the directory) name, so moving into
# theme/ inside a repo keeps the repo name.

set -e -g __herdr_title_pwd

function __herdr_project_name --argument-names dir
    set -l root (command git -C $dir rev-parse --show-toplevel 2>/dev/null)
    test -n "$root"; or set root $dir
    path basename -- $root
end

function __herdr_workspace_title --on-variable PWD --on-event fish_prompt
    status is-command-substitution; and return
    test "$HERDR_ENV" = 1; or return
    set -q HERDR_WORKSPACE_ID; or return

    # No subprocesses on unchanged prompts. Manual labels survive until navigation.
    if test "$__herdr_title_pwd" = "$PWD"; and test "$__herdr_title_workspace" = "$HERDR_WORKSPACE_ID"; and test "$__herdr_title_socket" = "$HERDR_SOCKET_PATH"
        return
    end
    command -q herdr; or return

    set -l new (__herdr_project_name $PWD)

    set -l label (command herdr workspace get $HERDR_WORKSPACE_ID 2>/dev/null |
        python3 -c 'import json,sys
try: print(json.load(sys.stdin)["result"]["workspace"].get("label") or "")
except Exception: pass')
    if test "$label" != "$new"
        command herdr workspace rename $HERDR_WORKSPACE_ID $new >/dev/null 2>&1; or return
    end

    # Failed updates are retried at the next prompt.
    set -g __herdr_title_pwd $PWD
    set -g __herdr_title_workspace $HERDR_WORKSPACE_ID
    set -g __herdr_title_socket "$HERDR_SOCKET_PATH"
end

__herdr_workspace_title
