#!/usr/bin/env python3
"""Run capture against a temporary store; no model or live hook execution."""
import json
import os
import stat
import shutil
from pathlib import Path
import subprocess
import tempfile

SCRIPTS = Path(__file__).resolve().parent

with tempfile.TemporaryDirectory(prefix="memory-capture-") as directory:
    work = Path(directory).resolve()
    store = work / "store"
    env = dict(os.environ, CLAUDE_MEM_DIR=str(store))

    def records():
        return [json.loads(line) for path in store.glob("*.jsonl")
                for line in path.read_text().splitlines()]

    def capture(payload, mode="tool"):
        before = len(records())
        result = subprocess.run(["bash", str(SCRIPTS / "mem-capture.sh"), mode],
                                input=json.dumps(payload), text=True, cwd=work,
                                env=env, capture_output=True, timeout=10)
        assert result.returncode == 0, result.stderr
        assert len(records()) == before + 1
        return records()[-1]

    def event(tool="Read", response=None, **extra):
        return dict(session_id="isolated", hook_event_name="PostToolUse", tool_name=tool,
                    tool_input={"file_path": str(work / "example.txt")},
                    tool_response=response, **extra)

    record = capture(event(response="read text"))
    assert (record["classification"], record["status"], record["error"]) == ("discovery", "success", False)
    assert record["files"] == ["example.txt"]
    assert stat.S_IMODE(store.stat().st_mode) == 0o700
    assert all(stat.S_IMODE(path.stat().st_mode) == 0o600 for path in store.glob("*.jsonl"))

    # PostToolUse runs after the write, so both new and existing files now exist.
    path = work / "example.txt"
    path.write_text("new file")
    record = capture(event("Write", {"type": "create", "filePath": str(path)}))
    assert record["classification"] == "create"
    path.write_text("existing file updated")
    for tool, response in [("Write", {"type": "update"}), ("Write", None),
                           ("Edit", {"type": "create"}), ("NotebookEdit", {})]:
        assert capture(event(tool, response))["classification"] == "change"
    path.unlink()
    assert capture(event("Write", {}))["classification"] == "change"

    failure = event("Bash")
    failure.update(hook_event_name="PostToolUseFailure", tool_input={"command": "npm test"},
                   error="Exit code 1\nsecret-failure-text", is_interrupt=False,
                   tool_response={"exit_code": 1})
    record = capture(failure)
    assert record["classification"] == "blocker" and record["status"] == "error"
    assert record["error"] and not record["interrupted"]
    assert record["command_category"] == "npm" and record["exit_code"] == 1
    assert "failure_reason" not in record and "detail" not in record
    failure.update(error="Tool aborted", is_interrupt=True)
    record = capture(failure)
    assert record["status"] == "interrupted" and record["interrupted"] and record["error"]
    assert "failure_reason" not in record
    assert capture(event("Write", {"is_error": True, "message": "write failed", "type": "create"}))["classification"] == "blocker"
    assert capture(event(error="Legacy failure"))["status"] == "error"
    assert capture(event(is_interrupt=True))["status"] == "interrupted"
    bare = event("Bash")
    bare["hook_event_name"] = "PostToolUseFailure"
    assert capture(bare)["status"] == "error"
    web = event("WebFetch")
    web["tool_input"] = {"url": "https://example.test/?token=secret-url"}
    assert "secret-url" not in json.dumps(capture(web))
    secret = event("Bash")
    secret["tool_input"] = {"command": "curl -H 'Authorization: Bearer secret-command' https://example.test/?token=secret-query",
                            "prompt": "secret-prompt", "pattern": "secret-pattern"}
    secret["tool_response"] = {"message": "secret-response", "exit_code": 0}
    record = capture(secret)
    assert record["command_category"] == "curl" and record["exit_code"] == 0
    assert "secret-" not in json.dumps(record)
    secret["tool_input"] = {"command": "TOKEN=secret-assignment npm test"}
    assert capture(secret)["command_category"] == "other"
    outside = event()
    outside["tool_input"] = {"file_path": "/private/example.txt"}
    assert capture(outside)["files"] == []
    assert capture({"session_id": "isolated", "reason": "secret-reason"}, "session")["reason"] == "other"
    assert capture({"session_id": "isolated", "reason": "logout"}, "session")["kind"] == "session_end"

    before = len(records())
    for payload in ["not JSON", "[]", 'null', '42',
                    '{"tool_name":"Bash","tool_input":{"command":"mem-query --raw"}}',
                    '{"tool_name":"Bash","tool_input":{"command":"bash mem-capture.sh"}}']:
        result = subprocess.run(["bash", str(SCRIPTS / "mem-capture.sh")], input=payload,
                                text=True, cwd=work, env=env, capture_output=True, timeout=10)
        assert result.returncode == 0
    assert len(records()) == before

    binary = work / 'bin'
    binary.mkdir()
    jq = binary / 'jq'
    jq.write_text('#!/bin/sh\nprintf "call\\n" >> "$JQ_CALL_LOG"\nexec "' + shutil.which('jq') + '" "$@"\n')
    jq.chmod(0o700)
    calls = work / 'jq-calls'
    env.update(PATH=str(binary) + os.pathsep + os.environ['PATH'], JQ_CALL_LOG=str(calls))
    capture(event())
    assert calls.read_text().splitlines() == ['call'], 'Capture should parse each event once'

settings = json.loads((SCRIPTS.parent / "settings.json").read_text())
for event_name in ["PostToolUse", "PostToolUseFailure"]:
    captures = [hook for group in settings["hooks"][event_name] for hook in group["hooks"]
                if "mem-capture.sh tool" in hook.get("command", "")]
    assert len(captures) == 1 and captures[0]["async"] is True and captures[0]["timeout"] == 10
print("PASS: capture metadata, secret omission, private permissions, classifications, failures and hook wiring")
