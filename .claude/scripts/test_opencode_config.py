#!/usr/bin/env python3
"""Resolve the portable OpenCode config with synthetic credentials in isolated homes."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def main():
    binary = shutil.which("opencode")
    assert binary, "OpenCode is required for the native config check"
    source = json.loads((ROOT / ".config/opencode/opencode.json").read_text())
    assert "/Users/eric" not in json.dumps(source), "OpenCode config contains a fixed username"
    with tempfile.TemporaryDirectory(prefix="opencode-config-check-") as directory:
        for name in ("original-user", "relocated-user"):
            home = Path(directory) / name
            home.mkdir()
            (home / ".codex").mkdir()
            (home / ".codex/figma.key").write_text("synthetic-config-check-key")
            fixture = json.loads(json.dumps(source))
            for server in fixture["mcp"].values():
                server["enabled"] = False
            config = home / "opencode.json"
            config.write_text(json.dumps(fixture))
            env = dict(os.environ, HOME=str(home), XDG_CONFIG_HOME=str(home / "config"),
                       XDG_DATA_HOME=str(home / "data"), XDG_CACHE_HOME=str(home / "cache"),
                       XDG_STATE_HOME=str(home / "state"), OPENCODE_CONFIG=str(config),
                       OPENCODE_DISABLE_MODELS_FETCH="true", OPENCODE_DISABLE_AUTOUPDATE="true")
            env.pop("OPENCODE_CONFIG_CONTENT", None)
            env.pop("OPENCODE_CONFIG_DIR", None)
            result = subprocess.run([binary, "debug", "config", "--pure"], cwd=home, env=env,
                                    capture_output=True, text=True, timeout=30)
            assert result.returncode == 0, "Native OpenCode config resolution failed: " + result.stderr
            resolved = json.loads(result.stdout)
            for server, wrapper in {"context7": "context7-mcp", "github-mcp": "github-mcp"}.items():
                command = resolved["mcp"][server]["command"][0]
                assert command == f"{home}/.dotfiles/.codex/scripts/{wrapper}.sh", command
            assert resolved["instructions"] == [f"{home}/.claude/rules/*.md"]
            assert resolved["mcp"]["harvester"]["environment"]["NODE_PATH"] == f"{home}/Documents/mcps/shopify-backend-mcp/node_modules"
    print("PASS: native OpenCode resolves MCP and rule paths for two homes without live credentials or MCP startup")


if __name__ == "__main__":
    main()
