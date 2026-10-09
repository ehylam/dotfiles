#!/usr/bin/env bash
set -euo pipefail

MODE="apply"
SCOPE="all"

usage() {
  cat <<'EOF'
Usage: sync-llm.sh [--apply|--check] [--bootstrap-config|--local-config]

Synchronize durable assistant config from ~/.dotfiles.
--bootstrap-config links local Claude/OpenCode config only, without remote or credential-backed work.
--local-config includes all durable local config/skills, without integrations, plugins or MCP discovery.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --apply)
      MODE="apply"
      ;;
    --check|--dry-run)
      MODE="check"
      ;;
    --bootstrap-config)
      SCOPE="bootstrap"
      ;;
    --local-config)
      SCOPE="local"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

DOTFILES="${DOTFILES:-$HOME/.dotfiles}"
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
CLAUDE_MCP_CONFIG="${CLAUDE_MCP_CONFIG:-$HOME/.claude.json}"
CODEX_DIR="${CODEX_DIR:-$HOME/.codex}"
AGENTS_DIR="${AGENTS_DIR:-$HOME/.agents}"
PROJECT_MCP_FILE="${PROJECT_MCP_FILE:-$HOME/Documents/dev/.mcp.json}"
OPENCODE_DIR="${OPENCODE_DIR:-$HOME/.config/opencode}"
HERDR_DIR="${HERDR_DIR:-$HOME/.config/herdr}"
SYNC_HERDR_PLUGINS="${SYNC_HERDR_PLUGINS:-1}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/.dotfiles-backup/$(date +%Y%m%d-%H%M%S)}"
PONYTAIL_MARKETPLACE_NAME="${PONYTAIL_MARKETPLACE_NAME:-ponytail}"
PONYTAIL_PLUGIN_ID="${PONYTAIL_PLUGIN_ID:-ponytail@ponytail}"
PONYTAIL_GITHUB_SOURCE="${PONYTAIL_GITHUB_SOURCE:-DietrichGebert/ponytail}"
SYNC_PONYTAIL_PLUGINS="${SYNC_PONYTAIL_PLUGINS:-1}"

changed=0

info() { printf '[INFO] %s\n' "$1"; }
ok() { printf '[OK] %s\n' "$1"; }
warn() { printf '[WARN] %s\n' "$1"; }

path_real() {
  local path="$1"
  if command -v realpath >/dev/null 2>&1; then
    realpath "$path" 2>/dev/null || printf '%s\n' "$path"
  else
    printf '%s\n' "$path"
  fi
}

link_matches() {
  local src="$1"
  local dest="$2"
  local target

  [ -L "$dest" ] || return 1
  target=$(readlink "$dest")

  case "$target" in
    /*) [ "$(path_real "$target")" = "$(path_real "$src")" ] ;;
    *) [ "$(path_real "$(dirname "$dest")/$target")" = "$(path_real "$src")" ] ;;
  esac
}

ensure_dir() {
  local dir="$1"
  [ -d "$dir" ] && return 0

  changed=1
  if [ "$MODE" = "check" ]; then
    warn "Would create directory $dir"
  else
    mkdir -p "$dir"
    ok "Created directory $dir"
  fi
}

backup_existing() {
  local dest="$1"
  local backup
  case "$dest" in
    /*) backup="$BACKUP_DIR/${dest#/}" ;;
    *) backup="$BACKUP_DIR/${PWD#/}/$dest" ;;
  esac
  ensure_dir "$(dirname "$backup")"
  if [ -e "$backup" ] || [ -L "$backup" ]; then
    local slot
    slot=$(mktemp -d "${backup}.XXXXXX")
    backup="$slot/$(basename "$dest")"
  fi
  mv "$dest" "$backup"
  info "Backed up existing $dest to $backup"
}

link_path() {
  local src="$1"
  local dest="$2"

  if [ ! -e "$src" ]; then
    changed=1
    warn "Source missing, skipped: $src"
    return 0
  fi

  if link_matches "$src" "$dest"; then
    ok "$dest already linked"
    return 0
  fi

  changed=1
  if [ "$MODE" = "check" ]; then
    warn "Would link $dest -> $src"
    return 0
  fi

  ensure_dir "$(dirname "$dest")"

  if [ -L "$dest" ]; then
    rm "$dest"
  elif [ -e "$dest" ]; then
    backup_existing "$dest"
  fi

  ln -s "$src" "$dest"
  ok "Linked $dest -> $src"
}

render_codex_config() {
  local output="$1"
  local base="$DOTFILES/.codex/config.toml"
  local user="$DOTFILES/.codex/config.user.toml"

  : > "$output"

  if [ -f "$user" ]; then
    cat "$user" >> "$output"
    printf '\n' >> "$output"
  fi

  cat "$base" >> "$output"

  # Keep what Codex wrote itself (/model, project + hook trust) instead of reverting it.
  if [ -f "$CODEX_DIR/config.toml" ]; then
    python3 "$(dirname "${BASH_SOURCE[0]}")/merge-codex-config.py" "$output" "$CODEX_DIR/config.toml"
  fi
}

sync_codex_config() {
  local base="$DOTFILES/.codex/config.toml"
  local dest="$CODEX_DIR/config.toml"
  local tmp

  if [ ! -f "$base" ]; then
    changed=1
    warn "Source missing, skipped: $base"
    return 0
  fi

  tmp=$(mktemp)
  render_codex_config "$tmp"

  if [ -e "$dest" ] || [ -L "$dest" ]; then
    if cmp -s "$tmp" "$dest"; then
      rm "$tmp"
      ok "$dest already generated"
      return 0
    fi
  fi

  changed=1
  if [ "$MODE" = "check" ]; then
    rm "$tmp"
    warn "Would generate $dest from $base"
    return 0
  fi

  ensure_dir "$(dirname "$dest")"

  if [ -L "$dest" ]; then
    rm "$dest"
  elif [ -e "$dest" ]; then
    backup_existing "$dest"
  fi

  mv "$tmp" "$dest"
  chmod 600 "$dest"
  ok "Generated $dest from $base"
}

render_claude_md() {
  local src="$DOTFILES/.claude/CLAUDE.global.md"  # not CLAUDE.md: that name would also load as project memory inside ~/.dotfiles
  local rtk="$DOTFILES/.claude/RTK.md"
  local dest="$CLAUDE_DIR/CLAUDE.md"
  local tmp

  if [ ! -f "$src" ]; then
    changed=1
    warn "Source missing, skipped: $src"
    return 0
  fi

  # Rendered as a real file, not a symlink, and with @RTK.md inlined.
  # Cowork sessions skip a symlinked ~/.claude/CLAUDE.md and skip any
  # user-scope import resolving outside the working directory, so neither
  # a link nor the import survives there. Terminal sessions are unaffected.
  tmp=$(mktemp)
  {
    printf '<!-- Generated by sync-llm from %s. Edit that file, not this one, then run bash ~/.agents/skills/sync-llm/scripts/sync-llm.sh --apply. -->\n' "$src"
    if [ -f "$rtk" ]; then
      awk -v rtk="$rtk" '$0 == "@RTK.md" { while ((getline line < rtk) > 0) print line; close(rtk); next } { print }' "$src"
    else
      warn "Source missing, import left unexpanded: $rtk"
      cat "$src"
    fi
  } > "$tmp"

  if [ -f "$dest" ] && [ ! -L "$dest" ] && cmp -s "$tmp" "$dest"; then
    rm -f "$tmp"
    ok "$dest already up to date"
    return 0
  fi

  changed=1
  if [ "$MODE" = "check" ]; then
    rm -f "$tmp"
    warn "Would render $dest from $src (with $rtk inlined)"
    return 0
  fi

  ensure_dir "$(dirname "$dest")"
  if [ -L "$dest" ]; then
    rm "$dest"
  elif [ -e "$dest" ]; then
    backup_existing "$dest"
  fi

  mv "$tmp" "$dest"
  chmod 644 "$dest"
  ok "Rendered $dest from $src (with $rtk inlined)"
}

sync_claude_rules() {
  local dotfiles_rules="$DOTFILES/.claude/rules"
  local rule name

  if [ ! -d "$dotfiles_rules" ]; then
    changed=1
    warn "No dotfiles rules directory at $dotfiles_rules"
    return 0
  fi

  info "Syncing Claude Code rules"

  # Per-file links: ~/.claude/rules stays a real directory, which is the
  # documented-supported shape for symlinked rules.
  if [ -L "$CLAUDE_DIR/rules" ]; then
    changed=1
    if [ "$MODE" = "check" ]; then
      warn "Would replace symlinked $CLAUDE_DIR/rules with a real directory"
      return 0
    fi
    rm "$CLAUDE_DIR/rules"
    ok "Replaced symlinked $CLAUDE_DIR/rules with a real directory"
  fi
  ensure_dir "$CLAUDE_DIR/rules"

  for rule in "$dotfiles_rules"/*.md; do
    [ -e "$rule" ] || continue
    name=$(basename "$rule")
    link_path "$rule" "$CLAUDE_DIR/rules/$name"
  done
}

sync_claude() {
  info "Syncing Claude Code config"
  ensure_dir "$CLAUDE_DIR"

  render_claude_md
  link_path "$DOTFILES/.claude/RTK.md" "$CLAUDE_DIR/RTK.md"
  link_path "$DOTFILES/.claude/settings.json" "$CLAUDE_DIR/settings.json"
  link_path "$DOTFILES/.claude/statusline-command.sh" "$CLAUDE_DIR/statusline-command.sh"
  link_path "$DOTFILES/.claude/commands" "$CLAUDE_DIR/commands"
  link_path "$DOTFILES/.claude/scripts" "$CLAUDE_DIR/scripts"
  sync_claude_rules

  if [ -L "$CLAUDE_DIR/settings.local.json" ] && [ ! -e "$CLAUDE_DIR/settings.local.json" ]; then
    changed=1
    if [ "$MODE" = "check" ]; then
      warn "Would replace broken $CLAUDE_DIR/settings.local.json symlink with local empty JSON"
    else
      rm "$CLAUDE_DIR/settings.local.json"
      printf '{\n}\n' > "$CLAUDE_DIR/settings.local.json"
      ok "Replaced broken $CLAUDE_DIR/settings.local.json symlink with local empty JSON"
    fi
  fi
}

sync_codex() {
  info "Syncing Codex config"
  ensure_dir "$CODEX_DIR"

  sync_codex_config
  for profile_config in "$DOTFILES/.codex/triage.config.toml" "$DOTFILES/.codex/review.config.toml" "$DOTFILES/.codex/deep.config.toml"; do
    link_path "$profile_config" "$CODEX_DIR/$(basename "$profile_config")"
  done
  link_path "$DOTFILES/.codex/AGENTS.md" "$CODEX_DIR/AGENTS.md"
  link_path "$DOTFILES/.codex/RTK.md" "$CODEX_DIR/RTK.md"
  link_path "$DOTFILES/.codex/hooks.user.json" "$CODEX_DIR/hooks.json"
  link_path "$DOTFILES/.codex/scripts" "$CODEX_DIR/scripts"

  if [ ! -f "$CODEX_DIR/github-mcp.env" ]; then
    warn "$CODEX_DIR/github-mcp.env missing; GitHub MCP credentials remain local and are not synced"
  fi
  if [ ! -f "$CODEX_DIR/context7.env" ]; then
    warn "$CODEX_DIR/context7.env missing; Context7 MCP credentials remain local and are not synced"
  fi
}

sync_shell_startup() {
  info "Syncing shell startup guards"

  link_path "$DOTFILES/zsh/.zprofile" "$HOME/.zprofile"
  link_path "$DOTFILES/zsh/.zlogin" "$HOME/.zlogin"
  link_path "$DOTFILES/zsh/.zshrc" "$HOME/.zshrc"
}

sync_rtk_config() {
  info "Syncing RTK config"

  link_path "$DOTFILES/.config/rtk/config.toml" "$HOME/Library/Application Support/rtk/config.toml"
}

sync_shared_skills() {
  local dotfiles_skills="$DOTFILES/.agents/skills"
  local skill name

  info "Syncing shared user skills"
  ensure_dir "$AGENTS_DIR/skills"
  ensure_dir "$CLAUDE_DIR/skills"

  if [ -d "$dotfiles_skills" ]; then
    for skill in "$dotfiles_skills"/*; do
      [ -e "$skill" ] || [ -L "$skill" ] || continue
      [ -d "$skill" ] || continue
      name=$(basename "$skill")
      link_path "$skill" "$AGENTS_DIR/skills/$name"
    done
  else
    changed=1
    warn "No dotfiles shared skills directory at $dotfiles_skills"
  fi

  for skill in "$AGENTS_DIR/skills"/*; do
    [ -e "$skill" ] || [ -L "$skill" ] || continue
    [ -d "$skill" ] || continue
    name=$(basename "$skill")
    link_path "$skill" "$CLAUDE_DIR/skills/$name"
  done

  prune_dangling_skill_links "$AGENTS_DIR/skills"
  prune_dangling_skill_links "$CLAUDE_DIR/skills"
}

# Links into skills this script manages, whose target has since gone (a renamed or
# retired skill). Linking only ever adds, so without this they pile up.
prune_dangling_skill_links() {
  local root="$1" link target

  [ -d "$root" ] || return 0
  for link in "$root"/*; do
    [ -L "$link" ] && [ ! -e "$link" ] || continue
    target=$(readlink "$link")
    case "$target" in
      "$DOTFILES/.agents/skills/"*|"$AGENTS_DIR/skills/"*|../../.agents/skills/*) ;;
      *) continue ;;  # not ours: leave it
    esac
    changed=1
    if [ "$MODE" = "check" ]; then
      warn "Would remove dangling skill link $link -> $target"
    else
      rm "$link"
      ok "Removed dangling skill link $link -> $target"
    fi
  done
}

project_mcp_command_matches() {
  local file="$1"
  local name="$2"
  local expected_command="$3"

  python3 - "$file" "$name" "$expected_command" <<'PY'
import json
import sys

path, name, expected_command = sys.argv[1:4]

try:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
except Exception:
    sys.exit(1)

server = data.get("mcpServers", {}).get(name, {})
if (
    server.get("command") == expected_command
    and not server.get("args")
    and not server.get("url")
    and not server.get("env")
):
    sys.exit(0)

sys.exit(1)
PY
}

claude_marketplace_configured() {
  local name="$1"

  claude plugin marketplace list --json 2>/dev/null | python3 -c '
import json
import sys

name = sys.argv[1]
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(1)

for marketplace in data:
    if marketplace.get("name") == name:
        sys.exit(0)

sys.exit(1)
' "$name"
}

claude_plugin_installed() {
  local id="$1"

  claude plugin list --json 2>/dev/null | python3 -c '
import json
import sys

plugin_id = sys.argv[1]
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(1)

for plugin in data:
    if plugin.get("id") == plugin_id:
        sys.exit(0)

sys.exit(1)
' "$id"
}

codex_marketplace_configured() {
  local name="$1"

  codex plugin marketplace list --json 2>/dev/null | python3 -c '
import json
import sys

name = sys.argv[1]
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(1)

for marketplace in data.get("marketplaces", []):
    if marketplace.get("name") == name:
        sys.exit(0)

sys.exit(1)
' "$name"
}

codex_plugin_installed() {
  local id="$1"

  codex plugin list --json 2>/dev/null | python3 -c '
import json
import sys

plugin_id = sys.argv[1]
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(1)

for plugin in data.get("installed", []):
    if plugin.get("pluginId") == plugin_id and plugin.get("enabled") is True:
        sys.exit(0)

sys.exit(1)
' "$id"
}

sync_ponytail_config() {
  info "Syncing Ponytail config"

  link_path "$DOTFILES/.config/ponytail" "$HOME/.config/ponytail"
  link_path "$DOTFILES/.config/ponytail/ponytail-mode" "$HOME/.local/bin/ponytail-mode"
}

sync_ponytail_claude_plugin() {
  [ "$SYNC_PONYTAIL_PLUGINS" = "1" ] || return 0

  info "Syncing Ponytail Claude plugin"

  if ! command -v claude >/dev/null 2>&1; then
    warn "Claude Code unavailable; skipping Ponytail Claude plugin sync"
    return 0
  fi

  if [ "$MODE" = "check" ]; then
    if claude_marketplace_configured "$PONYTAIL_MARKETPLACE_NAME"; then
      ok "$PONYTAIL_MARKETPLACE_NAME marketplace configured in Claude"
    else
      changed=1
      warn "Would add Claude marketplace $PONYTAIL_MARKETPLACE_NAME from $PONYTAIL_GITHUB_SOURCE"
    fi

    if claude_plugin_installed "$PONYTAIL_PLUGIN_ID"; then
      ok "$PONYTAIL_PLUGIN_ID installed in Claude"
    else
      changed=1
      warn "Would install Claude plugin $PONYTAIL_PLUGIN_ID"
    fi

    return 0
  fi

  if ! claude_marketplace_configured "$PONYTAIL_MARKETPLACE_NAME"; then
    if claude plugin marketplace add "$PONYTAIL_GITHUB_SOURCE" --scope user >/dev/null; then
      ok "Added Claude marketplace $PONYTAIL_MARKETPLACE_NAME"
    else
      warn "Could not add Claude marketplace $PONYTAIL_MARKETPLACE_NAME"
      return 0
    fi
  else
    ok "$PONYTAIL_MARKETPLACE_NAME marketplace already configured in Claude"
  fi

  if claude_plugin_installed "$PONYTAIL_PLUGIN_ID"; then
    ok "$PONYTAIL_PLUGIN_ID already installed in Claude"
  else
    if claude plugin install "$PONYTAIL_PLUGIN_ID" --scope user >/dev/null; then
      ok "Installed Claude plugin $PONYTAIL_PLUGIN_ID"
    else
      warn "Could not install Claude plugin $PONYTAIL_PLUGIN_ID"
    fi
  fi
}

sync_ponytail_codex_plugin() {
  [ "$SYNC_PONYTAIL_PLUGINS" = "1" ] || return 0

  info "Syncing Ponytail Codex plugin"

  if ! command -v codex >/dev/null 2>&1; then
    warn "Codex CLI unavailable; skipping Ponytail Codex plugin sync"
    return 0
  fi

  if [ "$MODE" = "check" ]; then
    if codex_marketplace_configured "$PONYTAIL_MARKETPLACE_NAME"; then
      ok "$PONYTAIL_MARKETPLACE_NAME marketplace configured in Codex"
    else
      changed=1
      warn "Would add Codex marketplace $PONYTAIL_MARKETPLACE_NAME from $PONYTAIL_GITHUB_SOURCE"
    fi

    if codex_plugin_installed "$PONYTAIL_PLUGIN_ID"; then
      ok "$PONYTAIL_PLUGIN_ID installed in Codex"
    else
      changed=1
      warn "Would install Codex plugin $PONYTAIL_PLUGIN_ID"
    fi

    return 0
  fi

  if ! codex_marketplace_configured "$PONYTAIL_MARKETPLACE_NAME"; then
    if codex plugin marketplace add "$PONYTAIL_GITHUB_SOURCE" >/dev/null; then
      ok "Added Codex marketplace $PONYTAIL_MARKETPLACE_NAME"
    else
      warn "Could not add Codex marketplace $PONYTAIL_MARKETPLACE_NAME"
      return 0
    fi
  else
    ok "$PONYTAIL_MARKETPLACE_NAME marketplace already configured in Codex"
  fi

  if codex_plugin_installed "$PONYTAIL_PLUGIN_ID"; then
    ok "$PONYTAIL_PLUGIN_ID already installed in Codex"
  else
    if codex plugin add "$PONYTAIL_PLUGIN_ID" >/dev/null; then
      ok "Installed Codex plugin $PONYTAIL_PLUGIN_ID"
    else
      warn "Could not install Codex plugin $PONYTAIL_PLUGIN_ID"
    fi
  fi
}

sync_project_mcp_wrappers() {
  local file="$PROJECT_MCP_FILE"
  local dir
  local name
  local command
  local entry
  local entries=(
    "context7:$DOTFILES/.codex/scripts/context7-mcp.sh"
    "github-mcp:$DOTFILES/.codex/scripts/github-mcp.sh"
  )

  info "Syncing Claude project MCP wrappers"

  if [ ! -f "$file" ]; then
    warn "$file missing; skipping project-level Claude MCP wrapper sync"
    return 0
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    warn "python3 unavailable; cannot inspect $file"
    return 0
  fi

  dir=$(dirname "$file")

  for entry in "${entries[@]}"; do
    name="${entry%%:*}"
    command="${entry#*:}"
    if project_mcp_command_matches "$file" "$name" "$command"; then
      ok "$file $name already uses dotfiles wrapper"
      continue
    fi

    changed=1
    if [ "$MODE" = "check" ]; then
      warn "Would set $file $name -> $command"
      continue
    fi

    if ! command -v claude >/dev/null 2>&1; then
      warn "Claude Code unavailable; cannot update $file $name"
      continue
    fi

    (
      cd "$dir"
      claude mcp remove "$name" --scope project >/dev/null 2>&1 || true
      claude mcp add "$name" --scope project -- "$command" >/dev/null
    )
    ok "Set $file $name -> $command"
  done

}

sync_playwright_registrations() {
  local status=0
  info "Syncing Claude Playwright registrations with Codex"
  python3 - "$MODE" "$DOTFILES/.codex/config.toml" "$CLAUDE_MCP_CONFIG" "$PROJECT_MCP_FILE" "$BACKUP_DIR" <<'PY' || status=$?
import copy
import json
import os
import re
import shutil
import sys
import tempfile
import time
import tomllib
from pathlib import Path

mode, source, claude, project_file, backup_dir = sys.argv[1:]
try:
    canonical = tomllib.loads(Path(source).read_text())["mcp_servers"]["playwright"]
    package = next(arg for arg in canonical["args"] if re.fullmatch(r"@playwright/mcp@[^@]+", arg))
    if canonical["command"] != "npx" or "--isolated" not in canonical["args"]:
        raise ValueError("Codex Playwright must use npx and --isolated")
except (OSError, KeyError, StopIteration, ValueError) as error:
    print("[WARN] Cannot read canonical Codex Playwright registration", file=sys.stderr)
    sys.exit(2)

def align(servers, create=False):
    if "playwright" not in servers:
        if create:
            servers["playwright"] = {"type": "stdio", "command": canonical["command"], "args": canonical["args"][:]}
        return
    server = servers["playwright"]
    args = server.get("args", [])
    if server.get("command") != "npx" or not isinstance(args, list) or not all(isinstance(x, str) for x in args):
        raise ValueError("Playwright registration is not an npx argument list")
    packages = [i for i, arg in enumerate(args) if re.fullmatch(r"@playwright/mcp(?:@[^@]+)?", arg)]
    if len(packages) != 1:
        raise ValueError("Playwright registration must contain one package argument")
    if any(arg.split("=", 1)[0] in {"--extension", "--cdp-endpoint", "--endpoint", "--user-data-dir"} for arg in args):
        raise ValueError("Attached or persistent Playwright registration requires manual review")
    args[packages[0]] = package
    if "-y" not in args and "--yes" not in args:
        args.insert(0, "-y")
    if "--isolated" not in args:
        args.append("--isolated")

pending = []
try:
    for filename, user_config in [(claude, True), (project_file, False)]:
        path = Path(filename)
        if not path.exists():
            print("[WARN] Missing MCP config, skipped: " + filename)
            continue
        original = path.read_bytes()
        data = json.loads(original)
        updated = copy.deepcopy(data)
        align(updated.setdefault("mcpServers", {}), create=user_config)
        if user_config:
            for config in updated.get("projects", {}).values():
                align(config.get("mcpServers", {}))
        if updated != data:
            pending.append((path.resolve(), original, updated))
except (OSError, ValueError, TypeError, AttributeError) as error:
    print("[WARN] Playwright registration sync stopped: " + str(error), file=sys.stderr)
    sys.exit(2)

if mode == "check":
    for path, _, _ in pending:
        print("[WARN] Would pin and isolate Playwright registrations in " + str(path))
    sys.exit(1 if pending else 0)

for path, original, updated in pending:
    if path.read_bytes() != original:
        print("[WARN] MCP config changed during sync; retry: " + str(path), file=sys.stderr)
        sys.exit(2)
    backup = Path(backup_dir)
    backup.mkdir(parents=True, exist_ok=True, mode=0o700)
    saved = backup / (path.name + ".playwright-" + str(time.time_ns()))
    shutil.copy2(path, saved)
    saved.chmod(0o600)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".sync-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(updated, handle, indent=2)
            handle.write("\n")
        os.chmod(temporary, path.stat().st_mode & 0o777)
        if path.read_bytes() != original:
            print("[WARN] MCP config changed during sync; retry: " + str(path), file=sys.stderr)
            sys.exit(2)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print("[OK] Pinned and isolated Playwright registrations in " + str(path))
PY
  if [ "$status" -eq 1 ] && [ "$MODE" = "check" ]; then
    changed=1
  elif [ "$status" -ne 0 ]; then
    return "$status"
  fi
}

sync_opencode() {
  info "Syncing opencode config"
  # opencode reads ~/.claude/CLAUDE.md and ~/.agents/skills natively, so only the
  # config file, command prompts and local plugins need linking. Credentials live in
  # ~/.local/share/opencode/auth.json and are deliberately never synced.
  link_path "$DOTFILES/.config/opencode/opencode.json" "$OPENCODE_DIR/opencode.json"

  local command_file
  for command_file in "$DOTFILES"/.config/opencode/commands/*.md; do
    [ -e "$command_file" ] || continue
    link_path "$command_file" "$OPENCODE_DIR/commands/$(basename "$command_file")"
  done

  # Retire only our legacy link. Preserve independently maintained local plugins.
  local legacy="$OPENCODE_DIR/plugins/opencode-tmux-agent-indicator.js"
  if [ -L "$legacy" ] && [ "$(readlink "$legacy")" = "$DOTFILES/.config/opencode/plugins/opencode-tmux-agent-indicator.js" ]; then
    changed=1
    if [ "$MODE" = check ]; then
      warn "Would retire legacy tmux plugin $legacy"
    else
      backup_existing "$legacy"
      ok "Retired legacy tmux plugin"
    fi
  fi

  local plugin
  for plugin in "$DOTFILES"/.config/opencode/plugins/*.js; do
    [ -e "$plugin" ] || continue
    link_path "$plugin" "$OPENCODE_DIR/plugins/$(basename "$plugin")"
  done
}

sync_herdr() {
  info "Syncing herdr config"
  link_path "$DOTFILES/.config/herdr/config.toml" "$HERDR_DIR/config.toml"
  local f
  for f in project-picker.sh openrouter-picker.sh whichkey.py whichkey.toml; do
    link_path "$DOTFILES/.config/herdr/$f" "$HERDR_DIR/$f"
  done

  [ "$SYNC_HERDR_PLUGINS" = "1" ] || return 0
  local manifest="$DOTFILES/.config/herdr/plugins.txt"
  [ -f "$manifest" ] || return 0
  if ! command -v herdr >/dev/null 2>&1; then
    warn "herdr not on PATH, skipped plugin install"
    return 0
  fi

  # Own plugins live in the repo and are linked, not installed.
  local dir
  for dir in "$DOTFILES"/.config/herdr/plugins/*/; do
    [ -f "$dir/herdr-plugin.toml" ] || continue
    if herdr plugin list 2>/dev/null | grep -q "$(basename "$dir")"; then
      ok "herdr plugin $(basename "$dir") already linked"
    elif [ "$MODE" = "check" ]; then
      changed=1
      warn "Would link herdr plugin $(basename "$dir")"
    elif herdr plugin link "$dir" >/dev/null 2>&1; then
      changed=1
      ok "Linked herdr plugin $(basename "$dir")"
    else
      warn "Failed to link herdr plugin $(basename "$dir")"
    fi
  done

  # Plugins are third-party code fetched from GitHub, so record the sources and
  # install what is missing rather than vendoring their trees into the repo.
  local installed source
  installed="$(herdr plugin list 2>/dev/null || true)"
  while IFS= read -r source; do
    [ -n "$source" ] || continue
    case "$source" in \#*) continue ;; esac
    if printf '%s' "$installed" | grep -q "$source"; then
      ok "herdr plugin $source already installed"
      continue
    fi
    changed=1
    if [ "$MODE" = "check" ]; then
      warn "Would install herdr plugin $source"
    else
      if herdr plugin install "$source" --yes >/dev/null 2>&1; then
        ok "Installed herdr plugin $source"
      else
        warn "Failed to install herdr plugin $source"
      fi
    fi
  done < "$manifest"
}

sync_herdr_integrations() {
  command -v herdr >/dev/null 2>&1 || return 0
  local target installed
  installed="$(herdr integration status 2>/dev/null)"
  for target in claude codex opencode; do
    if [ "$MODE" = "check" ]; then
      if ! printf '%s\n' "$installed" | grep -Eq "^$target: (current|installed)"; then
        changed=1
        warn "Would install native herdr $target integration"
      fi
    elif herdr integration install "$target" >/dev/null; then
      ok "Ensured native herdr $target integration"
    else
      warn "Failed to install native herdr $target integration"
      return 1
    fi
  done
}

sync_claude
sync_opencode
if [ "$SCOPE" != "bootstrap" ]; then
  sync_codex
  if [ "$SCOPE" = "local" ]; then
    SYNC_HERDR_PLUGINS=0
  fi
  sync_herdr
  sync_shell_startup
  sync_rtk_config
  sync_ponytail_config
  sync_shared_skills
fi
if [ "$SCOPE" = "all" ]; then
  sync_herdr_integrations
  sync_project_mcp_wrappers
  sync_playwright_registrations
  sync_ponytail_claude_plugin
  sync_ponytail_codex_plugin
fi

if [ "$MODE" = "check" ] && [ "$changed" -ne 0 ]; then
  warn "Drift detected"
  exit 1
fi

ok "LLM sync complete"
