#!/usr/bin/env python3
"""Check MCP pin coverage with disposable config and a network-free npm stub."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
FILES = ('install.sh', '.codex/config.toml', '.codex/scripts/check-mcp-package-versions.rb',
         '.codex/scripts/context7-mcp.sh', '.codex/scripts/github-mcp.sh')


class PackagePinTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='mcp-pins-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for relative in FILES:
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / relative, target)
        binary = self.root / 'bin'
        binary.mkdir()
        npm = binary / 'npm'
        npm.write_text('#!/bin/sh\nprintf called >> "$PIN_TEST_CALLS"\nexit 99\n')
        npm.chmod(0o755)
        self.log = self.root / 'npm-calls'
        self.env = dict(os.environ, PATH=str(binary) + os.pathsep + os.environ['PATH'],
                        HOME=str(self.root), PIN_TEST_CALLS=str(self.log))

    def run_check(self, expected=0, args=('--offline',)):
        result = subprocess.run(['ruby', str(self.root / '.codex/scripts/check-mcp-package-versions.rb'), *args],
                                env=self.env, text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        if '--offline' in args:
            self.assertFalse(self.log.exists(), 'offline check invoked npm')
        return result.stdout + result.stderr

    def test_offline_checks_config_installer_and_every_wrapper(self):
        output = self.run_check()
        self.assertIn('@upstash/context7-mcp@4.1.1', output)
        self.assertIn('mcp-remote@0.8.1', output)
        self.assertEqual(output.count('[ok]'), 6)

    def test_unversioned_and_floating_wrapper_pins_fail(self):
        wrapper = self.root / '.codex/scripts/context7-mcp.sh'
        original = wrapper.read_text()
        for replacement in ('@upstash/context7-mcp', '@upstash/context7-mcp@latest',
                            '@upstash/context7-mcp@^4.1.1', '@upstash/context7-mcp@4'):
            with self.subTest(replacement=replacement):
                wrapper.write_text(original.replace('@upstash/context7-mcp@4.1.1', replacement))
                self.assertIn('[floating]', self.run_check(expected=1))

    def test_missing_installer_pin_fails(self):
        installer = self.root / 'install.sh'
        installer.write_text(installer.read_text().replace('PLAYWRIGHT_MCP_VERSION="0.0.76"', ''))
        self.assertIn('[missing]', self.run_check(expected=2))

    def test_online_mode_queries_all_packages_through_fixture_npm(self):
        versions = {'@shopify/dev-mcp': '1.14.0', '@browsermcp/mcp': '0.1.3',
                    'chrome-devtools-mcp': '1.2.0', '@playwright/mcp': '0.0.76',
                    '@upstash/context7-mcp': '4.1.1', 'mcp-remote': '0.8.1'}
        npm = self.root / 'bin/npm'
        npm.write_text('#!/usr/bin/env python3\nimport json,os,sys\n'
                       'with open(os.environ["PIN_TEST_CALLS"],"a") as log: log.write(sys.argv[-2]+"\\n")\n'
                       f'print({versions!r}[sys.argv[-2]])\n')
        self.run_check(args=())
        self.assertEqual(set(self.log.read_text().splitlines()), set(versions))
        self.assertIn('Usage:', self.run_check(expected=2, args=('--unknown',)))


if __name__ == '__main__':
    unittest.main()
