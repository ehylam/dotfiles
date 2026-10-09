#!/usr/bin/env python3
"""Fold Codex-written state from the live ~/.codex/config.toml into a fresh render.

usage: merge-codex-config.py <rendered> <live>   (rewrites <rendered> in place)

Codex writes to its own config: /model picks, project trust, hook trust hashes
([hooks.state.*]), NUX counters. Overwriting the file with the dotfiles render threw
all of that away (Codex re-asked to trust every hook, the model reverted). Rules:
  - CODEX_OWNED top-level keys: the live value wins (Codex's /model is their editor)
  - any key or table present live but absent from the render: kept
  - everything else: the dotfiles render wins

Retire a managed MCP with enabled=false in its source table. Removing the table
does not retire it: the live-only table is deliberately preserved as local state.

ponytail: line-based, not a TOML round-trip, so comments and order survive. Assumes
single-line values, which is all Codex writes; a multi-line value in the live file is
left out rather than half-copied.
"""
import re
import sys

CODEX_OWNED = {"model", "model_reasoning_effort", "service_tier"}
HEADER = re.compile(r"^\s*\[\[?\s*(.+?)\s*\]\]?\s*(#.*)?$")
KEY = re.compile(r'^\s*("[^"]+"|[A-Za-z0-9_.-]+)\s*=')


def sections(lines):
    """[(header or "", [lines])] in file order; "" is the top-level table."""
    out = [("", [])]
    for line in lines:
        m = HEADER.match(line)
        if m:
            out.append((m.group(1), [line]))
        else:
            out[-1][1].append(line)
    return out


def keys(body):
    return {m.group(1): i for i, line in enumerate(body) if (m := KEY.match(line))}


def complete(line):
    v = line.split("=", 1)[1]
    return v.count("[") == v.count("]") and v.count('"""') == 0


def family(header):
    """`projects` for [projects."/x"], `hooks` for [hooks.state."..."]."""
    return re.split(r'\.(?=(?:[^"]*"[^"]*")*[^"]*$)', header, maxsplit=1)[0]


def merge(rendered, live):
    ren, liv = sections(rendered), sections(live)

    # Trailing comments close the file (Codex inserts new tables above them), so park
    # them and re-attach after any appended tables.
    last = ren[-1][1]
    cut = len(last)
    while cut > 1 and last[cut - 1].lstrip().startswith("#"):
        cut -= 1
    tail, ren[-1] = last[cut:], (ren[-1][0], last[:cut])

    for header, body in liv:
        ren_idx = {h: i for i, (h, _) in enumerate(ren)}
        if header not in ren_idx:
            # Whole Codex-written table: next to its siblings ([projects.*]), else at the end.
            sib = [i for i, (h, _) in enumerate(ren) if h and family(h) == family(header)]
            ren.insert(sib[-1] + 1 if sib else len(ren), (header, body))
            continue
        target = ren[ren_idx[header]][1]
        have = keys(target)
        for k, i in keys(body).items():
            line = body[i]
            if not complete(line):
                continue
            if k not in have:
                insert = len(target)
                while insert and not target[insert - 1].strip():
                    insert -= 1  # before the blank lines that separate tables
                target.insert(insert, line)
            elif header == "" and k in CODEX_OWNED:
                target[have[k]] = line
    merged = [line for _, body in ren for line in body]
    if tail and merged[-len(tail):] == tail:
        tail = []  # a copied live table already carries the closing comment
    return merged + tail


if __name__ == "__main__":
    rendered_path, live_path = sys.argv[1], sys.argv[2]
    with open(rendered_path) as f:
        rendered = f.read().splitlines()
    try:
        with open(live_path) as f:
            live = f.read().splitlines()
    except OSError:
        sys.exit(0)
    with open(rendered_path, "w") as f:
        f.write("\n".join(merge(rendered, live)) + "\n")
