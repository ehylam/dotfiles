#!/usr/bin/env python3
"""Verify vendored Fish plugins in fresh and repeated isolated installations."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
fish = shutil.which('fish')
if not fish:
    raise SystemExit('BLOCKED: Fish is required for the installer plugin fixture')
installer = (ROOT / 'install.sh').read_text()
prelude = installer.split('\n# ==============================================================================\necho ""', 1)[0]
assert 'fisher update' not in installer and 'fisher install' not in installer

plugins = {
    'jorgebucaran/fisher': ('fisher', 'functions/fisher.fish', 'completions/fisher.fish'),
    'decors/fish-ghq': ('__ghq_repository_search', 'functions/__ghq_repository_search.fish', 'conf.d/ghq_key_bindings.fish'),
    'patrickf1/fzf.fish': ('fzf_configure_bindings', 'functions/fzf_configure_bindings.fish', 'conf.d/fzf.fish'),
    'jorgebucaran/autopair.fish': ('_autopair_backspace', 'functions/_autopair_backspace.fish', 'conf.d/autopair.fish'),
    'meaningful-ooo/sponge': ('sponge_filter_failed', 'functions/sponge_filter_failed.fish', 'conf.d/sponge.fish'),
    'edc/bass': ('bass', 'functions/bass.fish', 'functions/__bass.py'),
}

with tempfile.TemporaryDirectory(prefix='dotfiles-fish-install-') as td:
    temporary = Path(td)
    home = temporary / 'home'
    source = temporary / 'source'
    source_fish = source / '.config/fish'
    shutil.copytree(ROOT / '.config/fish', source_fish, symlinks=True)
    manifest = (source_fish / 'fish_plugins').read_text().splitlines()
    assert set(manifest) == set(plugins), 'Add bundled coverage when changing the plugin inventory'
    for _, *files in plugins.values():
        for name in files:
            assert (source_fish / name).is_file(), name

    def snapshot():
        return {str(path.relative_to(source)): ('link', os.readlink(path)) if path.is_symlink()
                else ('file', path.read_bytes()) if path.is_file() else ('dir',)
                for path in source.rglob('*')}

    before = snapshot()
    env = dict(os.environ, HOME=str(home), DOTFILES=str(source),
               XDG_CONFIG_HOME=str(home / '.config'), XDG_DATA_HOME=str(home / '.local/share'),
               XDG_CACHE_HOME=str(home / '.cache'))
    for iteration in range(2):
        result = subprocess.run(['bash', '-c', prelude + '\nlink_fish_config\n'],
                                env=env, text=True, capture_output=True, timeout=15)
        assert result.returncode == 0, result.stdout + result.stderr
        installed = home / '.config/fish'
        assert (installed / 'fish_plugins').is_symlink()
        assert (installed / 'fish_plugins').read_text().splitlines() == manifest
        # Use actual Fish autoloading and the bundled Fisher implementation without
        # shell startup integrations, downloads or synthetic ownership metadata.
        script = '''
set --prepend fish_function_path "$argv[1]/functions"
for name in $argv[2..]
    type --query $name; or exit 1
end
fisher --version
set --query _fisher_plugins; and exit 2
exit 0
'''
        result = subprocess.run([fish, '--no-config', '-c', script, str(installed),
                                 *(entry[0] for entry in plugins.values())],
                                env=env, text=True, capture_output=True, timeout=15)
        assert result.returncode == 0, result.stdout + result.stderr
        assert 'fisher, version' in result.stdout
        assert snapshot() == before, f'Install {iteration + 1} changed vendored source'

print('PASS: all six vendored plugins available; fresh/repeated Fish links and source remain intact')
