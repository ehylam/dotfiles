#!/usr/bin/env python3
"""Query temporary metadata fixtures; never read the live memory store."""
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import subprocess
import tempfile

SCRIPT = Path(__file__).resolve().parent / "mem-query.sh"

with tempfile.TemporaryDirectory(prefix="memory-query-") as directory:
    work = Path(directory)
    store = work / "store with spaces"
    store.mkdir()
    env = dict(os.environ, CLAUDE_MEM_DIR=str(store))

    def query(*args):
        return subprocess.run(["bash", str(SCRIPT), *args], text=True,
                              cwd=work, env=env, capture_output=True, timeout=10)

    def ts(days=0, minutes=0):
        return (datetime.now(timezone.utc) - timedelta(days=days, minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%SZ")

    def row(repo, minutes, **extra):
        return dict(ts=ts(minutes=minutes), kind="tool", session_id="shared-session",
                    repo=repo, branch="fix/cart", classification="discovery",
                    tool="Read", files=["sections/cart.liquid"], **extra)

    assert "no records yet" in query("--all-repos").stdout
    records = [row("beta", 1), row("alpha", 5), row("alpha", 2)]
    failure = row("alpha", 3)
    failure.update(classification="blocker", status="error", tool="Bash", exit_code=1,
                   command_category="npm", detail="secret-command", failure_reason="secret-error",
                   reason="secret-reason", cwd="secret-cwd")
    records.append(failure)
    old = row("alpha", 0)
    old["ts"] = ts(days=90)
    records.append(old)
    (store / "2026-01.jsonl").write_text("\n".join(json.dumps(r) for r in records) + "\n")
    (store / "2026-02.jsonl").write_text('broken partial row\n[]\n{"ts":null}\n{"ts":"bad-date"}\n')
    result = query("--all-repos", "--raw")
    assert result.returncode == 0, result.stderr
    rows = [json.loads(line) for line in result.stdout.splitlines()]
    assert len(rows) == 4 and [r["ts"] for r in rows] == sorted(r["ts"] for r in rows)
    assert "secret-" not in result.stdout
    result = query("--repo", "alpha", "--class", "blocker", "--raw")
    assert len(result.stdout.splitlines()) == 1 and json.loads(result.stdout)["exit_code"] == 1
    assert "records: 4" in query("--all-repos").stdout
    assert "exit=1" in query("--all-repos").stdout
    sessions = query("--all-repos", "--sessions")
    assert sessions.returncode == 0, sessions.stderr
    lines = sessions.stdout.splitlines()
    assert len(lines) == 2 and "alpha\t3 calls" in lines[0] and "beta\t1 calls" in lines[1]
    assert ts(minutes=5)[:10] in lines[0]
    alpha = [r['ts'] for r in records if r['repo'] == 'alpha' and r is not old]
    assert lines[0].endswith(min(alpha) + ' -> ' + max(alpha)), lines[0]
    assert "4 sections/cart.liquid" in query("--all-repos", "--files").stdout
    assert len(query("--all-repos", "--grep", "CART.LIQUID", "--raw").stdout.splitlines()) == 4
    assert "no records matching" in query("--all-repos", "--grep", "secret-command").stdout
    for args in [("--days",), ("--repo",), ("--class",), ("--grep",),
                 ("--days", "--raw"), ("--days", "-1"), ("--days", "abc"),
                 ("--days", "999999"), ("--class", "wrong"), ("--unknown",)]:
        result = query(*args)
        assert result.returncode == 1 and result.stderr, (args, result)
    assert query("--all-repos", "--days", "00007", "--raw").returncode == 0

print("PASS: query filters, legacy secret omission, corrupt rows, spaces, ordering, session grouping and option validation")
