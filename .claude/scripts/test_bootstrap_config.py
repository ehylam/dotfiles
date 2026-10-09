#!/usr/bin/env python3
"""Exercise shared bootstrap config using fixtures, without running installers."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import tempfile
import tomllib

ROOT = Path(__file__).resolve().parents[2]
SYNC = ROOT / '.agents/skills/sync-llm/scripts/sync-llm.sh'

# Retired integrations must not return through the durable config source.
for relative in ('.claude/settings.json', '.codex/hooks.user.json'):
    hooks = json.loads((ROOT / relative).read_text())['hooks']
    assert all(groups and all(group['hooks'] for group in groups) for groups in hooks.values())
    commands = [hook.get('command', '') for groups in hooks.values()
                for group in groups for hook in group['hooks']]
    assert not any('.orca/agent-hooks/' in command.lower() or 'ORCA_' in command
                   for command in commands), f'Orca hooks returned in {relative}'
    for retained in ('guard-push.py', 'verify-before-commit.py', 'workflow-check.py',
                     'herdr-agent-state.sh'):
        assert any(retained in command for command in commands), f'Missing {retained} in {relative}'


with tempfile.TemporaryDirectory(prefix='bootstrap-config-check-') as folder:
    temporary = Path(folder)
    home = temporary / 'home'
    source = home / '.dotfiles'
    home.mkdir()

    def write(relative, contents):
        path = source / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(contents)
        return path

    write('.claude/CLAUDE.global.md', '# Fixture instructions\n@RTK.md\n')
    write('.claude/RTK.md', 'Fixture RTK instructions.\n')
    write('.claude/settings.json', '{}\n')
    write('.claude/statusline-command.sh', '#!/bin/sh\nexit 0\n')
    write('.claude/commands/sample.md', 'Fixture command.\n')
    write('.claude/scripts/helper.sh', '#!/bin/sh\nexit 0\n')
    rule = write('.claude/rules/shopify.md', 'Fixture rule.\n')
    config = write('.config/opencode/opencode.json', '{}\n')
    command = write('.config/opencode/commands/sample.md', 'Fixture OpenCode command.\n')
    plugin = write('.config/opencode/plugins/guard-push.js', 'export const guard = {};\n')
    write('.config/herdr/plugins.txt', 'fixture/remote-plugin\n')
    fixture_sync = write('.agents/skills/sync-llm/scripts/sync-llm.sh', SYNC.read_text())

    binaries = temporary / 'bin'
    binaries.mkdir()
    calls = temporary / 'external-calls'
    for name in ('claude', 'codex', 'opencode', 'herdr', 'curl', 'git', 'npm', 'npx'):
        binary = binaries / name
        binary.write_text('#!/bin/sh\nprintf "%s\\n" "$0" >> "$EXTERNAL_CALLS"\nexit 92\n')
        binary.chmod(0o755)

    env = {'PATH': str(binaries) + os.pathsep + os.environ['PATH'], 'HOME': str(home),
           'DOTFILES': str(source), 'EXTERNAL_CALLS': str(calls),
           'SYNC_HERDR_PLUGINS': '1', 'SYNC_PONYTAIL_PLUGINS': '1',
           'SYNC_SQUAD_APEX_PLUGINS': '1', 'SYNC_DEV_MCP_SKILLS': '1'}
    live_claude = home / '.claude'
    live_claude.mkdir()
    instructions = live_claude / 'CLAUDE.md'
    instructions.symlink_to(source / '.claude/CLAUDE.global.md')
    local_settings = live_claude / 'settings.local.json'
    local_settings.write_text('{"fixture": true}\n')
    local_rules = live_claude / 'rules'
    local_rules.symlink_to(source / '.claude/rules')
    opencode = home / '.config/opencode'
    (opencode / 'plugins').mkdir(parents=True)
    custom_plugin = opencode / 'plugins/local.js'
    custom_plugin.write_text('Fixture local plugin.\n')
    codex = home / '.codex'
    codex.mkdir()
    (codex / 'config.toml').write_text('model="fixture-local-model"\n')
    (home / '.claude.json').write_text('{"fixture": "must remain untouched"}\n')

    def snapshot():
        return {str(path.relative_to(home)): ('link', os.readlink(path)) if path.is_symlink()
                else ('file', path.read_bytes()) if path.is_file() else ('dir',)
                for path in home.rglob('*')}

    before = snapshot()
    result = subprocess.run(['bash', str(fixture_sync), '--check', '--bootstrap-config'],
                            env=env, text=True, capture_output=True)
    assert result.returncode == 1 and 'Drift detected' in result.stdout, result.stdout + result.stderr
    assert snapshot() == before, 'Bootstrap check changed fixture files'
    assert not calls.exists(), 'Scoped check ran an external service/tool'

    # Keep the narrow bootstrap scope backwards-compatible; the installer uses
    # the full local scope exercised below.
    prelude = (ROOT / 'install.sh').read_text().split('\n# ==============================================================================\necho ""', 1)[0]
    runner = temporary / 'installer-config.sh'
    runner.write_text(prelude + '\nsync_local_llm_config\n')
    for attempt in range(2):
        result = subprocess.run(['bash', str(fixture_sync), '--apply', '--bootstrap-config'],
                                env=env, text=True, capture_output=True)
        assert result.returncode == 0, result.stdout + result.stderr
        assert not instructions.is_symlink(), 'Bootstrap reverted rendered instructions to a symlink'
        rendered = instructions.read_text()
        assert 'Fixture RTK instructions.' in rendered and '@RTK.md' not in rendered
        assert local_rules.is_dir() and not local_rules.is_symlink()
        assert (local_rules / rule.name).resolve() == rule.resolve()
        assert (opencode / 'opencode.json').resolve() == config.resolve()
        assert (opencode / 'commands/sample.md').resolve() == command.resolve()
        assert (opencode / 'plugins/guard-push.js').resolve() == plugin.resolve()
        assert custom_plugin.read_text() == 'Fixture local plugin.\n'
        assert local_settings.read_text() == '{"fixture": true}\n'
        assert (codex / 'config.toml').read_text() == 'model="fixture-local-model"\n'
        assert (home / '.claude.json').read_text() == '{"fixture": "must remain untouched"}\n'
        assert not calls.exists(), 'Scoped apply ran an external service/tool'
        if attempt == 0:
            first_apply = snapshot()
        else:
            assert snapshot() == first_apply, 'Repeated bootstrap config changed fixture files'

    result = subprocess.run(['bash', str(fixture_sync), '--check', '--bootstrap-config'],
                            env=env, text=True, capture_output=True)
    assert result.returncode == 0, result.stdout + result.stderr
    assert snapshot() == first_apply
    assert not calls.exists()

    # The new local scope includes every durable assistant surface, but still
    # excludes service discovery, remote plugins and native integration commands.
    write('.codex/config.toml', 'model="fixture-source-model"\n')
    write('.codex/config.user.toml', '')
    shutil.copy2(SYNC.with_name('merge-codex-config.py'), fixture_sync.parent)
    for name in ('triage.config.toml', 'review.config.toml', 'deep.config.toml'):
        write('.codex/' + name, 'model_reasoning_effort="high"\n')
    for name in ('AGENTS.md', 'RTK.md', 'hooks.user.json', 'scripts/helper.sh'):
        write('.codex/' + name, 'Fixture durable content.\n')
    for name in ('config.toml', 'project-picker.sh', 'openrouter-picker.sh', 'whichkey.py', 'whichkey.toml'):
        write('.config/herdr/' + name, 'Fixture Herdr content.\n')
    for name in ('.zprofile', '.zlogin', '.zshrc'):
        write('zsh/' + name, 'Fixture shell startup.\n')
    write('.config/rtk/config.toml', '# Fixture RTK config\n')
    write('.config/ponytail/ponytail-mode', '#!/bin/sh\nexit 0\n')
    live_herdr = home / '.config/herdr'
    live_herdr.mkdir(parents=True)
    (live_herdr / 'runtime.fixture').write_text('Local runtime state.\n')
    (codex / 'sessions').mkdir()
    (codex / 'sessions/fixture.jsonl').write_text('Local session history.\n')
    skill = write('.agents/skills/dc-support/SKILL.md', '# Fixture support skill\n').parent
    external_skill = home / '.agents/skills/external'
    external_skill.mkdir(parents=True)
    (external_skill / 'SKILL.md').write_text('# Fixture external skill\n')
    for attempt in range(2):
        result = subprocess.run(['bash', str(runner)], env=env, text=True, capture_output=True)
        assert result.returncode == 0, result.stdout + result.stderr
        assert not calls.exists(), 'Local scope called external tools'
        assert tomllib.loads((codex / 'config.toml').read_text())['model'] == 'fixture-local-model'
        assert (codex / 'review.config.toml').resolve() == (source / '.codex/review.config.toml').resolve()
        assert (home / '.agents/skills/dc-support').resolve() == skill.resolve()
        assert (live_claude / 'skills/dc-support').resolve() == skill.resolve()
        assert (live_claude / 'skills/external').resolve() == external_skill.resolve()
        assert (home / '.config/herdr/whichkey.toml').resolve() == (source / '.config/herdr/whichkey.toml').resolve()
        assert (home / '.zprofile').resolve() == (source / 'zsh/.zprofile').resolve()
        assert (codex / 'hooks.json').resolve() == (source / '.codex/hooks.user.json').resolve()
        assert (live_herdr / 'runtime.fixture').read_text() == 'Local runtime state.\n'
        assert (codex / 'sessions/fixture.jsonl').read_text() == 'Local session history.\n'
        if attempt == 0:
            local_apply = snapshot()
        else:
            assert snapshot() == local_apply
    result = subprocess.run(['bash', str(fixture_sync), '--check', '--local-config'],
                            env=env, text=True, capture_output=True)
    assert result.returncode == 0, result.stdout + result.stderr
    assert snapshot() == local_apply and not calls.exists()

    # Exercise the actual installation audit's local-sync path together. Other
    # installation surfaces are absent here; assistant checks must still pass.
    write('check-install.sh', (ROOT / 'check-install.sh').read_text())
    write('.config/herdr/whichkey.py', (ROOT / '.config/herdr/whichkey.py').read_text())
    write('.config/herdr/whichkey.toml', '[q]\ngroup="qa"\n[q.p]\nlabel="check"\nrun="true"\n')
    result = subprocess.run(['bash', str(fixture_sync), '--apply', '--local-config'],
                            env=env, text=True, capture_output=True)
    assert result.returncode == 0, result.stdout + result.stderr
    for name, contents in (('brew', '#!/bin/sh\n[ "$1 $2" = "bundle check" ] || exit 97\n'),
                           ('opencode', '#!/bin/sh\nprintf "1.18.34\\n"\n')):
        (binaries / name).write_text(contents)
        (binaries / name).chmod(0o755)
    before = snapshot()
    result = subprocess.run(['bash', str(source / 'check-install.sh')],
                            env=env, text=True, capture_output=True)
    assert '[OK] Durable assistant config and shared skill links' in result.stdout, result.stdout + result.stderr
    assert snapshot() == before and not calls.exists()
    (source / '.codex/review.config.toml').unlink()
    before = snapshot()
    result = subprocess.run(['bash', str(source / 'check-install.sh')],
                            env=env, text=True, capture_output=True)
    assert result.returncode == 1 and '[MISSING] Durable assistant config and shared skill links' in result.stderr
    assert 'Source missing, skipped:' in result.stdout and 'review.config.toml' in result.stdout
    assert snapshot() == before and not calls.exists()

print('PASS: bootstrap/local scopes are idempotent, preserve local state and link all durable config/skills without external tools')
