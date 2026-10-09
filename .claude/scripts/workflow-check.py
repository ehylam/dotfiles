#!/usr/bin/env python3
"""Explicit task checkpoints. Workflow evidence, not a security boundary."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile


def require(condition, message):
    if not condition:
        raise ValueError(message)


def text(value):
    return isinstance(value, str) and bool(value.strip())


def markets(value):
    values = [value] if isinstance(value, str) else value
    require(isinstance(values, list) and values and all(text(v) for v in values),
            'Market must be a name or nonempty array of names')
    return set(values)


def file(path):
    p = Path(path).expanduser().resolve()
    require(not p.name.startswith('.env'), 'Environment files are outside checkpoint scope')
    require(p.is_file(), f'Missing artifact: {p}')
    return p


def digest(path):
    return hashlib.sha256(file(path).read_bytes()).hexdigest()


def load(path):
    value = json.loads(file(path).read_text())
    require(isinstance(value, dict), f'Artifact must be a JSON object: {path}')
    return value


def state_path(runtime, session, agent='main'):
    key = hashlib.sha256(f'{runtime}\0{session}\0{agent}'.encode()).hexdigest()
    return Path(tempfile.gettempdir()) / 'workflow-check' / f'{key}.json'


def save(path, record):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.checkpoint-')
    try:
        with os.fdopen(fd, 'w') as out:
            json.dump(record, out, indent=2)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def identity(record):
    return record['runtime'], record['session_id'], record.get('agent_id', 'main')


def remember(record, path):
    record.setdefault('_hashes', {})[str(file(path))] = digest(path)


def measurement(path, sha, selector=None):
    proof = load(path)
    require(proof.get('file_sha256') == sha, f'Stale measurement: {path}')
    require(text(proof.get('selector')), f'Measurement needs selector: {path}')
    if selector:
        require(proof['selector'] == selector, f'Measurement selector differs: {path}')
    require(isinstance(proof.get('measurement'), dict) and proof['measurement'],
            f'Measurement needs recorded values: {path}')
    require(any(type(proof['measurement'].get(key)) in (int, float)
                and math.isfinite(proof['measurement'][key]) and proof['measurement'][key] >= 0
                for key in ('width', 'height')), f'Measurement needs a finite width or height: {path}')


def review(path, artifact, scope, author):
    result = load(path)
    require(result.get('artifact_sha256') == digest(artifact),
            f'Draft changed after review; check the changed lines and run recheck: {path}')
    require(result.get('scope') == scope, f'Review scope differs: {path}')
    require(result.get('verdict') == 'pass', f'Reviewer has not passed: {path}')
    require(text(result.get('reviewer')) and result['reviewer'] != author,
            f'Review needs a separate reviewer identity: {path}')
    require(text(result.get('notes')), f'Review needs findings or rationale: {path}')
    require(not result.get('unresolved_material'), f'Unresolved material review findings: {path}')


def recheck(path, artifact, author, kind, checker, reason):
    """Record a targeted check, retaining the original independent review."""
    result = load(path)
    require(text(result.get('reviewer')) and result['reviewer'] != author,
            'Recheck requires an existing independent review')
    require(text(reason) and text(checker), 'Recheck needs checked-by and a reason describing the checked changes')
    require(kind in ('wording', 'factual', 'suggested-fixes'), 'Recheck needs wording, factual or suggested-fixes change-kind')
    if kind == 'suggested-fixes':
        require(result.get('verdict') in ('pass', 'changes'), 'Suggested fixes need a completed review')
        findings = result.get('unresolved_material', [])
        require(all(isinstance(item, dict) and text(item.get('suggested_fix')) for item in findings),
                'Each material finding needs the reviewer\'s explicit suggested fix')
        result['addressed_material'] = result.get('addressed_material', []) + findings
        result['unresolved_material'] = []
        result['verdict'] = 'pass'
    else:
        require(result.get('verdict') == 'pass' and not result.get('unresolved_material'),
                'Resolve material findings with the reviewer before recheck')
    require(kind != 'factual' or checker != author, 'Factual changes need an independent checker')
    result.setdefault('rechecks', []).append({'kind': kind, 'checked_by': checker, 'notes': reason})
    result['artifact_sha256'] = digest(artifact)
    save(Path(path).expanduser().resolve(), result)


STYLE = re.compile(r'\u2014|\b(?:per your instruction|as requested above|draft without sending|'
                   r'do not publish|happy to help)\b|\b(?:bottom line:|in short:|certainly[,!])', re.I)


def validate(record, final=False, preparing=False):
    require(record.get('runtime') in ('claude', 'codex'), 'runtime must be claude or codex')
    require(text(record.get('session_id')) and text(record.get('task')), 'Task and session_id are required')
    require(any(record.get(k) for k in ('delegation', 'css', 'client', 'reviews')), 'No checkpoint requirements recorded')
    # Keep immutable CSS prerequisites, but discard legacy draft/evidence hashes.
    css_sources = {str(Path(p).expanduser().resolve()) for target in record.get('css', [])
                   for p in [target.get('design', {}).get('source', ''), *target.get('before', {}).values()]
                   if p and not re.match(r'https?://', p)}
    for path, sha in record.get('_hashes', {}).items():
        if path not in css_sources:
            continue
        require(digest(path) == sha, f'Artifact changed since prepare: {path}')
    delegation = record.get('delegation')
    if delegation:
        require(delegation.get('mode') in ('solo', 'parallel') and text(delegation.get('reason')),
                'Delegation needs solo/parallel and a reason')
        workers = delegation.get('workers', [])
        require(isinstance(workers, list), 'workers must be an array')
        require(bool(workers) == (delegation['mode'] == 'parallel'), 'Parallel needs workers; solo needs none')
        require(len({w['id'] for w in workers}) == len(workers), 'Worker IDs must be unique')
        for worker in workers:
            require(all(text(worker.get(k)) for k in ('id', 'scope', 'deliverable', 'stop', 'prompt')),
                    'Worker needs id, scope, deliverable, stop and prompt')
    for required in record.get('reviews', []):
        if final:
            review(required['review'], required['artifact'], required['scope'], record.get('agent_id', 'main'))
    for target in record.get('css', []):
        path = str(file(target['file']))
        target['file'] = path
        require(text(target.get('selector')) and text(target.get('expected')), 'CSS needs selector and expected behaviour')
        properties = target.get('properties')
        require(isinstance(properties, list) and properties and all(re.fullmatch(r'[a-z-]+', p) for p in properties),
                'CSS properties must be an explicit nonempty array')
        design = target.get('design', {})
        require(text(design.get('source')) and text(design.get('intent')), 'CSS needs design source and extracted intent')
        if not re.match(r'https?://', design['source']):
            if preparing:
                remember(record, design['source'])
            else:
                file(design['source'])
        if preparing:
            target['_baseline'] = digest(path)
        require(text(target.get('_baseline')), 'CSS baseline missing; run prepare')
        if not final:
            require(digest(path) == target['_baseline'], f'CSS baseline changed; measure again and prepare: {path}')
        for side in ('element', 'parent'):
            before = target['before'][side]
            measurement(before, target['_baseline'], target['selector'] if side == 'element' else None)
            if preparing:
                remember(record, before)
            if final:
                measurement(target['after'][side], digest(path), target['selector'] if side == 'element' else None)
    client = record.get('client')
    if client:
        draft = file(client['draft']).read_text()
        require(text(client.get('scope')), 'Client draft needs scope')
        covered_markets = markets(client.get('market'))
        require(not STYLE.search(draft), 'Draft contains an em dash, instruction leak or prohibited stock phrasing')
        require(isinstance(client.get('claims'), list), 'Client claims must be an array, including when empty')
        for claim in client['claims']:
            require(text(claim.get('text')), 'Claim needs a description')
            require(markets(claim.get('market')).issubset(covered_markets), 'Claim market differs from draft market')
            require(claim.get('status') in ('verified', 'proposed'), 'Claim status must be verified or proposed')
            file(claim['source'])
        for source in client.get('evidence', []):
            file(source)
        if final and client['claims']:
            review(client['review'], client['draft'], client['scope'], record.get('agent_id', 'main'))
        elif final:
            require(client.get('reread') is True, 'Acknowledgement needs a recorded reread')


def declarations(content, properties):
    content = re.sub(r'/\*.*?\*/', '', content, flags=re.S)
    return {p: re.findall(r'(?<![\w-])' + re.escape(p) + r'\s*:\s*([^;}]+)', content)
            for p in properties}


def patch_contents(patch, registered, cwd):
    """Reconstruct only registered update hunks with exact context matching."""
    sections = re.split(r'^\*\*\* (Update|Delete|Add) File: (.+)\n', patch, flags=re.M)
    for i in range(1, len(sections), 3):
        kind, name, body = sections[i:i + 3]
        path = str((Path(cwd) / name).resolve())
        if path not in registered:
            continue
        old = file(path).read_text()
        if kind == 'Delete':
            yield path, old, ''
            continue
        require(kind == 'Update' and '*** Move to:' not in body, 'Registered CSS file moves need a new checkpoint')
        proposed = old
        cursor = 0
        for hunk in re.split(r'^@@[^\n]*\n', body, flags=re.M):
            removed, added = [], []
            for line in hunk.splitlines(keepends=True):
                if line.startswith('*** '):
                    break
                if line.startswith((' ', '-')):
                    removed.append(line[1:])
                if line.startswith((' ', '+')):
                    added.append(line[1:])
            if not removed and not added:
                continue
            before, after = ''.join(removed), ''.join(added)
            at = proposed.find(before, cursor)
            if at < 0 and before.endswith('\n'):
                before, after = before[:-1], after.removesuffix('\n')
                at = proposed.find(before, cursor)
            require(at >= 0, f'Cannot reconstruct registered CSS patch: {path}')
            proposed = proposed[:at] + after + proposed[at + len(before):]
            cursor = at + len(after)
        yield path, old, proposed


def pretool(record, hook):
    name, inp = hook.get('tool_name'), hook.get('tool_input') or {}
    if name in ('Agent', 'Task', 'spawn_agent') and record.get('delegation'):
        validate({k: record[k] for k in ('runtime', 'session_id', 'task', 'delegation')})
        decision = record['delegation']
        require(decision['mode'] == 'parallel', 'Task records solo work; update the delegation decision before spawning')
    targets = {}
    for target in record.get('css', []):
        targets.setdefault(str(Path(target['file']).resolve()), set()).update(target['properties'])
    changes = []
    if name in ('Edit', 'Write'):
        path = str((Path(hook.get('cwd') or os.getcwd()) / inp.get('file_path', '')).resolve())
        if path in targets:
            old = file(path).read_text()
            if name == 'Write':
                proposed = inp['content']
            else:
                require(inp.get('old_string') in old, 'Cannot reconstruct registered CSS edit')
                proposed = old.replace(inp['old_string'], inp['new_string'], -1 if inp.get('replace_all') else 1)
            changes.append((path, old, proposed))
    elif name == 'apply_patch':
        changes = patch_contents(inp.get('command', ''), targets, hook.get('cwd') or os.getcwd())
    for path, old, proposed in changes:
        properties = targets[path]
        if declarations(old, properties) != declarations(proposed, properties):
            validate(record)


def transcript_tail(payload):
    path = payload.get('transcript_path')
    if not text(path) or Path(path).name.startswith('.env'):
        return []
    try:
        with Path(path).open('rb') as stream:
            stream.seek(0, os.SEEK_END)
            size = stream.tell()
            start = max(0, size - 131072)
            stream.seek(start)
            lines = stream.read().decode('utf-8', errors='replace').splitlines()
        if start:
            lines = lines[1:]
        entries = []
        for line in reversed(lines):
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if isinstance(entry, dict):
                entries.append(entry)
        return entries
    except (OSError, ValueError, TypeError):
        return []


def last_reply(payload):
    """Prefer Stop's reply; fall back to a bounded tail for older runtimes."""
    if isinstance(payload.get('last_assistant_message'), str):
        return payload['last_assistant_message']
    try:
        for entry in transcript_tail(payload):
            message = entry.get('message', {}) if entry.get('type') == 'assistant' else entry.get('payload', {})
            if entry.get('type') == 'user' or (entry.get('type') == 'response_item'
                    and message.get('type') == 'message' and message.get('role') == 'user'):
                return ''
            if entry.get('type') == 'response_item' and message.get('role') == 'assistant' \
                    and message.get('phase') == 'commentary':
                return ''
            if entry.get('type') != 'assistant' and not (
                    entry.get('type') == 'response_item' and message.get('type') == 'message'
                    and message.get('role') == 'assistant' and message.get('phase') != 'commentary'):
                continue
            content = message.get('content', [])
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                reply = '\n'.join(item.get('text', '') for item in content
                                  if isinstance(item, dict) and item.get('type') in ('text', 'output_text'))
                if reply.strip():
                    return reply
    except (OSError, ValueError, AttributeError, TypeError):
        pass
    return ''


def time_entry_request(payload):
    for entry in transcript_tail(payload):
        message = entry.get('message') if entry.get('type') == 'user' else entry.get('payload')
        if not isinstance(message, dict) or not (entry.get('type') == 'user' or
                (entry.get('type') == 'response_item' and message.get('type') == 'message'
                 and message.get('role') == 'user')):
            continue
        content = message.get('content', [])
        request = content if isinstance(content, str) else '\n'.join(
            item.get('text', '') for item in content if isinstance(item, dict)
            and item.get('type') in ('text', 'input_text')) if isinstance(content, list) else ''
        if not request.strip():
            continue  # Claude also uses user entries for tool results.
        # Inspect the latest actual user request only, never an earlier command.
        return bool(re.match(r'\s*/time-entries\b', request))
    return False


def completion_claim(payload, record):
    reply = last_reply(payload).strip()
    if not reply:
        return False
    # A delivered draft need not include a phrase such as "done".
    artifacts = [item.get('artifact') for item in record.get('reviews', [])]
    if record.get('client'):
        artifacts.append(record['client'].get('draft'))
    for artifact in artifacts:
        try:
            draft = file(artifact).read_text().strip()
            if len(draft) >= 20 and draft in reply:
                return True
        except (ValueError, OSError, TypeError):
            continue
    if time_entry_request(payload):
        return False
    return bool(re.search(r'^(?:\*\*)?(?:done|completed|implemented|fixed|finished)\b|'
                          r'\b(?:ready to (?:send|deliver|merge)|(?:task|work|draft|handover|review) '
                          r'(?:is |has been )?(?:complete|completed|ready|verified)|'
                          r'here(?: is|\'s) (?:the |your )?(?:final |verified |checked )'
                          r'(?:draft|reply|handover))\b', reply, re.I | re.M))


def hook_run(args):
    payload = json.load(sys.stdin)
    session = payload.get('session_id')
    require(text(session), 'Hook session_id missing')
    agent = payload.get('agent_id') or 'main'
    path = Path(args.state) if args.state else state_path(args.runtime, session, agent)
    event = payload.get('hook_event_name')
    if event == 'Stop' and (payload.get('stop_hook_active') or agent != 'main'):
        return
    if event == 'SessionStart':
        print(json.dumps({'hookSpecificOutput': {'hookEventName': event,
              'additionalContext': f'Workflow checkpoint state: {path}. Record identity: runtime={args.runtime}, session_id={session}, agent_id={agent}. Activate with workflow-check.py prepare --record <task.json> --state {path}; inactive until prepared.'}}))
        return
    if not path.is_file():
        return
    record = load(path)
    if not record.get('_active') or identity(record) != (args.runtime, session, agent):
        return
    if event == 'Stop':
        if completion_claim(payload, record):
            validate(record, final=True)
    elif event == 'PreToolUse':
        pretool(record, payload)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'check', 'final', 'complete', 'abandon', 'hook', 'recheck'])
    parser.add_argument('--runtime', choices=['claude', 'codex'], default='codex')
    parser.add_argument('--record')
    parser.add_argument('--state')
    parser.add_argument('--reason')
    parser.add_argument('--artifact')
    parser.add_argument('--author', default='main')
    parser.add_argument('--change-kind', choices=['wording', 'factual', 'suggested-fixes'])
    parser.add_argument('--checked-by')
    args = parser.parse_args()
    try:
        if args.action == 'hook':
            hook_run(args)
            return 0
        if args.action == 'recheck':
            require(args.record and args.artifact, 'recheck needs --record (review JSON) and --artifact')
            recheck(args.record, args.artifact, args.author, args.change_kind, args.checked_by, args.reason)
            print(f'recheck: {args.record}')
            return 0
        require(args.record if args.action == 'prepare' else args.state, 'prepare needs --record; other actions need --state')
        record = load(args.record) if args.action == 'prepare' else load(args.state)
        path = Path(args.state) if args.state else state_path(*identity(record))
        if args.action == 'prepare':
            if path.exists() and load(path).get('_active'):
                existing = load(path)
                require(identity(existing) == identity(record) and existing['task'] == record['task'],
                        'Complete the active checkpoint before starting another task')
            record.pop('_hashes', None)
            validate(record, preparing=True)
            record['_active'] = True
            save(path, record)
        else:
            if args.action == 'abandon':
                require(text(args.reason), 'abandon needs --reason identifying the blocker')
                record['_abandoned_reason'] = args.reason
                record['_outcome'] = 'abandoned'
                record['_active'] = False
                save(path, record)
            else:
                validate(record, final=args.action in ('final', 'complete'))
                if args.action == 'complete':
                    record['_outcome'] = 'passed'
                    record['_active'] = False
                    save(path, record)
        print(f'{args.action}: {path}')
        return 0
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(f'Checkpoint needs correction: {error}', file=sys.stderr)
        return 2 if args.action == 'hook' else 1


if __name__ == '__main__':
    sys.exit(main())
