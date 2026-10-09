#!/usr/bin/env python3
"""Check shortcut routing with a fake Node CLI; never launch Apple automation."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import tomllib

SCRIPTS = Path(__file__).resolve().parent
WRAPPER = SCRIPTS / 'apple-qa.sh'

with tempfile.TemporaryDirectory(prefix='apple-qa-shortcuts-') as td:
    root = Path(td)
    node = root / 'node'
    node.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
with Path(os.environ['QA_CALLS']).open('a') as out:
    out.write(json.dumps(args) + '\\n')
if args[1] == 'preflight':
    print(os.environ['QA_PREFLIGHT'])
    sys.exit(int(os.environ.get('QA_PREFLIGHT_EXIT', '0')))
print('original native failure', file=sys.stderr)
sys.exit(int(os.environ.get('QA_TEST_EXIT', '0')))
''')
    node.chmod(0o755)
    calls_path = root / 'calls.jsonl'
    inventory = {'simulators': {'runtimes': [
        {'version': '9.0', 'identifier': 'ios-9'},
        {'version': '27.0', 'identifier': 'ios-27'},
        {'version': '27.1', 'identifier': 'ios-27-1'},
    ]}}
    env = dict(os.environ, PATH=f'{root}:{os.environ["PATH"]}',
               QA_CALLS=str(calls_path), QA_PREFLIGHT=json.dumps(inventory))

    def run(*args, **extra):
        calls_path.unlink(missing_ok=True)
        result = subprocess.run(['/bin/bash', str(WRAPPER), *args],
                                env=dict(env, **extra), capture_output=True,
                                text=True, timeout=5)
        calls = [json.loads(line) for line in calls_path.read_text().splitlines()] if calls_path.exists() else []
        return result, calls

    def option(call, name):
        return call[call.index(name) + 1]

    result, calls = run('preflight')
    assert result.returncode == 0 and len(calls) == 1
    assert calls[0][1:] == ['preflight', '--driver', 'technology-preview']
    result, calls = run('preflight', QA_PREFLIGHT_EXIT='17')
    assert result.returncode == 17 and len(calls) == 1

    url = "https://preview.example.com/a path?value='$(touch unsafe)'"
    expected = "Men's tee $(touch unsafe)"
    result, calls = run('desktop', '--url', url, '--expect', expected)
    assert result.returncode == 0 and len(calls) == 1
    assert calls[0][1:] == ['test', '--browser', 'safari', '--driver',
                          'technology-preview', '--transport', 'mcp',
                          '--url', url, '--expect', expected]
    result, calls = run('desktop', QA_TEST_EXIT='23')
    assert result.returncode == 23 and 'original native failure' in result.stderr

    result, calls = run('ios', '--url', url, '--expect', expected)
    assert result.returncode == 0 and len(calls) == 2
    assert calls[0][1:] == ['preflight']
    assert option(calls[1], '--runtime') == 'ios-27-1'
    assert option(calls[1], '--transport') == 'xctest'
    assert option(calls[1], '--browser') == 'ios'
    assert option(calls[1], '--boot-timeout') == '900'
    assert option(calls[1], '--url') == url and option(calls[1], '--expect') == expected
    result, calls = run('ios', '--runtime', 'explicit-ios', QA_PREFLIGHT_EXIT='17')
    assert result.returncode == 0 and len(calls) == 1
    assert option(calls[0], '--runtime') == 'explicit-ios'
    result, calls = run('ios', '--runtime=explicit-ios')
    assert result.returncode == 0 and len(calls) == 1
    assert '--runtime=explicit-ios' in calls[0]

    result, calls = run('ios', QA_TEST_EXIT='29')
    assert result.returncode == 29 and len(calls) == 2
    assert 'original native failure' in result.stderr
    assert 'No available iOS runtime' not in result.stderr
    result, calls = run('ios', QA_PREFLIGHT_EXIT='17')
    assert result.returncode == 17 and len(calls) == 1
    result, calls = run('ios', QA_PREFLIGHT='{"simulators":{"runtimes":[]}}')
    assert result.returncode != 0 and len(calls) == 1
    assert 'No available iOS runtime' in result.stderr
    result, calls = run('ios', QA_PREFLIGHT='{"simulators":{"error":"inventory unavailable"}}')
    assert result.returncode != 0 and len(calls) == 1
    assert 'inventory unavailable' in result.stderr
    assert 'No available iOS runtime' not in result.stderr
    result, calls = run('ios', QA_PREFLIGHT='{broken')
    assert result.returncode != 0 and len(calls) == 1

    for mode in ('preflight', 'desktop', 'ios'):
        for args in (('--transport', 'webdriver'), ('--driver=safari',), ('--browser', 'ios')):
            result, calls = run(mode, *args)
            assert result.returncode != 0 and not calls, (mode, args, result.stderr)
    for args in ((), ('--help',), ('help',)):
        result, calls = run(*args)
        assert result.returncode == 0 and not calls
    result, calls = run('unknown')
    assert result.returncode != 0 and not calls
    assert not (SCRIPTS.parents[1] / 'unsafe').exists()

    # Exercise the exact shell actions which-key runs, including failure status.
    menu = tomllib.loads((SCRIPTS.parents[1] / '.config/herdr/whichkey.toml').read_text())
    home = root / 'home'
    (home / '.claude').mkdir(parents=True)
    (home / '.claude/scripts').symlink_to(SCRIPTS)
    for key, transport in (('p', None), ('s', 'mcp'), ('i', 'xctest')):
        calls_path.unlink(missing_ok=True)
        result = subprocess.run(menu['q'][key]['run'], shell=True,
                                executable='/bin/bash', env=dict(env, HOME=str(home), QA_TEST_EXIT='31'),
                                capture_output=True, text=True, timeout=5)
        calls = [json.loads(line) for line in calls_path.read_text().splitlines()]
        assert result.returncode == (0 if transport is None else 31), (key, result.stderr)
        if transport is not None:
            assert option(calls[-1], '--transport') == transport
            assert 'original native failure' in result.stderr

print('PASS: native shortcut routes, numeric runtime choice, literal arguments and preserved failures')
