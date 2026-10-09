#!/usr/bin/env python3
"""Check startup/config cleanup with disposable homes, without live app launches."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
KITTY_OVERRIDES = '''font_family family="CommitMono Nerd Font"
bold_font auto
italic_font auto
bold_italic_font auto
macos_option_as_alt yes
cursor_trail 3
cursor_trail_decay 0.1 0.4
input_delay 0
repaint_delay 2
sync_to_monitor no
font_size 12.0
modify_font cell_height 130%
include current-theme.conf
'''


class StartupCleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='startup-cleanup-')
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.env = dict(os.environ, HOME=str(self.folder), XDG_CONFIG_HOME=str(self.folder / '.config'),
                        XDG_DATA_HOME=str(self.folder / '.local/share'), XDG_STATE_HOME=str(self.folder / '.local/state'),
                        XDG_CACHE_HOME=str(self.folder / '.cache'), CLEANUP_SOURCE=str(ROOT),
                        CLEANUP_FIXTURE=str(self.folder), TERM_PROGRAM='', CODEX_SANDBOX='', CODEX_CI='')

    def run_command(self, args, env=None):
        result = subprocess.run(args, cwd=self.folder, env=env or self.env,
                                text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def test_zsh_plugins_have_one_installation_owner(self):
        brew = (ROOT / 'Brewfile').read_text()
        installer = (ROOT / 'install.sh').read_text()
        config = (ROOT / 'zsh/.zshrc').read_text()
        self.assertNotIn('http://github.com/', brew)
        for plugin in ('zsh-autosuggestions', 'zsh-syntax-highlighting'):
            self.assertNotIn(f'brew "{plugin}"', brew)
            self.assertIn(plugin, config)
        prelude = installer.split('\n# ==============================================================================\necho ""', 1)[0]
        self.run_command(['bash', '-c', prelude + '''
ZSH_CUSTOM="$HOME/.oh-my-zsh/custom"
git() {
  printf '%s\\n' "$2" >> "$HOME/plugin-clones"
  mkdir -p "$3"
}
for plugin in zsh-autosuggestions zsh-syntax-highlighting; do
  run_stage "$plugin" install_zsh_plugin "$plugin"
  run_stage "$plugin repeated" install_zsh_plugin "$plugin"
done
test "${#FAILED_STAGES[@]}" -eq 0
'''])
        self.assertEqual((self.folder / 'plugin-clones').read_text().splitlines(), [
            'https://github.com/zsh-users/zsh-autosuggestions',
            'https://github.com/zsh-users/zsh-syntax-highlighting',
        ])
        for plugin in ('zsh-autosuggestions', 'zsh-syntax-highlighting'):
            self.assertTrue((self.folder / '.oh-my-zsh/custom/plugins' / plugin).is_dir())

    def test_kitty_parsed_options_preserve_original_active_overrides(self):
        kitty = shutil.which('kitty')
        self.assertIsNotNone(kitty, 'kitty is required')
        before = self.folder / 'before.conf'
        before.write_text(KITTY_OVERRIDES)
        shutil.copyfile(ROOT / '.config/kitty/current-theme.conf', self.folder / 'current-theme.conf')
        result = self.run_command([kitty, '+runpy', '''
import os
from kitty.config import load_config
source = os.environ['CLEANUP_SOURCE'] + '/.config/kitty/kitty.conf'
before = os.environ['CLEANUP_FIXTURE'] + '/before.conf'
errors = []
actual = load_config(source, accumulate_bad_lines=errors)
expected = load_config(before, accumulate_bad_lines=errors)
assert not errors, errors
assert actual._asdict() == expected._asdict(), 'parsed Kitty options changed'
print('PASS: all parsed Kitty options preserved')
'''])
        self.assertNotIn('Could not find included config', result.stderr)
        self.assertFalse((ROOT / '.config/kitty/theme.conf').is_symlink())
        self.assertLess(len((ROOT / '.config/kitty/kitty.conf').read_text().splitlines()), 30)

    def test_zsh_initialises_completions_once_with_relocated_home(self):
        framework = self.folder / '.oh-my-zsh'
        (framework / 'custom/completions').mkdir(parents=True)
        (framework / 'oh-my-zsh.sh').write_text('autoload -Uz compinit\ncompinit\n')
        result = self.run_command(['zsh', '-f', '-c', '''
function autoload() {
  if [[ "$*" == *compinit* ]]; then
    function compinit() { print initialized >> "$CLEANUP_FIXTURE/completion-calls" }
  else
    builtin autoload "$@"
  fi
}
function fnm() { return 0 }
function starship() { return 0 }
function zoxide() { return 0 }
source "$CLEANUP_SOURCE/zsh/.zshrc"
[[ ${fpath[(Ie)$HOME/.oh-my-zsh/custom/completions]} -gt 0 ]] || exit 12
[[ $NVIM_APPNAME == cnvim ]] || exit 13
'''])
        self.assertEqual((self.folder / 'completion-calls').read_text().splitlines(), ['initialized'])
        self.assertNotIn('/Users/eric/.oh-my-zsh', result.stdout + result.stderr)

    def test_zsh_sandbox_does_not_initialise_completions(self):
        env = dict(self.env, CODEX_SANDBOX='1')
        self.run_command(['zsh', '-f', '-c', '''
function autoload() { print unexpected >> "$CLEANUP_FIXTURE/completion-calls"; }
function compinit() { print unexpected >> "$CLEANUP_FIXTURE/completion-calls"; }
source "$CLEANUP_SOURCE/zsh/.zshrc"
[[ $NVIM_APPNAME == cnvim ]] || exit 12
'''], env)
        self.assertFalse((self.folder / 'completion-calls').exists())

    def fish_home(self, cargo_env):
        config = self.folder / '.config/fish'
        (config / 'conf.d').mkdir(parents=True)
        shutil.copyfile(ROOT / '.config/fish/config.fish', config / 'config.fish')
        # Copy only Rust startup snippets: other plugins have unrelated side effects.
        for source in (ROOT / '.config/fish/conf.d').glob('*rust*.fish'):
            shutil.copyfile(source, config / 'conf.d' / source.name)
        binary = self.folder / 'bin'
        binary.mkdir()
        ruby = binary / 'ruby'
        ruby.write_text('#!/bin/sh\nexit 0\n')
        ruby.chmod(0o755)
        if cargo_env:
            cargo = self.folder / '.cargo'
            cargo.mkdir()
            (cargo / 'env.fish').write_text('echo sourced >> "$CLEANUP_FIXTURE/cargo-calls"\n')
        return dict(self.env, PATH=str(binary) + os.pathsep + os.environ['PATH'], CODEX_SANDBOX='1')

    def test_fish_cargo_env_runs_once_per_shell_and_path_is_unique(self):
        fish = shutil.which('fish')
        self.assertIsNotNone(fish, 'fish is required')
        env = self.fish_home(True)
        command = '''
test (count (string match -- "$HOME/.cargo/bin" $PATH)) -eq 1; or exit 12
'''
        self.run_command([fish, '-c', command], env)
        self.assertEqual((self.folder / 'cargo-calls').read_text().splitlines(), ['sourced'])
        nested = command + '\n' + fish + " -c 'test (count (string match -- \"$HOME/.cargo/bin\" $PATH)) -eq 1; or exit 13'"
        self.run_command([fish, '-c', nested], env)
        self.assertEqual((self.folder / 'cargo-calls').read_text().splitlines(), ['sourced'] * 3)

    def test_fish_without_cargo_env_starts_quietly_and_keeps_bin_path(self):
        fish = shutil.which('fish')
        self.assertIsNotNone(fish, 'fish is required')
        env = self.fish_home(False)
        result = self.run_command([fish, '-c', 'contains -- "$HOME/.cargo/bin" $PATH; or exit 12'], env)
        diagnostics = result.stderr.replace('warning: notify_register_file_descriptor() failed with status 9.\n', '')
        diagnostics = diagnostics.replace('warning: Universal variable notifications may not be received.\n', '')
        self.assertEqual(diagnostics, '')

    def test_shared_herdr_module_links_survive_installed_profile_layout(self):
        canonical = ROOT / '.config/nvim/lua/config/herdr.lua'
        for profile in ('nvim', 'cnvim', 'nvim-lite'):
            installed = self.folder / '.config' / profile
            installed.parent.mkdir(exist_ok=True)
            shutil.copytree(ROOT / '.config' / profile, installed, symlinks=True)
        for profile in ('cnvim', 'nvim-lite'):
            source = ROOT / '.config' / profile / 'lua/config/herdr.lua'
            self.assertTrue(source.is_symlink())
            self.assertEqual(source.resolve(), canonical)
            installed = self.folder / '.config' / profile / 'lua/config/herdr.lua'
            self.assertTrue(installed.is_file())
            self.assertEqual(installed.read_bytes(), canonical.read_bytes())


if __name__ == '__main__':
    unittest.main()
