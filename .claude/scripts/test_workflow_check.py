#!/usr/bin/env python3
"""Run: python3 .claude/scripts/test_workflow_check.py"""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).with_name('workflow-check.py')
spec = importlib.util.spec_from_file_location('checkpoint', SCRIPT)
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)


def fails(call, fragment):
    try:
        call()
    except (ValueError, KeyError) as error:
        assert fragment in str(error), error
    else:
        raise AssertionError(f'Expected failure: {fragment}')


with tempfile.TemporaryDirectory(prefix='workflow-check-test-') as folder:
    root = Path(folder)

    def write(name, value):
        p = root / name
        p.write_text(json.dumps(value) if isinstance(value, dict) else value)
        return str(p)

    def hook(record, event, **extra):
        state = root / 'state.json'
        state.write_text(json.dumps(record))
        if event == 'Stop':
            extra.setdefault('last_assistant_message', 'Done.')
        runtime = record.get('runtime', 'codex')
        payload = dict(session_id='session', agent_id='main', cwd=str(root), hook_event_name=event, **extra)
        return subprocess.run([sys.executable, str(SCRIPT), 'hook', '--state', str(state), '--runtime', runtime],
                              input=json.dumps(payload), text=True, capture_output=True, timeout=5)

    css = write('site.css', '.hero { max-width: clamp(200px, 50vw, 400px); color: red; }\n')
    baseline = w.digest(css)
    before_element = write('before-element.json', {'file_sha256': baseline, 'selector': '.hero', 'measurement': {'width': 400}})
    before_parent = write('before-parent.json', {'file_sha256': baseline, 'selector': '.container', 'measurement': {'width': 1280, 'display': 'flex'}})
    record = {'runtime': 'codex', 'session_id': 'session', 'agent_id': 'main', 'task': 'hero',
              'delegation': {'mode': 'solo', 'reason': 'One local style change'},
              'css': [{'file': css, 'selector': '.hero', 'properties': ['max-width'],
                       'expected': 'Hero remains capped at 400px',
                       'design': {'source': write('design.txt', 'Hero maximum width is 400px'), 'intent': '400px maximum'},
                       'before': {'element': before_element, 'parent': before_parent},
                       'after': {'element': str(root / 'after-element.json'), 'parent': str(root / 'after-parent.json')}}]}
    w.validate(record, preparing=True)
    label_only = write('label-only.json', {'file_sha256': baseline, 'selector': '.hero', 'measurement': {'label': 'checked'}})
    fails(lambda: w.measurement(label_only, baseline, '.hero'), 'finite width or height')
    for invalid in [True, -1, float('nan'), float('inf')]:
        write('label-only.json', {'file_sha256': baseline, 'selector': '.hero', 'measurement': {'width': invalid}})
        fails(lambda: w.measurement(label_only, baseline, '.hero'), 'finite width or height')
    record['_active'] = True
    w.validate(record)
    bad = copy.deepcopy(record)
    bad['css'][0]['before']['element'] = str(root / 'missing.json')
    fails(lambda: w.validate(bad), 'Missing artifact')
    bad = copy.deepcopy(record)
    bad['css'][0]['selector'] = '.other'
    fails(lambda: w.validate(bad), 'selector differs')
    changed = dict(tool_name='Edit', tool_input={'file_path': css, 'old_string': '400px', 'new_string': '500px'})
    assert hook(record, 'PreToolUse', **changed).returncode == 0
    Path(before_element).write_text('{}')
    assert hook(record, 'PreToolUse', **changed).returncode == 2
    same_file = copy.deepcopy(record)
    second_target = copy.deepcopy(record['css'][0])
    second_target['properties'] = ['min-height']
    same_file['css'].append(second_target)
    assert hook(same_file, 'PreToolUse', **changed).returncode == 2
    unchanged = dict(tool_name='Edit', tool_input={'file_path': css, 'old_string': 'red', 'new_string': 'blue'})
    assert hook(record, 'PreToolUse', **unchanged).returncode == 0
    write('before-element.json', {'file_sha256': baseline, 'selector': '.hero', 'measurement': {'width': 400}})
    removal = dict(tool_name='Write', tool_input={'file_path': css, 'content': '.hero { color: red; }\n'})
    assert hook(record, 'PreToolUse', **removal).returncode == 0
    bad = copy.deepcopy(record)
    bad['css'][0].pop('expected')
    assert hook(bad, 'PreToolUse', **removal).returncode == 2
    patch = '*** Begin Patch\n*** Update File: site.css\n@@\n-.hero { max-width: clamp(200px, 50vw, 400px); color: red; }\n+.hero { max-width: clamp(200px, 50vw, 500px); color: red; }\n*** End Patch\n'
    assert hook(record, 'PreToolUse', tool_name='apply_patch', tool_input={'command': patch}).returncode == 0
    assert hook(bad, 'PreToolUse', tool_name='apply_patch', tool_input={'command': patch}).returncode == 2
    multiline = str(Path(write('multi.css', '.hero {\n  max-width: clamp(\n    200px, 50vw, 400px\n  );\n}\n')).resolve())
    reconstructed = list(w.patch_contents('*** Begin Patch\n*** Update File: multi.css\n@@\n   max-width: clamp(\n-    200px, 50vw, 400px\n+    200px, 50vw, 500px\n   );\n*** End Patch\n', {multiline}, root))[0]
    assert w.declarations(reconstructed[1], ['max-width']) != w.declarations(reconstructed[2], ['max-width'])
    assert hook(record, 'Stop', stop_hook_active=False).returncode == 2
    assert hook(record, 'Stop', stop_hook_active=True).returncode == 0
    worker = copy.deepcopy(record)
    worker['agent_id'] = 'worker'
    assert hook(worker, 'Stop', stop_hook_active=False).returncode == 0
    inactive = copy.deepcopy(record)
    inactive['_active'] = False
    assert hook(inactive, 'Stop', stop_hook_active=False).returncode == 0
    assert hook(record, 'PreToolUse', tool_name='Agent', tool_input={'prompt': 'anything'}).returncode == 2
    assert hook(record, 'PreToolUse', tool_name='Task', tool_input={'prompt': 'anything'}).returncode == 2
    plan = {'id': 'reader', 'scope': 'Read site.css only', 'deliverable': 'Report one finding', 'stop': 'Stop after one pass',
            'prompt': 'Read site.css only. Report one finding. Stop after one pass.',
            'result': write('worker.txt', 'No issue found'), 'review': str(root / 'worker-review.json')}
    parallel = {'runtime': 'codex', 'session_id': 'session', 'task': 'review', '_active': True,
                'delegation': {'mode': 'parallel', 'reason': 'Independent review', 'workers': [plan]}}
    assert hook(parallel, 'PreToolUse', tool_name='spawn_agent', tool_input={'message': plan['prompt']}).returncode == 0
    assert hook(parallel, 'PreToolUse', tool_name='Task', tool_input={'prompt': plan['prompt']}).returncode == 0
    assert hook(parallel, 'PreToolUse', tool_name='spawn_agent', tool_input={'message': 'Rephrased bounded assignment'}).returncode == 0
    pending = copy.deepcopy(parallel)
    pending['delegation']['workers'][0]['pending_agent'] = 'review-worker'
    waiting = hook(pending, 'Stop', stop_hook_active=False)
    assert waiting.returncode == 0
    assert hook(pending, 'Stop', stop_hook_active=True).returncode == 0
    w.validate(pending, final=True)
    w.validate(parallel, final=True)
    draft = write('draft.md', 'The AU preview shows the correct price of $20.00.')
    source = write('source.txt', 'AU preview price screenshot and browser result')
    client = {'runtime': 'codex', 'session_id': 'session', 'task': 'client', 'client': {
        'draft': draft, 'market': 'AU', 'scope': 'AU guest preview', 'review': str(root / 'client-review.json'),
        'claims': [{'text': 'The AU preview shows the correct price of $20.00.', 'source': source, 'market': 'AU', 'status': 'verified'}]}}
    w.validate(client, preparing=True)
    fails(lambda: w.validate(client, final=True), 'Missing artifact')
    client['_active'] = True
    assert hook(client, 'Stop', stop_hook_active=False).returncode == 2
    for runtime in ('claude', 'codex'):
        real_record = dict(client, runtime=runtime)
        for reply in ('The reviewer is running; I am waiting for its findings.',
                      'Here are the time entry notes.', 'I am checking the source thread.'):
            assert hook(real_record, 'Stop', last_assistant_message=reply).returncode == 0
        assert hook(real_record, 'Stop', last_assistant_message='Here is the final draft.').returncode == 2
        assert hook(real_record, 'Stop', last_assistant_message=Path(draft).read_text()).returncode == 2
    claude_transcript = write('claude.jsonl', json.dumps({'type': 'assistant', 'message': {
        'content': [{'type': 'text', 'text': 'The reviewer is running.'}]}}) + '\n')
    codex_transcript = write('codex.jsonl', json.dumps({'type': 'response_item', 'payload': {
        'type': 'message', 'role': 'assistant', 'phase': 'final',
        'content': [{'type': 'output_text', 'text': 'Done.'}]}}) + '\n')
    assert not w.completion_claim({'transcript_path': claude_transcript}, client)
    assert w.completion_claim({'transcript_path': codex_transcript}, client)
    assert not w.completion_claim({'last_assistant_message': 'Waiting for review.',
                                  'transcript_path': codex_transcript}, client)
    assert not w.completion_claim({'transcript_path': str(root / 'missing.jsonl')}, client)
    old_completion = Path(codex_transcript).read_text()
    write('codex.jsonl', old_completion + json.dumps({'type': 'response_item', 'payload': {
        'type': 'message', 'role': 'assistant', 'phase': 'commentary',
        'content': [{'type': 'output_text', 'text': 'Waiting for the reviewer.'}]}}) + '\n')
    assert not w.completion_claim({'transcript_path': codex_transcript}, client)
    for runtime, command in [('claude', '/time-entries'), ('codex', '/time-entries')]:
        user_entry = {'type': 'user', 'message': {'content': [{'type': 'text', 'text': command}]}} \
            if runtime == 'claude' else {'type': 'response_item', 'payload': {'type': 'message',
                'role': 'user', 'content': [{'type': 'input_text', 'text': command}]}}
        tool_reply = {'type': 'user', 'message': {'content': [{'type': 'tool_result',
                       'tool_use_id': 'worklog-read', 'content': 'Exit code 0'}]}}
        transcript = write('latest-request.jsonl', json.dumps(user_entry) + '\n' + json.dumps(tool_reply) + '\n')
        payload = {'last_assistant_message': 'Done, here are time entries.', 'transcript_path': transcript}
        assert hook(dict(client, runtime=runtime), 'Stop', **payload).returncode == 0
        payload['last_assistant_message'] += '\n' + Path(draft).read_text()
        assert hook(dict(client, runtime=runtime), 'Stop', **payload).returncode == 2
        later_user = {'type': 'user', 'message': {'content': 'Finish the handover'}} \
            if runtime == 'claude' else {'type': 'response_item', 'payload': {'type': 'message',
                'role': 'user', 'content': [{'type': 'input_text', 'text': 'Finish the handover'}]}}
        write('latest-request.jsonl', json.dumps(user_entry) + '\n' + json.dumps(later_user) + '\n')
        assert hook(dict(client, runtime=runtime), 'Stop', last_assistant_message='Done.',
                    transcript_path=transcript).returncode == 2
    write('codex.jsonl', old_completion + json.dumps({'type': 'response_item', 'payload': {
        'type': 'message', 'role': 'user', 'content': [{'type': 'input_text', 'text': '/time-entries'}]}}) + '\n')
    assert not w.completion_claim({'transcript_path': codex_transcript}, client)
    write('claude.jsonl', 'x' * 150000 + '\n' + json.dumps({'type': 'assistant', 'message': {
        'content': [{'type': 'text', 'text': 'Done.'}]}}) + '\n')
    assert w.completion_claim({'transcript_path': claude_transcript}, client)
    client_review = {'artifact_sha256': w.digest(draft), 'scope': 'AU guest preview', 'reviewer': 'reviewer', 'verdict': 'pass', 'notes': 'Claim compared with browser evidence',
                     'evidence_sha256': {str(Path(source).resolve()): w.digest(source)}}
    write('client-review.json', client_review)
    w.validate(client, final=True)
    Path(source).write_text('Changed supporting evidence')
    w.validate(client, final=True)
    renewed = copy.deepcopy(client)
    renewed.pop('_hashes', None)
    w.validate(renewed, preparing=True)
    # Extra evidence and legacy evidence maps do not block completion.
    renewed['client']['evidence'] = [write('template.json', {'sections': {}})]
    w.validate(renewed, final=True)
    client = renewed
    scoped = copy.deepcopy(client)
    scoped['client']['claims'][0]['market'] = 'US'
    fails(lambda: w.validate(scoped), 'market differs')
    multi = copy.deepcopy(client)
    multi['client']['market'] = ['AU', 'US']
    w.validate(multi, final=True)
    multi['client']['claims'][0]['market'] = ['AU', 'US']
    w.validate(multi, final=True)
    multi['client']['claims'][0]['market'] = ['AU', 'NZ']
    fails(lambda: w.validate(multi), 'market differs')
    multi['client']['market'] = []
    fails(lambda: w.validate(multi), 'nonempty array')
    Path(draft).write_text('Changed claim')
    fails(lambda: w.validate(client, final=True), 'check the changed lines')
    fails(lambda: w.recheck(client['client']['review'], draft, 'main', 'factual', 'main', 'Changed claim'),
          'independent checker')
    w.recheck(client['client']['review'], draft, 'main', 'factual', 'reviewer', 'Checked the revised claim against evidence')
    w.validate(client, final=True)
    Path(draft).write_text('Changed claim.')
    w.recheck(client['client']['review'], draft, 'main', 'wording', 'main', 'Punctuation only; meaning preserved')
    w.validate(client, final=True)
    material = w.load(client['client']['review'])
    material['unresolved_material'] = ['Wrong target theme']
    write('client-review.json', material)
    fails(lambda: w.validate(client, final=True), 'Unresolved material')
    assert hook(client, 'Stop', stop_hook_active=False).returncode == 2
    fails(lambda: w.recheck(client['client']['review'], draft, 'main', 'wording', 'main', 'Punctuation'),
          'Resolve material findings')
    assert hook(client, 'Stop', last_assistant_message='The reviewer is running.').returncode == 0
    fails(lambda: w.recheck(client['client']['review'], draft, 'main', 'suggested-fixes', 'main', 'Applied fixes'),
          'explicit suggested fix')
    prescribed = dict(material, verdict='changes', unresolved_material=[{
        'issue': 'Wrong target theme', 'suggested_fix': 'Name the Duplicate theme explicitly'}])
    write('client-review.json', prescribed)
    w.recheck(client['client']['review'], draft, 'main', 'suggested-fixes', 'main',
              'Applied the reviewer\'s specified theme correction and checked the changed line')
    w.validate(client, final=True)
    assert w.load(client['client']['review'])['addressed_material'] == prescribed['unresolved_material']
    material['unresolved_material'] = []
    material['verdict'] = 'fail'
    write('client-review.json', material)
    fails(lambda: w.validate(client, final=True), 'has not passed')
    material['verdict'] = 'pass'
    material['optional'] = ['Consider a shorter opening']
    write('client-review.json', material)
    client['_active'] = True
    assert hook(client, 'Stop', stop_hook_active=False).returncode == 0
    required = {'runtime': 'codex', 'session_id': 'session', 'task': 'risky-change',
                'reviews': [{'artifact': draft, 'scope': 'AU guest preview', 'review': client['client']['review']}]}
    w.validate(required, final=True)
    own = copy.deepcopy(material)
    own['reviewer'] = 'main'
    write('client-review.json', own)
    fails(lambda: w.validate(required, final=True), 'separate reviewer')
    write('client-review.json', material)
    Path(draft).write_text('Changed claim!')
    command = [sys.executable, str(SCRIPT), 'recheck', '--record', client['client']['review'],
               '--artifact', draft, '--change-kind', 'wording', '--checked-by', 'main',
               '--reason', 'Checked punctuation only; facts and qualifiers preserved']
    checked = subprocess.run(command, text=True, capture_output=True, timeout=5)
    assert checked.returncode == 0, checked.stderr
    w.validate(client, final=True)
    assert w.load(client['client']['review'])['optional'] == material['optional']
    for prose in ['A\u2014B', 'Per your instruction, this is ready.', 'Certainly! Here is your draft.']:
        Path(draft).write_text(prose)
        candidate = copy.deepcopy(client)
        candidate.pop('_hashes', None)
        candidate['client']['claims'] = []
        fails(lambda: w.validate(candidate, preparing=True), 'Draft contains')
    acknowledgement = {'runtime': 'claude', 'session_id': 'session', 'task': 'acknowledgement',
                       'client': {'draft': write('ack.md', 'Thanks, I will check this.'), 'market': 'AU',
                                  'scope': 'AU merchant acknowledgement', 'claims': []}}
    w.validate(acknowledgement, preparing=True)
    fails(lambda: w.validate(acknowledgement, final=True), 'recorded reread')
    acknowledgement['client']['reread'] = True
    w.validate(acknowledgement, final=True)
    Path(css).write_text('.hero { max-width: 500px; color: red; }\n')
    fails(lambda: w.validate(record), 'baseline changed')
    assert hook(record, 'PreToolUse', tool_name='Edit',
                tool_input={'file_path': css, 'old_string': '500px', 'new_string': '600px'}).returncode == 2
    combined = copy.deepcopy(record)
    combined['delegation'] = parallel['delegation']
    assert hook(combined, 'PreToolUse', tool_name='Agent', tool_input={'prompt': plan['prompt']}).returncode == 0
    current = w.digest(css)
    write('after-element.json', {'file_sha256': current, 'selector': '.hero', 'measurement': {'width': 500}})
    write('after-parent.json', {'file_sha256': current, 'selector': '.container', 'measurement': {'width': 1280}})
    w.validate(record, final=True)
    write('after-element.json', '[]')
    assert hook(record, 'Stop', stop_hook_active=False).returncode == 2
    write('after-element.json', {'file_sha256': current, 'selector': '.hero', 'measurement': {'width': 500}})
    updated = copy.deepcopy(record)
    updated.pop('_hashes')
    updated['css'][0]['before'] = updated['css'][0]['after'].copy()
    w.validate(updated, preparing=True)
    w.validate(updated)
    assert updated['css'][0]['_baseline'] == current
    Path(css).write_text('.hero { max-width: 600px; }\n')
    fails(lambda: w.validate(record, final=True), 'Stale measurement')
    assert hook(record, 'Stop', stop_hook_active=True).returncode == 0
    fails(lambda: w.file(root / '.env'), 'Environment files')
    start = hook(record, 'SessionStart')
    assert start.returncode == 0 and 'session_id=session' in start.stdout
    task = write('task.json', {'runtime': 'claude', 'session_id': 'other', 'task': 'solo',
                              'delegation': {'mode': 'solo', 'reason': 'Small local edit'}})
    state = root / 'cli-state.json'
    for action in ['prepare', 'check', 'final', 'complete']:
        command = [sys.executable, str(SCRIPT), action, '--state', str(state)]
        if action == 'prepare':
            command += ['--record', task]
        result = subprocess.run(command, text=True, capture_output=True, timeout=5)
        assert result.returncode == 0, result.stderr
    assert not json.loads(state.read_text())['_active']
    assert json.loads(state.read_text())['_outcome'] == 'passed'
    blocked_state = root / 'blocked-state.json'
    blocked_state.write_text(json.dumps(record))
    missing_reason = subprocess.run([sys.executable, str(SCRIPT), 'abandon', '--state', str(blocked_state)],
                                    text=True, capture_output=True, timeout=5)
    assert missing_reason.returncode == 1 and json.loads(blocked_state.read_text())['_active']
    abandoned = subprocess.run([sys.executable, str(SCRIPT), 'abandon', '--state', str(blocked_state),
                                '--reason', 'Storefront preview unavailable, after evidence cannot be captured'],
                               text=True, capture_output=True, timeout=5)
    result = json.loads(blocked_state.read_text())
    assert abandoned.returncode == 0 and not result['_active'] and result['_outcome'] == 'abandoned'
    assert 'preview unavailable' in result['_abandoned_reason']

print('PASS: selective reviews, targeted rechecks, material findings, CSS measurements, draft style and Stop loop safety')
