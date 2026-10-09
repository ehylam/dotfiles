#!/usr/bin/env python3
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('rtk-hook.py')


class RtkHookTests(unittest.TestCase):
    def test_flagged_grep_stays_native_and_other_commands_reach_rtk(self):
        with tempfile.TemporaryDirectory(prefix='rtk-hook-') as td:
            root = Path(td)
            stub = root / 'rtk'
            stub.write_text('#!/bin/sh\nprintf \'{"rewrite":"fixture"}\'\n')
            stub.chmod(0o755)
            env = dict(os.environ, PATH=f'{root}:{os.environ["PATH"]}')
            for command, rewritten in [('grep -h pattern file', False),
                                       ('grep --no-filename pattern file', False),
                                       ('cat file | grep -h pattern', False),
                                       ('rg pattern .', True), ('git status', True)]:
                with self.subTest(command=command):
                    result = subprocess.run(['python3', str(SCRIPT)], env=env,
                        input=json.dumps({'tool_input': {'command': command}}),
                        capture_output=True, text=True, timeout=5)
                    self.assertEqual(result.returncode, 0)
                    self.assertEqual(bool(result.stdout), rewritten)


if __name__ == '__main__':
    unittest.main()
