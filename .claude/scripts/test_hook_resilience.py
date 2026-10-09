#!/usr/bin/env python3
"""Run isolated CLI/PR failure checks: python3 .claude/scripts/test_hook_resilience.py"""
import json
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile

SCRIPTS = Path(__file__).resolve().parent

with tempfile.TemporaryDirectory(prefix='hook-resilience-') as folder:
    root = Path(folder)
    binary = root / 'bin'
    binary.mkdir()
    env = dict(os.environ, PATH=str(binary) + os.pathsep + os.environ['PATH'],
               TMPDIR=str(root), MOCK_ROOT=str(root), THEME_CHECK_THROTTLE='0')

    def executable(name, body):
        path = binary / name
        path.write_text('#!/usr/bin/env bash\n' + body)
        path.chmod(0o755)

    executable('shopify', '''printf 'scan\n' >> "$MOCK_ROOT/scans"
if [ -n "${MOCK_APPEND_FILE:-}" ]; then
  printf '%s\t%s\n' "$MOCK_THEME" "$MOCK_APPEND_FILE" >> "$MOCK_ROOT/.theme-check-pending-test"
fi
cat "$MOCK_ROOT/report.json"
exit "${MOCK_EXIT:-0}"
''')
    executable('git', '''case "$*" in
  'rev-parse --is-inside-work-tree') printf true;;
  'rev-parse --abbrev-ref HEAD') printf '%s' "${MOCK_BRANCH:-feature/test}";;
  'status --porcelain') [ "${MOCK_DIRTY:-0}" = 0 ] || printf ' M source.js\n';;
  'rev-parse --abbrev-ref @{u}') [ "${MOCK_UPSTREAM:-1}" = 1 ] || exit 1; printf origin/feature/test;;
  'rev-list --left-right --count @{u}...HEAD') printf '0 %s' "${MOCK_AHEAD:-0}";;
  'rev-list --count HEAD') printf 10;;
  'rev-parse --verify refs/remotes/origin/HEAD') printf baseline;;
  'rev-list --count refs/remotes/origin/HEAD..HEAD') printf '%s' "${MOCK_AHEAD:-0}";;
  'rev-parse --show-toplevel') printf '%s' "$MOCK_ROOT";;
  *) exit 1;;
esac
''')
    executable('gh', '''printf 'lookup\n' >> "$MOCK_ROOT/lookups"
printf '%s' "${MOCK_PR:-0}"
exit "${MOCK_GH_EXIT:-0}"
''')

    def run(script, *args, payload=None, **extra):
        return subprocess.run(['bash', str(SCRIPTS / script), *args],
                              input=json.dumps(payload or {}), text=True,
                              capture_output=True, env=dict(env, **extra), timeout=5)

    theme = root / 'theme'
    (theme / 'config').mkdir(parents=True)
    (theme / 'sections').mkdir()
    (theme / 'config/settings_schema.json').write_text('{}')
    liquid = theme / 'sections/a.liquid'
    liquid.write_text('')
    report = root / 'report.json'
    pending = root / '.theme-check-pending-test'
    edit = {'session_id': 'test', 'tool_input': {'file_path': str(liquid)}}
    stop = {'session_id': 'test'}

    for output, status in [('', '1'), ('not JSON', '1'), ('{}', '0'),
                           ('[{"path":"a","offenses":null}]', '0'),
                           ('[]', '127'), ('[]', '142')]:
        report.write_text(output)
        result = run('theme-check-hook.sh', payload=edit, MOCK_EXIT=status)
        assert result.returncode == 0 and not result.stderr, result
        assert 'remain queued' in json.loads(result.stdout)['systemMessage']
        assert str(liquid) in pending.read_text()
        result = run('theme-check-hook.sh', 'stop', payload=stop, MOCK_EXIT=status)
        assert result.returncode == 0 and str(liquid) in pending.read_text()

    scans = (root / 'scans').read_text()
    result = run('theme-check-hook.sh', 'stop', payload=dict(stop, stop_hook_active=True))
    assert result.returncode == 0 and (root / 'scans').read_text() == scans
    report.write_text(json.dumps([{'path': str(liquid), 'offenses': [
        {'severity': 'error', 'start_row': 0, 'check': 'BadLiquid', 'message': 'broken'}]}]))
    added = theme / 'sections/b.liquid'
    added.write_text('')
    result = run('theme-check-hook.sh', 'stop', payload=stop, MOCK_EXIT='1',
                 MOCK_THEME=str(theme), MOCK_APPEND_FILE=str(added))
    assert result.returncode == 2 and 'BadLiquid' in result.stderr
    assert str(liquid) not in pending.read_text() and str(added) in pending.read_text()
    report.write_text('[]')
    result = run('theme-check-hook.sh', 'stop', payload=stop)
    assert result.returncode == 0 and not result.stdout and not pending.read_text().strip()

    # A repeat edit during the scan must survive retirement of its first entry.
    result = run('theme-check-hook.sh', payload=edit, MOCK_THEME=str(theme), MOCK_APPEND_FILE=str(liquid))
    assert result.returncode == 0 and str(liquid) in pending.read_text()
    result = run('theme-check-hook.sh', 'stop', payload=stop)
    assert result.returncode == 0 and not pending.read_text().strip()
    # Real concurrent hook processes append without losing queue entries.
    with ThreadPoolExecutor(max_workers=4) as pool:
        outcomes = list(pool.map(lambda _: run('theme-check-hook.sh', payload=edit,
                                              THEME_CHECK_THROTTLE='600'), range(12)))
    assert all(outcome.returncode == 0 for outcome in outcomes)
    lines = pending.read_text().splitlines()
    assert len(lines) == 12 and len(set(lines)) == 12
    result = run('theme-check-hook.sh', 'stop', payload=stop)
    assert result.returncode == 0 and not pending.read_text().strip()

    def lookups():
        path = root / 'lookups'
        return len(path.read_text().splitlines()) if path.exists() else 0

    def clear_cache():
        for path in root.glob('.git-handover-pr-*'):
            path.unlink()

    result = run('git-handover-check.sh')
    assert result.returncode == 0 and not result.stdout and lookups() == 0
    result = run('git-handover-check.sh', MOCK_UPSTREAM='0')
    assert result.returncode == 0 and lookups() == 0
    for trigger in [dict(MOCK_DIRTY='1'), dict(MOCK_AHEAD='1'),
                    dict(MOCK_UPSTREAM='0', MOCK_AHEAD='1')]:
        clear_cache()
        before = lookups()
        first = run('git-handover-check.sh', **trigger, MOCK_GH_EXIT='1')
        second = run('git-handover-check.sh', **trigger, MOCK_GH_EXIT='1')
        assert first.returncode == second.returncode == 0 and lookups() == before + 1
        assert 'no open PR' not in first.stdout
        assert next(root.glob('.git-handover-pr-*')).read_text() == 'skip'
    clear_cache()
    result = run('git-handover-check.sh', MOCK_DIRTY='1')
    assert result.returncode == 0 and 'no open PR' in json.loads(result.stdout)['systemMessage']
    before = lookups()
    result = run('git-handover-check.sh', MOCK_DIRTY='1', MOCK_BRANCH='main')
    assert result.returncode == 0 and lookups() == before

    # Count real parser launches, including the fallback transcript pass.
    jq = shutil.which('jq')
    assert jq, 'jq is required for hook checks'
    executable('jq', 'printf "parse\\n" >> "$MOCK_ROOT/parses"\nexec ' + shlex.quote(jq) + ' "$@"\n')
    parses = root / 'parses'
    transcript = root / 'transcript with spaces.jsonl'
    silent = {'type': 'assistant', 'message': {'content': [{'type': 'thinking', 'thinking': 'silent'}]}}
    transcript.write_text(json.dumps(silent) + '\n')
    base = {'hook_event_name': 'Stop', 'transcript_path': str(transcript)}

    def completion(payload, status, count):
        parses.write_text('')
        outcome = run('require-visible-output.sh', payload=payload)
        assert outcome.returncode == status, outcome
        assert len(parses.read_text().splitlines()) == count, outcome
        assert not outcome.stdout
        assert ('without a visible response' in outcome.stderr) == (status == 2)

    completion(dict(base, last_assistant_message='Verified result.'), 0, 1)
    completion(dict(base, stop_hook_active=True), 0, 1)
    completion(dict(base, stop_hook_active='true'), 0, 1)
    for event in ('SubagentStop', 'StopFailure'):
        completion(dict(base, hook_event_name=event), 0, 1)
    completion(dict(base, last_assistant_message=' \n\t '), 2, 2)
    completion(base, 2, 2)
    completion({'transcript_path': str(transcript)}, 2, 2)
    completion(dict(base, last_assistant_message=42), 2, 2)
    completion(dict(base, transcript_path=str(root / 'missing')), 0, 1)
    transcript.write_text('')
    completion(base, 0, 1)
    for rows in [
        [{'type': 'user', 'message': {'content': [{'type': 'text', 'text': 'pending'}]}}],
        [{'type': 'user', 'message': {'content': [{'type': 'text', 'text': 'fix'}]}},
         {'type': 'assistant', 'message': {'content': [{'type': 'text', 'text': 'Verified result'}]}},
         {'type': 'user', 'message': {'content': [{'type': 'tool_result', 'content': 'ok'}]}},
         silent],
    ]:
        transcript.write_text(''.join(json.dumps(row) + '\n' for row in rows))
        completion(base, 0, 2)
    # A previous turn's reply must not count towards a silent current turn.
    transcript.write_text(''.join(json.dumps(row) + '\n' for row in [
        {'type': 'assistant', 'message': {'content': [{'type': 'text', 'text': 'Old reply'}]}},
        {'type': 'user', 'message': {'content': [{'type': 'text', 'text': 'new task'}]}},
        silent,
    ]))
    completion(base, 2, 2)
    transcript.write_text('{invalid transcript}\n')
    completion(base, 0, 2)
    for payload in ('{invalid json', 'null', 'false', '[]', '"string"'):
        outcome = subprocess.run(['bash', str(SCRIPTS / 'require-visible-output.sh')],
                                 input=payload, text=True, capture_output=True, env=env, timeout=5)
        assert outcome.returncode == 0 and not outcome.stdout and not outcome.stderr, outcome

print('PASS: unavailable reports retain queues; repeat/concurrent edits survive; PR lookups are relevant and failure-cached; completion guards retain behaviour with one payload parse')
