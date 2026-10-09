# Headroom context-compressor (opt-in). Installed 2026-06.
#
# `claude-hr`  launches Claude Code routed through the local Headroom proxy
#              (token compression of large tool outputs, --mode cache to
#              preserve Anthropic prompt-cache hits). Plain `claude` is
#              unaffected, so client work stays on the direct path unless you
#              opt in. The headroom_retrieve MCP tool (already registered for
#              Claude Code) lets the model pull full content back on demand.
#
# Remove this file to disable. Proxy log: ~/.local/state/headroom/proxy.log
# First `claude-hr` of the day downloads the ModernBERT model (one-time).

function hr-proxy --description 'Start the Headroom compression proxy on :8787 if not already up'
    if curl -s -o /dev/null --max-time 2 http://127.0.0.1:8787/ 2>/dev/null
        return 0
    end
    mkdir -p ~/.local/state/headroom
    echo "headroom: starting proxy on :8787 (cache mode; first run downloads the model)…"
    nohup headroom proxy --port 8787 --mode cache >~/.local/state/headroom/proxy.log 2>&1 &
    disown
    for i in (seq 1 60)
        if curl -s -o /dev/null --max-time 2 http://127.0.0.1:8787/ 2>/dev/null
            echo "headroom: proxy ready"
            return 0
        end
        sleep 2
    end
    echo "headroom: proxy did not come up — see ~/.local/state/headroom/proxy.log" >&2
    return 1
end

function hr-stop --description 'Stop the Headroom compression proxy'
    pkill -f 'headroom proxy --port 8787'; and echo "headroom: proxy stopped"; or echo "headroom: no proxy running"
end

function claude-hr --description 'Launch Claude Code through the Headroom compression proxy'
    hr-proxy; or return 1
    env ANTHROPIC_BASE_URL=http://127.0.0.1:8787 claude $argv
end
