#!/usr/bin/env python3
"""Check iOS device routing without booting a real simulator. Pass the CLI path."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import uuid

if len(sys.argv) != 2:
    sys.exit("Usage: check-agent-browser-ios.py /path/to/agent-browser")
binary = str(Path(sys.argv[1]).resolve())
owned = "11111111-1111-1111-1111-111111111111"
user = "22222222-2222-2222-2222-222222222222"
devices = {"devices": {"runtime": [
    {"name": "iPhone 17 Pro", "udid": user, "state": "Shutdown"},
    {"name": "owned_qa_device", "udid": owned, "state": "Shutdown"},
]}}
failed = False
with tempfile.TemporaryDirectory(prefix="ab-ios-routing-") as folder:
    root = Path(folder)
    (root / "config.json").write_text("{}\n")
    fake = root / "xcrun"
    fake.write_text("#!/usr/bin/env python3\nimport json,sys\n"
        "if sys.argv[1:4]==['simctl','list','devices']:\n"
        f" print(json.dumps({devices!r}))\n"
        "elif sys.argv[1:3]==['simctl','boot']:\n"
        " print('ROUTING_CHECK_STOP: selected '+sys.argv[3],file=sys.stderr);sys.exit(1)\n"
        "elif sys.argv[1:3]==['xctrace','list']: print('== Devices ==\\n== Simulators ==')\n"
        "else: sys.exit(1)\n")
    fake.chmod(0o700)
    cases = [("--device", ["--device", "owned_qa_device"], {}),
             ("AGENT_BROWSER_IOS_DEVICE", [], {"AGENT_BROWSER_IOS_DEVICE": "owned_qa_device"}),
             ("AGENT_BROWSER_IOS_UDID", [], {"AGENT_BROWSER_IOS_UDID": owned})]
    for label, flags, settings in cases:
        env = {k: v for k, v in os.environ.items() if not k.startswith("AGENT_BROWSER_")}
        env.update(PATH=str(root) + os.pathsep + env["PATH"],
                   AGENT_BROWSER_NAMESPACE="routing-check-" + uuid.uuid4().hex,
                   AGENT_BROWSER_IDLE_TIMEOUT_MS="1000", **settings)
        result = subprocess.run([binary, "--config", str(root / "config.json"),
            "--json", "--provider", "ios", "--session", "routing-check", *flags,
            "open", "http://127.0.0.1/"], cwd=root, env=env,
            capture_output=True, text=True, timeout=15)
        response = json.loads(result.stdout)
        passed = result.returncode != 0 and "ROUTING_CHECK_STOP: selected " + owned in response.get("error", "")
        print(f"{'PASS' if passed else 'FAIL'}: {label}")
        failed |= not passed
        time.sleep(1.2)  # Let the owned daemon exit before removing its fake xcrun.
sys.exit(int(failed))
