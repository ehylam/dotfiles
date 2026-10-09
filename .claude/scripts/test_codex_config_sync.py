#!/usr/bin/env python3
"""Check installer/sync rendering without touching live config or trust state."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import tomllib

ROOT = Path(__file__).resolve().parents[2]
SYNC = ROOT / '.agents/skills/sync-llm/scripts/sync-llm.sh'

with tempfile.TemporaryDirectory(prefix='codex-render-check-') as folder:
    temporary = Path(folder)
    source = temporary / 'dotfiles'
    (source / '.codex').mkdir(parents=True)
    helper = source / '.agents/skills/sync-llm/scripts'
    helper.mkdir(parents=True)
    shutil.copy2(SYNC.with_name('merge-codex-config.py'), helper)
    (source / '.codex/config.user.toml').write_text('model="source-model"\nmodel_reasoning_effort="medium"\n')
    (source / '.codex/config.toml').write_text('[mcp_servers.playwright]\ncommand="npx"\nargs=["-y","@playwright/mcp@0.0.76","--isolated"]\n'
                                            '[mcp_servers.retired]\nenabled=false\ncommand="disabled-fixture"\n')
    live = temporary / 'live'
    live.mkdir()
    config = live / 'config.toml'
    config.write_text('model="user-picked-model"\nmodel_reasoning_effort="high"\n'
                      '[projects."/fixture"]\ntrust_level="trusted"\n'
                      '[hooks.state."fixture-only"]\ntrusted=true\n'
                      '[mcp_servers.node_repl]\ncommand="app-managed-client"\n'
                      '[mcp_servers.retired]\nenabled=true\ncommand="old-fixture"\n'
                      '[tui.model_availability_nux]\n"user-picked-model"=1\n')
    original = config.read_bytes()
    for label, prelude, invocation in (
        ('sync', SYNC.read_text().split('\nsync_claude\n', 1)[0], 'render_codex_config "$OUTPUT"'),
    ):
        output = temporary / (label + '.toml')
        script = helper / (label + '.sh')
        # The functions come from their actual callers; no bootstrap/sync lanes run.
        script.write_text(prelude + '\nDOTFILES="$FIXTURE_SOURCE"\nCODEX_DIR="$FIXTURE_LIVE"\n' + invocation + '\n')
        env = {**os.environ, 'FIXTURE_SOURCE': str(source), 'FIXTURE_LIVE': str(live), 'OUTPUT': str(output)}
        result = subprocess.run(['bash', str(script)], env=env, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        data = tomllib.loads(output.read_text())
        assert data['model'] == 'user-picked-model' and data['model_reasoning_effort'] == 'high'
        assert data['projects']['/fixture']['trust_level'] == 'trusted'
        assert data['hooks']['state']['fixture-only']['trusted'] is True
        assert data['mcp_servers']['node_repl']['command'] == 'app-managed-client'
        assert data['mcp_servers']['retired']['enabled'] is False
        assert data['mcp_servers']['retired']['command'] == 'disabled-fixture'
        assert '--isolated' in data['mcp_servers']['playwright']['args']
        assert config.read_bytes() == original
        config.rename(live / 'saved.toml')
        subprocess.run(['bash', str(script)], env=env, check=True, capture_output=True)
        assert tomllib.loads(output.read_text())['model'] == 'source-model'
        (live / 'saved.toml').rename(config)

    # Only the dotfiles-managed retired plugin may be moved out of auto-loading.
    opencode = temporary / 'opencode'
    (opencode / 'plugins').mkdir(parents=True)
    (source / '.config/opencode').mkdir(parents=True)
    (source / '.config/opencode/opencode.json').write_text('{}\n')
    legacy = opencode / 'plugins/opencode-tmux-agent-indicator.js'
    managed = source / '.config/opencode/plugins/opencode-tmux-agent-indicator.js'
    script = helper / 'retire-plugin.sh'
    script.write_text(SYNC.read_text().split('\nsync_claude\n', 1)[0] +
                      '\nDOTFILES="$FIXTURE_SOURCE"\nOPENCODE_DIR="$FIXTURE_OPENCODE"\n'
                      'sync_opencode\n')
    env = {**os.environ, 'FIXTURE_SOURCE': str(source), 'FIXTURE_OPENCODE': str(opencode),
           'BACKUP_DIR': str(temporary / 'backups')}
    legacy.symlink_to(managed)
    subprocess.run(['bash', str(script), '--check'], env=env, check=True, capture_output=True)
    assert legacy.is_symlink()
    subprocess.run(['bash', str(script), '--apply'], env=env, check=True, capture_output=True)
    saved = temporary / 'backups' / str(legacy).lstrip('/')
    assert not legacy.is_symlink() and saved.is_symlink()
    assert saved.readlink() == managed
    legacy.write_text('locally maintained plugin\n')
    subprocess.run(['bash', str(script), '--apply'], env=env, check=True, capture_output=True)
    assert legacy.read_text() == 'locally maintained plugin\n'
    legacy.unlink()
    legacy.symlink_to(temporary / 'different-plugin.js')
    subprocess.run(['bash', str(script), '--apply'], env=env, check=True, capture_output=True)
    assert legacy.is_symlink()

    # Global hooks must not also be discovered as dotfiles project hooks.
    hooks = source / '.codex/hooks.user.json'
    hooks.write_bytes((ROOT / '.codex/hooks.user.json').read_bytes())
    script = helper / 'sync-hooks.sh'
    script.write_text(SYNC.read_text().split('\nsync_claude\n', 1)[0] +
                      '\nDOTFILES="$FIXTURE_SOURCE"\nCODEX_DIR="$FIXTURE_LIVE"\nsync_codex\n')
    env = {**os.environ, 'FIXTURE_SOURCE': str(source), 'FIXTURE_LIVE': str(live),
           'BACKUP_DIR': str(temporary / 'backups')}
    subprocess.run(['bash', str(script), '--apply'], env=env, check=True, capture_output=True)
    assert (live / 'hooks.json').resolve() == hooks.resolve()
    assert not (ROOT / '.codex/hooks.json').exists(), 'Global hooks also discovered as project hooks'

base = tomllib.loads((ROOT / '.codex/config.toml').read_text())
combined = tomllib.loads((ROOT / '.codex/config.user.toml').read_text() + '\n' + (ROOT / '.codex/config.toml').read_text())
assert combined['mcp_servers']['playwright']['command'] == 'npx'
assert 'projects' not in base and 'node_repl' not in base.get('mcp_servers', {})
assert 'model_availability_nux' not in base.get('tui', {})
installer = (ROOT / 'install.sh').read_text()
assert 'render_codex_config()' not in installer and 'generate_codex_config()' not in installer
assert 'sync_local_llm_config' in installer and '--apply --local-config' in installer
for duplicate in ('backup_and_link "$DOTFILES/.codex/', 'backup_and_link "$DOTFILES/.config/herdr/',
                  'backup_and_link "$DOTFILES/.config/rtk/', 'backup_and_link "$DOTFILES/zsh/',
                  'for skill in "$DOTFILES"/.agents/skills/'):
    assert duplicate not in installer, 'Installer duplicates shared config ownership: ' + duplicate
print('PASS: single renderer preserves local model/trust/app registration, explicit MCP disable wins, clean installs parse and source excludes runtime state')
