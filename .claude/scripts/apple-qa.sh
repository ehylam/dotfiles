#!/usr/bin/env bash
# Short entry points for the documented native transports.
set -euo pipefail

fail() { echo "apple-qa: $*" >&2; exit 1; }
scripts=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
helper="$scripts/apple-browser-qa.mjs"
mode=${1:-help}
[ "$#" -eq 0 ] || shift

case "$mode" in
    help|--help|-h)
        echo 'Usage: bash ~/.claude/scripts/apple-qa.sh preflight|desktop|ios [helper options]'
        echo 'desktop: Technology Preview MCP; ios: Mobile Safari XCTest'
        echo 'No URL: synthetic fixture. URL: smoke check unless task assertions are supplied.'
        exit 0 ;;
    preflight|desktop|ios) ;;
    *) fail 'use preflight, desktop or ios' ;;
esac

has_runtime=0
for option in "$@"; do
    case "$option" in
        --browser|--browser=*|--driver|--driver=*|--transport|--transport=*)
            fail 'the selected mode sets browser, driver and transport; use the full helper for diagnostics' ;;
        --runtime|--runtime=*) has_runtime=1 ;;
    esac
done

case "$mode" in
    preflight)
        exec node "$helper" preflight --driver technology-preview "$@" ;;
    desktop)
        exec node "$helper" test --browser safari --driver technology-preview --transport mcp "$@" ;;
    ios)
        runtime_args=()
        if [ "$has_runtime" -eq 0 ]; then
            inventory=$(node "$helper" preflight)
            runtime=$(jq -r '
                if .simulators.error then error(.simulators.error)
                else .simulators.runtimes
                    | sort_by(.version | split(".") | map(tonumber))
                    | last | .identifier // empty
                end' <<<"$inventory")
            [ -n "$runtime" ] || fail 'No available iOS runtime. Install a compatible runtime in Xcode or pass --runtime.'
            runtime_args=(--runtime "$runtime")
        fi
        exec node "$helper" test --browser ios --transport xctest --boot-timeout 900 \
            ${runtime_args[@]+"${runtime_args[@]}"} "$@" ;;
esac
