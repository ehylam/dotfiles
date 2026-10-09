#!/usr/bin/env python3
"""Run the named offline AI setup checks; never discover services or run inference."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parents[1]
SUITES = {
    'core': [
        'test_ai_setup_check.py', 'test_sync_backups.py', 'test_bootstrap_config.py', 'test_codex_config_sync.py',
        'test_guard_push.py', 'test_verify_before_commit.py', 'test_opencode_push_guard.mjs',
        'test_workflow_check.py', 'test_hook_resilience.py', 'test_memory_capture.py',
        'test_mem_query.py', 'test_project_brain.py',
        'test_mcp_package_pins.py',
        'test_browser_config.py', 'test_proj.py', 'test_tmux_breadcrumb.py',
    ],
    'models': [
        'test_openrouter_picker.py',
        'test_openrouter_stream_guard.mjs',
    ],
    'qa': [
        'test_apple_qa_shortcuts.py', 'test_apple_browser_qa.mjs',
        'test_apple_safari_mcp_qa.mjs', 'test_apple_ios_xctest_qa.mjs',
        'test_browser_artifact_cleanup.py', 'test_playwright_cleanup.py',
        'test_inspect_diff.mjs', 'test_figma_qa_reports.mjs',
        'test_storefront_qa.py',
    ],
    'workstation': [
        'test_install_process.py', 'test_install_resilience.py',
        'test_editor_configs.py', 'test_startup_cleanup.py',
        'test_install_fish.py',
    ],
}


def test_command(test):
    if test.endswith('.py'):
        command = [sys.executable, '-B']
    elif test.endswith('.lua'):
        command = ['nvim', '--headless', '-u', 'NONE', '-i', 'NONE', '-l']
    else:
        command = ['node']
    path = SCRIPTS / test
    return command + [str(path if path.is_file() else ROOT / test)] + (
        ['--offline'] if test == 'test_storefront_qa.py' else [])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--suite', choices=[*SUITES, 'all'], default='core')
    parser.add_argument('--list', action='store_true', help='List checks without running them')
    args = parser.parse_args(argv)
    tests = [test for suite, values in SUITES.items()
             if args.suite in (suite, 'all') for test in values]
    if args.list:
        print('\n'.join(tests))
        return 0
    prerequisites = ['git', 'bash', 'node', 'fish', 'jq', 'ruby']
    if args.suite in ('workstation', 'all'):
        prerequisites += ['nvim', 'hx', 'zsh', 'kitty']
    missing = [name for name in prerequisites if not shutil.which(name)]
    if missing:
        print('Missing prerequisites: ' + ', '.join(missing), file=sys.stderr)
        return 1
    logs = Path(tempfile.mkdtemp(prefix='dotfiles-ai-checks-'))
    logs.chmod(0o700)
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', GIT_CONFIG_NOSYSTEM='1',
               GIT_CONFIG_GLOBAL='/dev/null', GIT_AUTHOR_NAME='Fixture',
               GIT_AUTHOR_EMAIL='fixture@example.invalid', GIT_COMMITTER_NAME='Fixture',
               GIT_COMMITTER_EMAIL='fixture@example.invalid')
    for key in list(env):
        if any(part in key for part in ('TOKEN', 'API_KEY', 'PASSWORD', 'SECRET')):
            env.pop(key)
    failures = 0
    for test in tests:
        command = test_command(test)
        started = time.monotonic()
        log = logs / (test + '.log')
        with log.open('w') as output:
            log.chmod(0o600)
            try:
                result = subprocess.run(command, cwd=ROOT, env=env, stdout=output,
                                        stderr=subprocess.STDOUT, timeout=90)
                passed = result.returncode == 0
            except (OSError, subprocess.TimeoutExpired) as error:
                output.write(str(error) + '\n')
                passed = False
        failures += not passed
        print(f"{'PASS' if passed else 'FAIL'} {test} ({time.monotonic() - started:.1f}s)", flush=True)
        if not passed:
            print('\n'.join(log.read_text(errors='replace').splitlines()[-20:]), flush=True)
    print(f'{len(tests) - failures}/{len(tests)} offline checks passed. Logs: {logs}')
    print('Live MCP/authentication, model quality and storefront/native browser acceptance were not tested.')
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
