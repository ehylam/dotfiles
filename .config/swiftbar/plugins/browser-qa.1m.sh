#!/usr/bin/env bash
# <swiftbar.title>Browser QA</swiftbar.title>
# <swiftbar.version>1.0</swiftbar.version>
# <swiftbar.author>Eric</swiftbar.author>
# <swiftbar.desc>Shows native Safari/iOS QA readiness.</swiftbar.desc>

set -u

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
preflight="$HOME/.dotfiles/.claude/scripts/apple-browser-qa.mjs"
# fnm's default Node first (the agents' pinned version), then whatever is on PATH.
node_bin="$HOME/.local/share/fnm/aliases/default/bin/node"
[ -x "$node_bin" ] || node_bin="$(command -v node || true)"

dev_dir="$(/usr/bin/xcode-select -p 2>/dev/null || true)"
has_simctl="$(/usr/bin/xcrun -find simctl 2>/dev/null || true)"
driver_count="$(ps -axo comm= 2>/dev/null | grep -Ec '(^|/)safaridriver$' || true)"

if [ -n "$has_simctl" ]; then
  runtime_count="$(/usr/bin/xcrun simctl list runtimes --json 2>/dev/null | python3 -c 'import json,sys
try:
 data=json.load(sys.stdin); print(sum(1 for r in data.get("runtimes",[]) if r.get("isAvailable") and r.get("platform")=="iOS"))
except Exception:
 print(0)'
)"
else
  runtime_count=0
fi

if [ -z "$dev_dir" ]; then
  echo "🧪 ⚠️"
elif [ -z "$has_simctl" ]; then
  echo "🧪 ⚠️"
else
  echo "🧪 ${runtime_count}"
fi

echo "---"
echo "Developer dir: ${dev_dir:-missing}"
echo "simctl: $([ -n "$has_simctl" ] && echo yes || echo no)"
echo "iOS runtimes: ${runtime_count}"
echo "SafariDriver processes: ${driver_count}"
echo "---"
echo "Run preflight | bash=$node_bin param1=$preflight param2=preflight terminal=true refresh=true"
echo "Run Safari fixture | bash=$node_bin param1=$preflight param2=test param3=--browser param4=safari terminal=true refresh=true"
echo "Open Safari Developer Settings | bash=/usr/bin/open param1=x-apple.systempreferences:com.apple.Safari-Settings.extension terminal=false"
echo "Open Xcode Platforms | bash=/usr/bin/open param1=-a param2=Xcode terminal=false"
echo "---"
echo "Refresh | refresh=true"
