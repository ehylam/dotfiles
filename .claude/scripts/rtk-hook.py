#!/usr/bin/env python3
"""Preserve native grep flag semantics before delegating other rewrites to RTK."""
import json
import os
import subprocess
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from shellcmd import commands


def main():
    raw = sys.stdin.read()
    try:
        hook = json.loads(raw)
        command = (hook.get('tool_input') or {}).get('command', '')
        if any(c.argv[0] == 'grep' and any(a.startswith('-') for a in c.argv[1:])
               for c in commands(command, hook.get('cwd'))):
            return 0
        result = subprocess.run(['rtk', 'hook', 'claude'], input=raw, text=True,
                                capture_output=True, timeout=4)
        if result.returncode == 0:
            sys.stdout.write(result.stdout)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        pass
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
