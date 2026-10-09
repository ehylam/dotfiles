#!/usr/bin/env python3
"""Check the hook without touching real browsers, processes or profiles."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest


SCRIPT = Path(__file__).with_name("playwright-cleanup.sh")


class CleanupHookTests(unittest.TestCase):
    def test_only_finished_artifact_helper_is_invoked(self):
        with tempfile.TemporaryDirectory(prefix="browser-hook-test-") as temporary:
            root = Path(temporary)
            bins = root / "bin"
            bins.mkdir()
            profile = root / "Library/Caches/ms-playwright/mcp-user-session"
            profile.mkdir(parents=True)
            state = profile / "saved-login"
            state.write_text("private fixture")
            old = time.time() - 30 * 86400
            os.utime(state, (old, old))
            for directory in (profile, profile.parent, profile.parent.parent, profile.parent.parent.parent):
                os.utime(directory, (old, old))
            log = root / "calls.jsonl"
            fake = f"#!{sys.executable}\n" + '''import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
with open(os.environ["CALL_LOG"], "a") as stream:
    stream.write(json.dumps({"name": name, "args": sys.argv[1:]}) + "\\n")
if name == "ps":
    print("999999 1 chrome-headless-shell --user-data-dir=ms-playwright/mcp-other")
sys.exit(int(os.environ.get("HELPER_EXIT", "0")) if name == "python3" else 1)
'''
            for name in ("python3", "ps", "pgrep", "rm", "kill", "killall", "pkill"):
                path = bins / name
                path.write_text(fake)
                path.chmod(0o700)
            startup = root / "startup.sh"
            startup.write_text('kill() { printf "unsafe kill\\n" >&2; return 99; }\n')
            for dry, days, helper_exit in ((False, "14", "0"), (True, "14", "0"),
                                          (False, "invalid", "1"), (False, "14", "1")):
                with self.subTest(dry=dry, days=days, helper_exit=helper_exit):
                    log.unlink(missing_ok=True)
                    env = {**os.environ, "HOME": str(root), "PATH": str(bins) + ":/usr/bin:/bin",
                           "CALL_LOG": str(log), "BASH_ENV": str(startup),
                           "PLAYWRIGHT_PRUNE_DAYS": days, "HELPER_EXIT": helper_exit}
                    env.pop("DRY_RUN", None)
                    if dry:
                        env["DRY_RUN"] = "1"
                    result = subprocess.run(["/bin/bash", str(SCRIPT)], input="{}\n", env=env,
                                            capture_output=True, text=True, timeout=5)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(result.stderr, "")
                    calls = [json.loads(line) for line in log.read_text().splitlines()]
                    self.assertEqual(calls, [{"name": "python3", "args": [
                        str(SCRIPT.with_name("browser-artifact-cleanup.py")), "--days", days,
                        *(["--dry-run"] if dry else [])]}])
                    self.assertEqual(state.read_text(), "private fixture")


if __name__ == "__main__":
    unittest.main()
