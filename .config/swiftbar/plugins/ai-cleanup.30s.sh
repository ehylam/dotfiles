#!/usr/bin/env bash
# <swiftbar.title>AI Cleanup</swiftbar.title>
# <swiftbar.version>1.0</swiftbar.version>
# <swiftbar.author>Eric</swiftbar.author>
# <swiftbar.desc>Manual cleanup actions for browser and sleep helpers.</swiftbar.desc>

set -u

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
sleep_pid_file="${TMPDIR:-/tmp}/swiftbar-caffeinate.pid"
playwright_cleanup="$HOME/.dotfiles/.claude/scripts/playwright-cleanup.sh"

caffeinate_state="off"
if [ -s "$sleep_pid_file" ]; then
  pid="$(cat "$sleep_pid_file" 2>/dev/null || true)"
  if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
    caffeinate_state="on"
  fi
fi

driver_count="$(ps -axo comm= 2>/dev/null | grep -Ec '(^|/)safaridriver$' || true)"

if [ "$driver_count" -gt 0 ]; then
  echo "🧹 ${driver_count}"
else
  echo "🧹"
fi
echo "---"
echo "Caffeinate: ${caffeinate_state}"
echo "SafariDriver processes: ${driver_count}"
echo "---"
echo "Run Playwright cleanup | bash=$playwright_cleanup terminal=true refresh=true"
echo "Open Activity Monitor | bash=/usr/bin/open param1=-a param2=Activity\\ Monitor terminal=false"
echo "Open herdr | bash=/usr/bin/open param1=-a param2=Ghostty terminal=false"
echo "---"
echo "No automatic kills here. Inspect first."
