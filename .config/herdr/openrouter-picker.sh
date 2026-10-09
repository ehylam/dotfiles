#!/usr/bin/env bash
# Usage: openrouter-picker.sh [provider=openrouter|all] [active-limit=3]
# Select models for this workspace without changing OpenCode provider/model defaults.

set -euo pipefail

fail() { echo "model-picker: $*" >&2; exit 1; }
[ "${HERDR_ENV:-}" = 1 ] || fail 'run this picker inside Herdr'
provider=${1:-openrouter}; limit=${2:-3}
[[ "$limit" =~ ^[1-9][0-9]{0,3}$ ]] || fail 'active limit must be a positive integer below 10000'
[ "$#" -le 2 ] || fail 'usage: openrouter-picker.sh [provider|all] [active-limit]'

# Which-key passes the original pane. Direct pane calls use their caller context;
# a prefix popup has neither, so capture the UI-focused pane before opening fzf.
target=()
if [ -n "${HK_PANE:-}" ]; then target=(--pane "$HK_PANE")
elif [ -n "${HERDR_PANE_ID:-}" ]; then target=(--current); fi
pane=$(herdr pane current ${target[@]+"${target[@]}"})
caller=$(jq -er '.result.pane.pane_id | strings | select(length > 0)' <<<"$pane")
ws=$(jq -er '.result.pane.workspace_id | strings | select(length > 0)' <<<"$pane")
cwd=$(jq -er '.result.pane.cwd | strings | select(startswith("/"))' <<<"$pane")
[ -d "$cwd" ] || fail 'original pane directory is unavailable'

# Keep catalog failures distinct from fzf cancellation. No auth files are inspected.
if [ "$provider" = all ]; then catalog=$(opencode models)
else catalog=$(opencode models "$provider"); fi
[ -n "$catalog" ] || fail 'no models available for the selected provider'
if [ "$provider" = openrouter ]; then
    source_path=$0
    while [ -L "$source_path" ]; do
        source_dir=$(cd -- "$(dirname -- "$source_path")" && pwd)
        source_path=$(readlink "$source_path")
        [[ "$source_path" = /* ]] || source_path="$source_dir/$source_path"
    done
    profiles="$(cd -- "$(dirname -- "$source_path")" && pwd)/openrouter-models.json"
    catalog=$(jq -r --arg catalog "$catalog" '.allowlist[] | select(. != "openrouter/free") | "openrouter/" + . | select(. as $model | $catalog | split("\n") | index($model))' "$profiles")
    [ -n "$catalog" ] || fail 'shortlisted models are unavailable in the OpenCode catalog'
fi
if models=$(fzf --multi --no-sort \
    --border --border-label " $provider models " --prompt '> ' \
    --header "tab: toggle   enter: open models   active limit: $limit
shared checkout: read-only comparisons; writers need separate worktrees" <<<"$catalog"); then :
else
    result=$?
    case "$result" in 1|130) exit 0 ;; *) fail "model selection failed ($result)" ;; esac
fi
[ -n "$models" ] || exit 0
# A selection must come from the catalog; remove duplicate selections before mutation.
models=$(awk '!seen[$0]++' <<<"$models")
while IFS= read -r model; do
    [[ "$model" == */* ]] && grep -Fqx -- "$model" <<<"$catalog" || fail 'invalid model selection'
done <<<"$models"

agents() {
    herdr agent list | jq -ce '.result.agents | arrays | if all(.[]; type == "object" and (.agent_status | type == "string")) then . else error("invalid agent list") end'
}
reserved=0; index=0; owned='[]'

while IFS= read -r model; do
    # Recheck before each launch. Reserve this invocation's starts even if they are
    # initially idle, so a large selection cannot bypass the cap through startup lag.
    live=$(agents)
    busy=$(jq --arg caller "$caller" --argjson owned "$owned" '[.[] | select(.pane_id != $caller and ((.name // "") as $name | $owned | index($name) | not) and (.agent_status != "idle" and .agent_status != "done"))] | length' <<<"$live")
    if (( busy + reserved >= limit )); then
        echo "model-picker: deferred $model (active limit $limit)" >&2
        continue
    fi
    root=$(herdr tab create --workspace "$ws" --cwd "$cwd" --label "${model##*/}" --no-focus \
        | jq -er '.result.root_pane.pane_id | strings | select(length > 0)')
    index=$((index + 1)); name="model-$$-$index"
    while jq -e --arg name "$name" 'any(.[]; .name == $name)' <<<"$live" >/dev/null; do
        index=$((index + 1)); name="model-$$-$index"
    done
    # Native argv passing avoids shell quoting and waits for interactive readiness.
    # Startup errors stop the batch and leave its tab intact for inspection.
    herdr agent start "$name" --kind opencode --pane "$root" -- --model "$model" "$cwd"
    owned=$(jq -c --arg name "$name" '. + [$name]' <<<"$owned")
    reserved=$((reserved + 1))
done <<<"$models"
