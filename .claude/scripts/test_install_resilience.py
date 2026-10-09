#!/usr/bin/env python3
"""Run the full installer with fake services and injected stage failures."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]

with tempfile.TemporaryDirectory(prefix='install-resilience-') as directory:
    fixture = Path(directory)
    tools = fixture / 'bin'
    tools.mkdir()
    dispatcher = tools / 'dispatch'
    dispatcher.write_text(f'#!{sys.executable}\n' + '''
import json, os, sys
from pathlib import Path
name = Path(sys.argv[0]).name
args = sys.argv[1:]
failure = os.environ['INSTALL_TEST_FAIL']
with Path(os.environ['INSTALL_TEST_LOG']).open('a') as out:
    out.write(json.dumps([name, *args]) + '\\n')
if name == 'brew' and args[:1] == ['--prefix']:
    print(os.environ['INSTALL_TEST_HOME'] + '/python'); sys.exit(0)
if name == 'python3':
    if failure == 'python' and args == ['-c', 'import tomllib']: sys.exit(21)
    os.execv(os.environ['INSTALL_TEST_PYTHON'], [os.environ['INSTALL_TEST_PYTHON'], *args])
if name == 'brew' and args[:1] == ['bundle'] and failure == 'brew': sys.exit(22)
if name == 'curl': sys.exit(32)
if name == 'xcode-select' and failure == 'xcode': sys.exit(33)
if name == 'git' and args[:1] == ['clone']:
    if failure == 'clone' and 'zsh-autosuggestions' in args[-1]: sys.exit(23)
    Path(args[-1]).mkdir(parents=True, exist_ok=True)
if name == 'npm' and failure == 'npm' and args[-1] == '@anthropic-ai/claude-code': sys.exit(24)
if name == 'claude' and args[:3] == ['mcp', 'add', 'context7'] and failure == 'mcp': sys.exit(25)
if name == 'nvim' and os.environ.get('NVIM_APPNAME') == 'nvim' and failure == 'nvim': sys.exit(26)
if name == 'defaults' and 'KeyRepeat' in args and failure == 'defaults': sys.exit(27)
if name in ('ln', 'mv'):
    if failure == 'link' and name == 'ln' and args[-1].endswith('/ghostty'): sys.exit(28)
    if failure == 'backup' and name == 'mv' and args[0].endswith('/ghostty'): sys.exit(29)
    os.execv('/bin/' + name, [name, *args])
''')
    dispatcher.chmod(0o700)
    for name in ('brew', 'xcode-select', 'fish', 'sudo', 'git', 'npm', 'python3',
                 'nvim', 'defaults', 'rustup', 'ln', 'mv', 'curl'):
        (tools / name).symlink_to(dispatcher)
    for failure in ('none', 'brew', 'clone', 'npm', 'mcp', 'nvim', 'defaults',
                    'python', 'sync', 'link', 'backup', 'download', 'xcode'):
        home = fixture / failure
        source = home / '.dotfiles'
        source.mkdir(parents=True)
        log = home / 'calls.jsonl'

        def write(relative, text):
            path = source / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
            return path

        installer = write('install.sh', (ROOT / 'install.sh').read_text())
        write('Brewfile', '# fixture\n')
        write('check-install.sh', 'printf "audit\\n" >> "$INSTALL_TEST_LOG"\n')
        write('.agents/skills/sync-llm/scripts/sync-llm.sh', '''printf 'sync %s\\n' "$*" >> "$INSTALL_TEST_LOG"
[ "$INSTALL_TEST_FAIL" != sync ] || exit 31
''')
        write('.claude/scripts/setup-inspect-diff.sh', 'printf "inspect\\n" >> "$INSTALL_TEST_LOG"\n')
        write('.gitconfig', '# fixture\n')
        write('.gitignore', '# fixture\n')
        write('.config/starship.toml', '# fixture\n')
        for name in ('ghostty', 'kitty', 'nvim', 'cnvim', 'nvim-lite', 'helix', 'swiftbar/plugins'):
            (source / '.config' / name).mkdir(parents=True)
        for name in ('config.fish', 'config-osx.fish', 'config-linux.fish', 'config-windows.fish', 'fish_plugins'):
            write('.config/fish/' + name, '# fixture\n')
        for name in ('functions', 'conf.d', 'completions'):
            (source / '.config/fish' / name).mkdir()
        (home / '.gitconfig-local').write_text('# fixture\n')
        if failure != 'download':
            (home / '.oh-my-zsh').mkdir()
        if failure == 'backup':
            (home / '.config').mkdir()
            (home / '.config/ghostty').write_text('original config\n')
        env = dict(os.environ, HOME=str(home), PATH=str(tools) + ':/usr/bin:/bin',
                   DOTFILES=str(source), XDG_DATA_HOME=str(home / 'data'),
                   DOTFILES_INSTALL_SOURCE=str(home / 'base'), INSTALL_TEST_FAIL=failure,
                   INSTALL_TEST_LOG=str(log), INSTALL_TEST_HOME=str(home),
                   INSTALL_TEST_PYTHON=sys.executable)
        for key in ('BASH_ENV', 'ENV', 'ZSH_CUSTOM', 'XDG_CONFIG_HOME'):
            env.pop(key, None)
        # Only MCP and editor cases need an existing Claude binary. Other cases
        # exercise npm installation and then skip registration if still absent.
        claude = tools / 'claude'
        claude.unlink(missing_ok=True)
        if failure in ('mcp', 'nvim', 'sync'):
            claude.symlink_to(dispatcher)
        result = subprocess.run(['/bin/bash', *(['-e'] if failure == 'brew' else []), str(installer)], env=env,
                                stdin=subprocess.DEVNULL, text=True,
                                capture_output=True, timeout=30)
        lines = log.read_text().splitlines()
        calls = [json.loads(line) for line in lines if line.startswith('[')]
        assert 'audit' in lines, (failure, result.stdout, result.stderr)
        assert any(call[:2] == ['defaults', 'write'] for call in calls), failure
        assert result.returncode == (0 if failure == 'none' else 1), (failure, result.stdout, result.stderr)
        if failure != 'none':
            assert 'Installation has unresolved stages:' in result.stdout, failure
        if failure == 'python':
            assert 'configuration source unavailable' in result.stdout
            assert not (home / '.config/ghostty').exists()
            assert not any(call[0] == 'nvim' for call in calls)
            assert not any(line.startswith('sync ') for line in lines)
        else:
            assert 'inspect' in lines
            assert any(call[0] == 'nvim' for call in calls), failure
        if failure == 'clone':
            assert (home / '.oh-my-zsh/custom/plugins/zsh-syntax-highlighting').is_dir()
        if failure == 'download':
            assert 'Zsh plugins: Oh My Zsh unavailable' in result.stdout
            assert not any(call[0] == 'git' for call in calls)
        if failure == 'npm':
            assert ['npm', 'install', '-g', '@openai/codex'] in calls
            assert ['npm', 'install', '-g', 'opencode-ai@1.18.34'] in calls
            assert '[OK] Claude Code' not in result.stdout
        if failure == 'mcp':
            assert any(call[:3] == ['claude', 'mcp', 'add'] and call[3] == 'github-mcp' for call in calls)
        if failure == 'nvim':
            assert len([call for call in calls if call[0] == 'nvim']) == 3
        if failure == 'defaults':
            assert not any('InitialKeyRepeat' in call for call in calls)
            assert any('com.ameba.SwiftBar' in call for call in calls)
        if failure in ('link', 'backup'):
            assert (home / '.config/kitty').is_symlink()
        if failure == 'backup':
            assert (home / '.config/ghostty').read_text() == 'original config\n'
            assert not any(call[0] == 'ln' and call[-1].endswith('/ghostty') for call in calls)

print('PASS: full installer isolates package, clone, CLI, MCP, editor, defaults, source, sync, link and backup failures; final audit and summary run')
