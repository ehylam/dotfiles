#!/usr/bin/env python3
"""Exercise only browser-registration sync against disposable config files."""
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / '.agents/skills/sync-llm/scripts/sync-llm.sh'


def main():
    with tempfile.TemporaryDirectory(prefix='browser-config-check-') as temporary:
        root = Path(temporary)
        source = root / 'dotfiles/.codex'
        source.mkdir(parents=True)
        (source / 'config.toml').write_text('[mcp_servers.playwright]\ncommand="npx"\nargs=["-y", "@playwright/mcp@0.0.76", "--isolated"]\n')
        # Load functions, without running the other sync lanes or real MCP clients.
        script = root / 'browser-sync.sh'
        script.write_text(SCRIPT.read_text().split('\nsync_claude\n')[0] + '\nsync_playwright_registrations\nexit "$changed"\n')
        claude = root / '.claude.json'
        project = root / '.mcp.json'
        original = {
            'unrelatedState': {'fixture': 'must-stay-private'},
            'mcpServers': {'playwright': {'command': 'npx', 'args': ['-y', '@playwright/mcp@latest', '--isolated'], 'timeout': 15}},
            'projects': {
                '/one': {'mcpServers': {'playwright': {'type': 'stdio', 'command': 'npx', 'args': ['@playwright/mcp@latest', '--browser', 'firefox', '--config', 'custom.json'], 'env': {'EXAMPLE': 'preserve'}}}, 'hasTrustDialogAccepted': True},
                '/two': {'mcpServers': {'other': {'command': 'custom-command'}}},
            },
        }
        project_original = {'mcpServers': {'playwright': {'command': 'npx', 'args': ['--yes', '@playwright/mcp@0.0.83', '--headless']}, 'other': {'url': 'https://example.test'}}}
        claude.write_text(json.dumps(original)); claude.chmod(0o600)
        project.write_text(json.dumps(project_original)); project.chmod(0o644)
        env = {**os.environ, 'DOTFILES': str(root / 'dotfiles'), 'CLAUDE_MCP_CONFIG': str(claude), 'PROJECT_MCP_FILE': str(project), 'BACKUP_DIR': str(root / 'backups')}

        def run(mode):
            result = subprocess.run(['bash', str(script), mode], env=env, capture_output=True, text=True)
            assert 'must-stay-private' not in result.stdout + result.stderr
            return result

        before = (claude.read_bytes(), project.read_bytes())
        assert run('--check').returncode == 1
        assert before == (claude.read_bytes(), project.read_bytes())
        assert not (root / 'backups').exists()
        result = run('--apply'); assert result.returncode == 0, result.stderr
        updated = json.loads(claude.read_text()); shared = json.loads(project.read_text())
        expected = copy.deepcopy(original)
        expected['mcpServers']['playwright']['args'][1] = '@playwright/mcp@0.0.76'
        expected['projects']['/one']['mcpServers']['playwright']['args'] = ['-y', '@playwright/mcp@0.0.76', '--browser', 'firefox', '--config', 'custom.json', '--isolated']
        assert updated == expected
        expected_shared = copy.deepcopy(project_original)
        expected_shared['mcpServers']['playwright']['args'] = ['--yes', '@playwright/mcp@0.0.76', '--headless', '--isolated']
        assert shared == expected_shared
        backups = list((root / 'backups').iterdir())
        assert len(backups) == 2
        assert sorted(p.read_bytes() for p in backups) == sorted(before)
        assert all(p.stat().st_mode & 0o777 == 0o600 for p in backups)
        assert claude.stat().st_mode & 0o777 == 0o600
        assert project.stat().st_mode & 0o777 == 0o644
        assert run('--check').returncode == 0
        stable = (claude.read_bytes(), claude.stat().st_mtime_ns)
        assert run('--apply').returncode == 0
        assert stable == (claude.read_bytes(), claude.stat().st_mtime_ns)
        assert len(list((root / 'backups').iterdir())) == 2

        # A missing user registration is added; unrelated project entries stay intact.
        updated['mcpServers'].pop('playwright')
        claude.write_text(json.dumps(updated))
        assert run('--apply').returncode == 0
        assert json.loads(claude.read_text())['mcpServers']['playwright']['args'] == ['-y', '@playwright/mcp@0.0.76', '--isolated']

        # Refuse attached-browser overrides instead of silently changing ownership.
        updated = json.loads(claude.read_text())
        updated['projects']['/one']['mcpServers']['playwright']['args'].append('--extension')
        claude.write_text(json.dumps(updated)); blocked = claude.read_bytes()
        assert run('--apply').returncode == 2
        assert claude.read_bytes() == blocked
        claude.write_text('{ malformed fixture')
        assert run('--apply').returncode == 2
        assert claude.read_text() == '{ malformed fixture'
    print('PASS: browser sync check/apply, preserved custom settings, private backups, idempotency, missing registration, attachment and malformed-config guards')


if __name__ == '__main__':
    main()
