#!/usr/bin/env python3
"""which-key for herdr, like nvim's: prefix+space opens a popup listing the next keys.

One keypress runs an action or opens a group, backspace goes back a level, esc closes.
The menu lives in whichkey.toml next to this file (override with $HERDR_WHICHKEY); see the
header there for the action types. Rendering is fzf: --no-input plus --expect turns a list
into "press a key to pick".

`whichkey.py --check` validates the menu and prints it, without opening anything.
"""
import json
import os
import re
import subprocess
import sys

try:
    import tomllib
except ImportError:  # Python < 3.11 (e.g. macOS's /usr/bin/python3 3.9) has no tomllib
    for py in ("/opt/homebrew/bin/python3.12", "/usr/local/bin/python3.12",
               "/opt/homebrew/opt/python@3.12/libexec/bin/python3",
               "/usr/local/opt/python@3.12/libexec/bin/python3",
               "/opt/homebrew/bin/python3", "/usr/local/bin/python3"):
        if os.access(py, os.X_OK) and os.path.realpath(py) != os.path.realpath(sys.executable):
            os.execv(py, [py, *sys.argv])
    sys.exit("whichkey: needs Python 3.11+ (tomllib)")

HERE = os.path.dirname(os.path.realpath(__file__))
MENU = os.environ.get("HERDR_WHICHKEY") or os.path.join(HERE, "whichkey.toml")
FIELDS = {"group", "label", "send", "run", "wait"}
KEY = re.compile(r"^[A-Za-z0-9]$")
DIM, KEYC, GROUPC, RESET = "\033[2m", "\033[33m", "\033[34m", "\033[0m"


def entries(node):
    """(key, child) pairs in file order, skipping a group's own fields."""
    return [(k, v) for k, v in node.items() if k not in FIELDS and isinstance(v, dict)]


def check(node, path=""):
    problems = []
    for key, child in entries(node):
        where = path + key
        if not KEY.match(key):
            problems.append(f"{where}: keys must be one letter or digit")
        if "group" in child:
            problems += check(child, where + " ")
        elif not ("send" in child) ^ ("run" in child):
            problems.append(f"{where}: an action needs exactly one of send or run")
    return problems


def herdr(*args):
    out = subprocess.run(["herdr", *args], capture_output=True, text=True)
    if out.returncode:
        raise RuntimeError(out.stderr.strip() or out.stdout.strip() or "herdr command failed")
    return json.loads(out.stdout or "{}").get("result") or {}


def context():
    """The pane the popup was opened over. A popup belongs to no pane, so herdr injects no
    HERDR_PANE_ID here; `pane current` is the UI-focused pane underneath it."""
    pane = herdr("pane", "current").get("pane") or {}
    ws = {w["workspace_id"]: w for w in herdr("workspace", "list").get("workspaces", [])}
    return {
        "HK_PANE": pane.get("pane_id", ""),
        "HK_WORKSPACE": pane.get("workspace_id", ""),
        "HK_LABEL": ws.get(pane.get("workspace_id"), {}).get("label", ""),
        "HK_CWD": pane.get("cwd") or os.path.expanduser("~"),
    }


def lazy(ctx, cmd):
    """HK_TASK and HK_DEV_PANE cost extra herdr calls, so only when a command uses them."""
    extra = {}
    if "HK_TASK" in cmd:
        for a in herdr("agent", "list").get("agents", []):
            m = re.fullmatch(r"t(\d+)", a.get("name") or "")
            if m and a.get("workspace_id") == ctx["HK_WORKSPACE"]:
                extra["HK_TASK"] = m.group(1)
    if "HK_DEV_PANE" in cmd:
        for p in herdr("pane", "list", "--workspace", ctx["HK_WORKSPACE"]).get("panes", []):
            procs = herdr("pane", "process-info", "--pane", p["pane_id"]).get("process_info", {})
            lines = " ".join(f.get("cmdline") or "" for f in procs.get("foreground_processes", []))
            if re.search(r"theme dev|run (dev|start)|\bvite\b|next dev", lines):
                extra["HK_DEV_PANE"] = p["pane_id"]
                break
    return extra


def pick(node, title):
    """Show one level; return the chosen key, "back", or None for esc."""
    items = entries(node)
    lines = [f"{KEYC}{k}{RESET} {DIM}→{RESET} "
             + (f"{GROUPC}+{c['group']}{RESET}" if "group" in c else c.get("label", k))
             for k, c in items]
    keys = [k for k, _ in items]
    proc = subprocess.run(
        ["fzf", "--ansi", "--no-input", "--no-sort", "--layout=reverse", "--info=hidden",
         "--border=rounded", f"--border-label= {title} ", "--pointer= ", "--no-scrollbar",
         "--header=esc close · ⌫ back · enter picks the highlighted row",
         "--expect=" + ",".join(keys + ["bspace"])],
        input="\n".join(lines), capture_output=True, text=True)
    if proc.returncode not in (0, 1):
        return None  # esc / ctrl-c
    pressed, _, row = proc.stdout.partition("\n")
    if pressed == "bspace":
        return "back"
    if pressed in keys:
        return pressed
    m = re.match(r"(?:\x1b\[[0-9;]*m)*(\S)", row)  # enter on a row: its key is the first char
    return m.group(1) if m else None


def act(action, ctx):
    if "send" in action:
        text, pane = action["send"], ctx["HK_PANE"]
        has_agent = subprocess.run(["herdr", "agent", "get", pane], capture_output=True).returncode == 0
        verb = ["agent", "prompt", pane, text] if has_agent else ["pane", "run", pane, text]
        out = subprocess.run(["herdr", *verb], capture_output=True, text=True)
        if out.returncode:
            raise RuntimeError(out.stderr.strip() or out.stdout.strip() or "prompt rejected")
        return
    cmd = action["run"]
    env = {**os.environ, **ctx, **lazy(ctx, cmd)}
    out = subprocess.run(cmd, shell=True, executable="/bin/bash", cwd=ctx["HK_CWD"], env=env)
    if out.returncode:
        raise RuntimeError(f"command exited {out.returncode}: {cmd}")
    if action.get("wait"):
        print(f"\n{DIM}any key to close{RESET}", end="", flush=True)
        anykey()


def anykey():
    """One raw keypress, esc included: input() would need enter and echo ^[ for esc."""
    import termios, tty
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        os.read(fd, 16)
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)


def main():
    with open(MENU, "rb") as f:
        menu = tomllib.load(f)
    problems = check(menu)
    if "--check" in sys.argv:
        def show(node, depth=0):
            for k, c in entries(node):
                print("  " * depth + f"{k}  " + (f"+{c['group']}" if "group" in c else c.get("label", "")))
                if "group" in c:
                    show(c, depth + 1)
        show(menu)
        print("\n".join(problems) or "ok")
        sys.exit(1 if problems else 0)
    if problems:
        sys.exit("whichkey.toml: " + "; ".join(problems))
    ctx, stack = context(), [(menu, "herdr")]
    while stack:
        node, title = stack[-1]
        key = pick(node, title)
        if key is None:
            return
        if key == "back":
            stack.pop()
            continue
        child = dict(entries(node))[key]
        if "group" in child:
            stack.append((child, f"{title} › {child['group']}"))
        else:
            return act(child, ctx)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError) as error:
        print(f"whichkey: {error}", file=sys.stderr)
        if sys.stdin.isatty():
            input("Press Enter to close.")
        sys.exit(1)
