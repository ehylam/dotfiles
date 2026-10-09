#!/usr/bin/env python3
"""Exercise real notebook CLI/worktrees using fixtures, with no client or remote access."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('project-brain.py')


class ProjectBrainTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='project-brain-')
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.root = self.folder / 'client'
        self.root.mkdir()
        self.store = self.folder / 'private'
        self.env = dict(os.environ, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null',
                        GIT_AUTHOR_NAME='Fixture', GIT_AUTHOR_EMAIL='fixture@example.invalid',
                        GIT_COMMITTER_NAME='Fixture', GIT_COMMITTER_EMAIL='fixture@example.invalid')
        self.package = self.root / 'package.json'
        self.package.write_text(json.dumps({'packageManager': 'pnpm@10.0.0',
                                          'scripts': {'dev': 'vite', 'pull:dev': 'echo fixture'}}))

    def cli(self, *args, project=None, status=0):
        result = subprocess.run([sys.executable, '-B', str(SCRIPT), '--store', str(self.store),
                                 '--project', str(project or self.root), *args],
                                env=self.env, text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, status, result.stdout + result.stderr)
        return result.stdout + result.stderr

    def remember(self, command='pnpm run dev', **extra):
        args = ['remember', '--kind', 'dev', '--name', 'local', '--environment', 'development',
                '--command', command]
        if extra.pop('verified', False):
            args += ['--verified', '--evidence', 'Fixture script completed at recorded revision']
        return self.cli(*args, **extra)

    def test_read_only_discovery_and_no_automatic_execution(self):
        before = {p.name: p.read_bytes() for p in self.root.iterdir()}
        self.assertIn('pnpm run dev', self.cli('scan'))
        self.assertIn('No project procedures', self.cli('show'))
        self.assertFalse(self.store.exists())
        marker = self.root / 'must-not-execute'
        self.remember(f'touch {marker}')
        self.assertFalse(marker.exists())
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.root.iterdir()})

    def test_history_latest_environment_and_config_staleness(self):
        self.remember(verified=True)
        self.remember('pnpm run dev:updated')
        self.cli('remember', '--kind', 'pull', '--environment', 'production',
                 '--command', 'pnpm run pull:production')
        current = json.loads(self.cli('show', '--environment', 'development', '--json'))
        self.assertEqual(len(current['entries']), 1)
        self.assertEqual(current['entries'][0]['command'], 'pnpm run dev:updated')
        self.assertFalse(current['entries'][0]['config_changed'])
        history = json.loads(self.cli('history', '--json'))['entries']
        self.assertEqual(len(history), 3)
        self.assertEqual(history[0]['verification'], 'verified')
        self.remember('pnpm run dev:newest')
        newest = json.loads(self.cli('show', '--limit', '1', '--json'))['entries']
        self.assertEqual(newest[0]['command'], 'pnpm run dev:newest')
        self.package.write_text('{"scripts":{"dev":"changed"}}')
        self.assertTrue(json.loads(self.cli('show', '--json'))['entries'][0]['config_changed'])
        self.assertEqual(self.store.stat().st_mode & 0o777, 0o700)
        self.assertTrue(all(p.stat().st_mode & 0o777 == 0o600 for p in self.store.iterdir()))

    def test_verified_requires_evidence_and_secrets_are_refused(self):
        self.cli('remember', '--kind', 'dev', '--environment', 'development',
                 '--command', 'pnpm run dev', '--verified', status=1)
        for command in ('TOKEN=synthetic-value npm run dev', 'shopify --password synthetic-value',
                        'Authorization: Bearer fake', 'https://store.test/?token=fake'):
            self.remember(command, status=1)
        self.assertFalse(self.store.exists())
        self.remember('env -u SHOPIFY_CLI_THEME_TOKEN -u SHOPIFY_FLAG_STORE pnpm run dev')

    def test_worktrees_share_records_and_other_clones_do_not(self):
        def git(*args):
            subprocess.run(['git', '-C', str(self.root), *args], env=self.env,
                           check=True, capture_output=True)
        git('init', '-q', '-b', 'main')
        git('add', 'package.json')
        git('commit', '-qm', 'fixture')
        linked = self.folder / 'task-worktree'
        git('worktree', 'add', '-qb', 'task', str(linked))
        self.remember(verified=True)
        self.assertIn('pnpm run dev', self.cli('show', project=linked))
        self.assertFalse(json.loads(self.cli('show', '--json', project=linked))['entries'][0]['config_changed'])
        other = self.folder / 'other'
        subprocess.run(['git', 'clone', '-q', str(self.root), str(other)], env=self.env,
                       check=True, capture_output=True)
        self.assertIn('No project procedures', self.cli('show', project=other))

    def test_store_and_tracked_workspace_script_changes_mark_stale(self):
        subprocess.run(['git', '-C', str(self.root), 'init', '-q'], env=self.env,
                       check=True, capture_output=True)
        nested = self.root / 'packages/theme/package.json'
        nested.parent.mkdir(parents=True)
        nested.write_text('{"scripts":{"dev":"fixture dev"}}')
        marker = self.root / '.shopify-store'
        marker.write_text('staging-store')
        subprocess.run(['git', '-C', str(self.root), 'add', '.'], env=self.env,
                       check=True, capture_output=True)
        self.remember(verified=True)
        marker.write_text('production-store')
        self.assertTrue(json.loads(self.cli('show', '--json'))['entries'][0]['config_changed'])
        self.remember(verified=True)
        nested.write_text('{"scripts":{"dev":"different fixture dev"}}')
        self.assertTrue(json.loads(self.cli('show', '--json'))['entries'][0]['config_changed'])

    def test_nested_packages_and_environment_files_are_not_read(self):
        child = self.root / 'packages/theme'
        child.mkdir(parents=True)
        (child / 'package.json').write_text('{"scripts":{"dev":"echo nested"}}')
        self.assertIn('echo nested', self.cli('scan', '--directory', 'packages/theme'))
        self.cli('scan', '--directory', '../', status=1)
        self.package.unlink()
        forbidden = self.root / '.env.fixture'
        forbidden.write_text('synthetic-test-only')
        self.package.symlink_to(forbidden.name)
        self.assertIn('environment file', self.cli('scan', status=1))

    def test_parallel_records_are_not_lost(self):
        command = [sys.executable, '-B', str(SCRIPT), '--store', str(self.store),
                   '--project', str(self.root), 'remember', '--kind', 'gotcha',
                   '--environment', 'development', '--note', 'Fixture note']
        workers = [subprocess.Popen(command + ['--name', str(i)], env=self.env,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE) for i in range(6)]
        for worker in workers:
            out, error = worker.communicate(timeout=10)
            self.assertEqual(worker.returncode, 0, out + error)
        self.assertEqual(len(json.loads(self.cli('history', '--json'))['entries']), 6)

    def test_private_records_are_ignored_by_git(self):
        subprocess.run(['git', '-C', str(self.root), 'init', '-q'], env=self.env,
                       check=True, capture_output=True)
        ignore = SCRIPT.resolve().parents[2] / '.gitignore'
        (self.root / '.gitignore').write_bytes(ignore.read_bytes())
        result = subprocess.run(['git', '-C', str(self.root), 'check-ignore',
                                 '.local/project-brain/client.json', '.playwright-mcp/snapshot.png'],
                                env=self.env, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(result.stdout.splitlines()), 2)


if __name__ == '__main__':
    unittest.main()
