#!/usr/bin/env python3
"""Exercise installer helpers and read-only audit with isolated fake tools."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
prelude = (ROOT / 'install.sh').read_text().split('\n# ==============================================================================\necho ""', 1)[0]

with tempfile.TemporaryDirectory(prefix='dotfiles-install-check-') as td:
    temporary = Path(td)
    home = temporary / 'home'
    source = home / '.dotfiles'
    source.mkdir(parents=True)
    binaries = temporary / 'bin'
    binaries.mkdir()
    log = temporary / 'calls.jsonl'

    def write(path, text, executable=False):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        if executable:
            path.chmod(0o755)
        return path

    runner = write(temporary / 'helpers.sh', 'install_test_action="$1"\nshift\n' + prelude + '\n"$install_test_action"\n')
    npm = write(binaries / 'npm', f'#!{sys.executable}\n' + '''
import json, os, sys
from pathlib import Path
with Path(os.environ['TEST_LOG']).open('a') as out: out.write(json.dumps(sys.argv[1:])+'\\n')
Path(os.environ['TEST_BIN'],'opencode').write_text('#!/bin/sh\\nprintf "1.18.34\\\\n"\\n')
Path(os.environ['TEST_BIN'],'opencode').chmod(0o755)
''', True)
    (binaries / 'bash').symlink_to('/bin/bash')
    (binaries / 'date').symlink_to(shutil.which('date'))
    env = dict(os.environ, HOME=str(home), DOTFILES=str(source), PATH=str(binaries),
               TEST_LOG=str(log), TEST_BIN=str(binaries))

    def run(argv, **extra):
        return subprocess.run(argv, env=dict(env, **extra), capture_output=True,
                              text=True, timeout=15)

    result = run(['/bin/bash', str(runner), 'install_opencode'])
    assert result.returncode == 0, result.stderr
    assert json.loads(log.read_text()) == ['install', '-g', 'opencode-ai@1.18.34']
    log.unlink()
    result = run(['/bin/bash', str(runner), 'install_opencode'])
    assert result.returncode == 0 and not log.exists()
    write(binaries / 'opencode', '#!/bin/sh\nprintf "other-version\\n"\n', True)
    result = run(['/bin/bash', str(runner), 'install_opencode'])
    assert result.returncode == 0 and 'retained' in result.stdout and not log.exists()
    write(binaries / 'opencode', '#!/bin/sh\nexit 17\n', True)
    result = run(['/bin/bash', str(runner), 'install_opencode'])
    assert result.returncode == 1 and 'version probe failed' in result.stdout + result.stderr
    write(binaries / 'opencode', '#!/bin/sh\nprintf "1.18.34\\n"\n', True)

    # Full sync follows apply with check, and stops if apply fails. Discovery is
    # deferred by default; local-only setup does not request remote plugin work.
    write(source / '.agents/skills/sync-llm/scripts/sync-llm.sh', '''#!/bin/bash
printf '%s %s\\n' "$1" "${2:-all}" >> "$TEST_LOG"
[ "${TEST_SYNC_FAIL:-}" != "$1" ] || exit 19
''')
    result = run(['/bin/bash', str(runner), 'sync_local_llm_config'])
    assert result.returncode == 0 and log.read_text().splitlines()[0] == '--apply --local-config'
    log.unlink()
    result = run(['/bin/bash', str(runner), 'sync_local_llm_config'], TEST_SYNC_FAIL='--apply')
    assert result.returncode == 19 and len(log.read_text().splitlines()) == 1
    for options, scope in (({}, 'all'), ({'DOTFILES_REMOTE_SYNC': '0'}, '--local-config')):
        log.unlink(missing_ok=True)
        result = run(['/bin/bash', str(runner), 'finish_llm_setup'], **options)
        assert result.returncode == 0, result.stderr
        assert log.read_text().splitlines() == [f'--apply {scope}', f'--check {scope}']
    log.unlink()
    result = run(['/bin/bash', str(runner), 'finish_llm_setup'], TEST_SYNC_FAIL='--apply')
    assert result.returncode != 0 and len(log.read_text().splitlines()) == 1
    log.unlink()
    result = run(['/bin/bash', str(runner), 'finish_llm_setup'], TEST_SYNC_FAIL='--check')
    assert result.returncode == 19 and len(log.read_text().splitlines()) == 2

    # --check dispatches before the installer can perform a mutation.
    write(source / 'check-install.sh', '#!/bin/bash\necho delegated-check\nexit 23\n')
    installer = write(source / 'install.sh', (ROOT / 'install.sh').read_text())
    result = run(['/bin/bash', str(installer), '--check'])
    assert result.returncode == 23 and result.stdout.strip() == 'delegated-check'
    for args, expected in ((['--help'], 0), (['bad-option'], 2), (['--check', 'extra'], 2)):
        assert run(['/bin/bash', str(installer), *args]).returncode == expected

    # Audit a synthetic complete local install, then remove one link/package.
    # Only the preflight/check branch is allowed in the fake service tools.
    safe_path = f'{binaries}:{os.environ["PATH"]}'
    env['PATH'] = safe_path
    for tool in ('brew', 'fish', 'starship', 'zoxide', 'fnm', 'git', 'gh', 'nvim',
                 'fzf', 'rg', 'jq', 'uv', 'pnpm', 'rustup', 'herdr', 'claude', 'codex', 'rtk'):
        write(binaries / tool, '#!/bin/sh\nexit 0\n', True)
    write(binaries / 'brew', '#!/bin/sh\n[ "$1 $2" = "bundle check" ] || exit 97\n', True)
    (binaries / 'node').symlink_to(shutil.which('node'))
    write(source / 'check-install.sh', (ROOT / 'check-install.sh').read_text())
    write(source / '.agents/skills/sync-llm/scripts/sync-llm.sh', '#!/bin/bash\n[ "$1 $2" = "--check --local-config" ] || exit 98\n')
    write(source / '.config/herdr/whichkey.py', (ROOT / '.config/herdr/whichkey.py').read_text())
    write(source / '.config/herdr/whichkey.toml', '[q]\ngroup="qa"\n[q.p]\nlabel="check"\nrun="true"\n')
    for item in ('ghostty', 'kitty', 'nvim', 'cnvim', 'nvim-lite', 'helix'):
        (source / '.config' / item).mkdir(parents=True)
        dest = home / '.config' / item
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.symlink_to(source / '.config' / item)
    for item in ('config.fish', 'config-osx.fish', 'config-linux.fish', 'config-windows.fish',
                 'fish_plugins', 'completions', 'conf.d', 'functions'):
        if item in ('functions', 'conf.d'):
            path = source / '.config/fish' / item
            path.mkdir(parents=True)
        else:
            path = write(source / '.config/fish' / item, 'fixture')
        dest = home / '.config/fish' / item
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.symlink_to(path)
    for relative in ('.config/starship.toml', '.gitconfig', '.gitignore'):
        path = write(source / relative, '# fixture')
        dest = home / relative
        dest.symlink_to(path)
    write(home / '.gitconfig-local', '# fixture identity')
    for relative in ('.agents/skills/inspect/SKILL.md', '.claude/scripts/apple-qa.sh'):
        write(source / relative, '# fixture support workflow')
    for package in ('pixelmatch', 'pngjs'):
        write(home / '.local/share/inspect/node_modules' / package / 'index.js', 'module.exports = {};')
    chrome = write(temporary / 'chrome', '#!/bin/sh\nexit 99\n', True)
    env['CHROME_PATH'] = str(chrome)
    env['XDG_DATA_HOME'] = str(home / '.local/share')

    def snapshot():
        return {str(path.relative_to(home)): ('link', os.readlink(path)) if path.is_symlink()
                else ('file', path.read_bytes()) if path.is_file() else ('dir',)
                for path in home.rglob('*')}

    before = snapshot()
    result = run(['/bin/bash', str(installer), '--check'])
    assert result.returncode == 0, result.stdout + result.stderr
    assert snapshot() == before, 'Read-only audit mutated the fixture'
    write(binaries / 'opencode', '#!/bin/sh\nexit 17\n', True)
    before = snapshot()
    result = run(['/bin/bash', str(installer), '--check'])
    assert result.returncode == 1 and '[MISSING] OpenCode version probe' in result.stderr
    assert 'Manual/account checks' in result.stdout and snapshot() == before
    write(binaries / 'opencode', '#!/bin/sh\nprintf "1.18.34\\n"\n', True)
    (source / '.agents/skills/inspect/SKILL.md').unlink()
    before = snapshot()
    result = run(['/bin/bash', str(installer), '--check'])
    assert result.returncode == 1 and '[MISSING] .agents/skills/inspect/SKILL.md source exists' in result.stderr
    assert snapshot() == before
    write(source / '.agents/skills/inspect/SKILL.md', '# fixture support workflow')
    (home / '.config/fish/config.fish').unlink()
    before = snapshot()
    result = run(['/bin/bash', str(installer), '--check'])
    assert result.returncode == 1 and '[MISSING] Fish config.fish link' in result.stderr
    assert snapshot() == before
    (home / '.config/fish/config.fish').symlink_to(source / '.config/fish/config.fish')
    write(binaries / 'pnpm', '#!/bin/sh\nexit 126\n', True)
    before = snapshot()
    result = run(['/bin/bash', str(installer), '--check'])
    assert result.returncode == 1 and '[MISSING] pnpm version probe' in result.stderr
    assert snapshot() == before
    write(binaries / 'pnpm', '#!/bin/sh\nprintf "12.8.1\\n"\n', True)
    (home / '.local/share/inspect/node_modules/pngjs/index.js').unlink()
    result = run(['/bin/bash', str(installer), '--check'])
    assert result.returncode == 1 and '[MISSING] Node WebSocket support and shared inspect diff packages' in result.stderr

print('PASS: pinned install, retained versions, sync apply/check failures and mutation-free local audit with missing-link/package detection')
