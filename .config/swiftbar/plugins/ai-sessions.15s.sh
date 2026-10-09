#!/usr/bin/env bash
# <swiftbar.title>AI Sessions</swiftbar.title>
# <swiftbar.version>1.2</swiftbar.version>
# <swiftbar.author>Eric</swiftbar.author>
# <swiftbar.desc>Shows herdr agents needing attention and AI CLI processes so stray sessions are visible.</swiftbar.desc>

set -u

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

HERDR_BIN="$(command -v herdr || true)"
if [ -n "$HERDR_BIN" ]; then
  AGENTS_JSON="$(herdr agent list 2>/dev/null || true)"
  WORKSPACES_JSON="$(herdr workspace list 2>/dev/null || true)"
else
  AGENTS_JSON=""
  WORKSPACES_JSON=""
fi

PS_OUT="$(ps -axo pid=,tty=,etime=,pcpu=,pmem=,command= 2>/dev/null || true)"

export HERDR_BIN AGENTS_JSON WORKSPACES_JSON PS_OUT

python3 - <<'PY'
import json, os, re

STATUS = {"blocked": "🛑", "done": "✅", "working": "⚡", "idle": "💤"}
# Attention order: agents waiting on you first.
RANK = {status: i for i, status in enumerate(STATUS)}
PROC_RE = re.compile(r"(?:^|/)(claude|codex|opencode|herdr)(?: |$)")


def load(name, *path):
    try:
        data = json.loads(os.environ.get(name, ""))
        for key in path:
            data = data[key]
        return data
    except Exception:
        return None


def clip(text, n):
    text = text.replace("|", "-").strip()
    return text if len(text) <= n else text[: n - 1] + "…"


def age(etime):
    # ps etime: [[dd-]hh:]mm:ss
    days, _, rest = etime.rpartition("-")
    parts = [int(p) for p in rest.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    h, m, _ = parts
    h += int(days or 0) * 24
    return f"{h}h{m:02d}m" if h else f"{m}m"


def minutes(etime):
    days, _, rest = etime.rpartition("-")
    parts = [int(p) for p in rest.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    h, m, _ = parts
    return (int(days or 0) * 24 + h) * 60 + m


agents = load("AGENTS_JSON", "result", "agents")
labels = {
    w.get("workspace_id"): w.get("label") or w.get("workspace_id")
    for w in load("WORKSPACES_JSON", "result", "workspaces") or []
}

procs = []
ps_out = os.environ.get("PS_OUT", "")
for line in ps_out.splitlines():
    cols = line.split(None, 5)
    if len(cols) < 6 or "ai-sessions." in cols[5]:
        continue
    match = PROC_RE.search(cols[5])
    if match:
        procs.append((match.group(1), *cols))

# The herdr server always runs without a TTY, so it is not a stray session.
stray = [p for p in procs if p[2] == "??" and p[0] != "herdr"]
long = [p for p in procs if p[0] in ("claude", "codex", "opencode") and minutes(p[3]) >= 120]
counts = {s: sum(1 for a in agents or [] if a.get("agent_status") == s) for s in STATUS}

title = f"🤖 {len(procs)}"
for status in ("blocked", "done", "working"):
    if counts[status]:
        title += f" {STATUS[status]}{counts[status]}"
if stray:
    title += f" 👻{len(stray)}"
if long:
    title += f" ⏳{len(long)}"
print(title)
print("---")
summary = f"🧭 {len(agents or [])} agents · ⚙️ {len(procs)} procs"
if stray:
    summary += f" · 👻 {len(stray)} bg"
if long:
    summary += f" · ⏳ {len(long)} over 2h"
print(f"{summary} | size=12")
print("---")

if agents is None:
    print("⚠️ herdr unavailable")
elif not agents:
    print("💤 No herdr agents")
herdr = os.environ.get("HERDR_BIN") or "herdr"
ordered = sorted(
    agents or [],
    key=lambda a: (RANK.get(a.get("agent_status"), 9), a.get("workspace_id") or ""),
)
for a in ordered:
    icon = STATUS.get(a.get("agent_status"), "❔")
    bits = [a.get("agent") or a.get("name") or "agent"]
    pane_title = a.get("terminal_title_stripped") or ""
    if pane_title:
        bits.append(clip(pane_title, 40))
    ws = a.get("workspace_id")
    if ws:
        bits.append(labels.get(ws, ws))
    line = f"{icon} {' · '.join(bits)}"
    if ws:
        line += f" | bash={herdr} param1=workspace param2=focus param3={ws} terminal=false refresh=true"
    print(line)

print("---")
if not ps_out:
    print("⚙️ Process scan unavailable")
elif not procs:
    print("⚙️ No AI CLI processes")
else:
    print(f"⚙️ Processes ({len(procs)})")
    for name, pid, tty, etime, cpu, mem, cmd in procs:
        icon = "🧩" if name == "herdr" else ("👻" if tty == "??" else "🤖")
        tip = clip(cmd, 300).replace('"', "'")
        print(
            f"--{icon} {name} · {age(etime)} · {cpu}% cpu · {mem}% mem · pid {pid}"
            f' | tooltip="{tip}"'
        )

print("---")
print("🔄 Refresh | refresh=true")
print("📊 Activity Monitor | bash=/usr/bin/open param1=-a param2=Activity\\ Monitor terminal=false")
PY
