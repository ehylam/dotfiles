#!/usr/bin/env bash
# <swiftbar.title>Sleep Toggle</swiftbar.title>
# <swiftbar.version>1.0</swiftbar.version>
# <swiftbar.author>Eric</swiftbar.author>
# <swiftbar.desc>Toggles caffeinate -dimsu from the menu bar.</swiftbar.desc>

set -u

PATH="/usr/bin:/bin:/usr/sbin:/sbin"
pid_file="${TMPDIR:-/tmp}/swiftbar-caffeinate.pid"
script_path="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

running() {
  [ -s "$pid_file" ] || return 1
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  [ -n "${pid:-}" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  ps -p "$pid" -o comm= 2>/dev/null | grep -q 'caffeinate'
}

case "${1:-}" in
  toggle)
    if running; then
      kill "$(cat "$pid_file")" 2>/dev/null || true
      rm -f "$pid_file"
    else
      /usr/bin/nohup /usr/bin/caffeinate -dimsu >/dev/null 2>&1 &
      printf '%s\n' "$!" > "$pid_file"
    fi
    exit 0
    ;;
esac

if running; then
  pid="$(cat "$pid_file")"
  echo "☕️"
  echo "---"
  echo "Stop caffeinate | bash=$script_path param1=toggle terminal=false refresh=true"
  echo "PID: $pid"
else
  rm -f "$pid_file"
  echo "🌙"
  echo "---"
  echo "Start caffeinate | bash=$script_path param1=toggle terminal=false refresh=true"
fi

echo "---"
echo "Command: caffeinate -dimsu"
