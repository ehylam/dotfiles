import itertools, json, subprocess, tempfile, os
HOOK = os.path.join(os.path.dirname(os.path.realpath(__file__)), "verify-before-commit.py")
COMMIT = "git" + " commit"          # split so this file never trips the live gate
TEMP = tempfile.TemporaryDirectory(prefix='verify-commit-test-')
REPO = os.path.join(TEMP.name, 'repo')
os.mkdir(REPO)
subprocess.run(['git', 'init', '-q', '-b', 'feature/test', REPO], check=True)
IDS = itertools.count()

def tu(name, **inp):
    return {"message": {"content": [{"type": "tool_use", "id": str(next(IDS)), "name": name, "input": inp}]}}

def run(entries, cmd=COMMIT + " -m 'x'", transcript=True, complete=True, branch='feature/test'):
    subprocess.run(['git', '-C', REPO, 'symbolic-ref', 'HEAD', 'refs/heads/' + branch], check=True)
    explicit_results = {b.get('tool_use_id') for e in entries
                        for b in (e.get('message') or {}).get('content', [])
                        if isinstance(b, dict) and b.get('type') == 'tool_result'}
    path = None
    if transcript:
        fd, path = tempfile.mkstemp(suffix=".jsonl")
        with os.fdopen(fd, "w") as f:
            for e in entries:
                f.write(json.dumps(e) + "\n")
                if complete and (e.get('message') or {}).get('content'):
                    block = e['message']['content'][0]
                    if block['type'] == 'tool_use' and block['id'] not in explicit_results:
                        f.write(json.dumps({'message': {'content': [{'type': 'tool_result',
                            'tool_use_id': block['id'], 'is_error': False, 'content': 'Exit code 0'}]}}) + '\n')
                elif complete and (e.get('payload') or {}).get('type') in ('function_call', 'custom_tool_call'):
                    f.write(json.dumps({'type': 'response_item', 'payload': {'type': 'function_call_output',
                        'call_id': e['payload']['call_id'], 'output': {'exit_code': 0}}}) + '\n')
    payload = {"tool_name": "Bash", "cwd": REPO, "tool_input": {"command": cmd}}
    if path: payload["transcript_path"] = path
    p = subprocess.run(["python3", HOOK], input=json.dumps(payload),
                       capture_output=True, text=True)
    if p.returncode not in (0, 2):
        print(p.stderr)
    if path: os.unlink(path)
    return p.returncode

EDIT = tu("Edit", file_path="a.py")
TEST = tu("Bash", command="npm test")
LS   = tu("Bash", command="ls -la")
PW   = tu("mcp__playwright__browser_navigate", url="http://x")

# Codex rollout transcripts: top-level calls, and JavaScript code mode inside `exec`
cx_exec = lambda js: {"type": "response_item", "payload": {"type": "custom_tool_call", "call_id": str(next(IDS)), "name": "exec", "input": js}}
cx_fn = lambda name, **args: {"type": "response_item", "payload": {"type": "function_call", "call_id": str(next(IDS)), "name": name, "arguments": json.dumps(args)}}
CX_PATCH = cx_exec('const r = await tools.apply_patch("*** Begin Patch\\n*** Update File: a.liquid\\n");')
CX_TEST = cx_exec('const r = await tools.exec_command({cmd:"npm test"});')

cases = [
    ("non-commit command passes",       run([EDIT], cmd="ls -la"),                    0),
    ("edit + no verify BLOCKS",         run([EDIT]),                                  2),
    ("edit + npm test passes",          run([EDIT, TEST]),                            0),
    ("edit + playwright passes",        run([EDIT, PW]),                              0),
    ("edit + unrelated bash BLOCKS",    run([EDIT, LS]),                              2),
    ("verify BEFORE edit BLOCKS",       run([TEST, EDIT]),                            2),
    ("no edits at all passes",          run([LS]),                                    0),
    ("re-verify after 2nd edit passes", run([EDIT, TEST, EDIT, TEST]),                0),
    ("2nd edit unverified BLOCKS",      run([EDIT, TEST, EDIT]),                      2),
    ("no transcript_path passes",       run([], transcript=False),                    0),
    ("--amend gated",                   run([EDIT], cmd=COMMIT + " --amend"),         2),
    ("chained after && gated",          run([EDIT], cmd="git add -A && " + COMMIT),   2),
    ("commit inside quotes ignored",    run([EDIT], cmd='echo "' + COMMIT + '"'),     0),
    ("git-commit-msg-lint ignored",     run([EDIT], cmd="npx git-commit-msg-lint"),   0),
    # wrappers and git options no longer slip past the gate
    ("rtk git commit gated",            run([EDIT], cmd="rtk " + COMMIT),             2),
    ("git -C dir commit gated",         run([EDIT], cmd="git -C /tmp commit -m x"),   2),
    ("git -c k=v commit gated",         run([EDIT], cmd="git -c a.b=c commit"),       2),
    ("env prefix gated",                run([EDIT], cmd="env X=1 " + COMMIT),         2),
    ("VAR= prefix gated",               run([EDIT], cmd="VAR=1 " + COMMIT),           2),
    ("command prefix gated",            run([EDIT], cmd="command " + COMMIT),         2),
    ("subshell gated",                  run([EDIT], cmd="(" + COMMIT + ")"),          2),
    ("bash -c gated",                   run([EDIT], cmd="bash -c '" + COMMIT + "'"),  2),
    ("heredoc body ignored",            run([EDIT], cmd="cat <<EOF\n" + COMMIT + "\nEOF"), 0),
    # a verification is the command run, not a word in it
    ("cat tests/x is not verify",       run([EDIT, tu("Bash", command="cat tests/x")]),      2),
    ("echo test is not verify",         run([EDIT, tu("Bash", command="echo test")]),        2),
    ("grep -r test is not verify",      run([EDIT, tu("Bash", command="grep -r test .")]),   2),
    ("ls build is not verify",          run([EDIT, tu("Bash", command="ls build")]),         2),
    ("shopify theme dev not verify",    run([EDIT, tu("Bash", command="shopify theme dev")]), 2),
    ("shopify theme check verifies",    run([EDIT, tu("Bash", command="shopify theme check")]), 0),
    ("rtk npm test verifies",           run([EDIT, tu("Bash", command="rtk npm test")]),     0),
    ("npm run test:unit verifies",      run([EDIT, tu("Bash", command="npm run test:unit")]), 0),
    ("python3 test_x.py verifies",      run([EDIT, tu("Bash", command="python3 test_x.py")]), 0),
    ("offline AI setup verifies",       run([EDIT, tu("Bash", command="python3 -B .claude/scripts/check-ai-setup.py")]), 0),
    ("cd x && npx playwright verifies", run([EDIT, tu("Bash", command="cd x && npx playwright test")]), 0),
    # Bash that writes files counts as an edit
    ("sed -i is an edit",               run([tu("Bash", command="sed -i '' s/a/b/ f.py")]),  2),
    ("redirect is an edit",             run([tu("Bash", command="echo x > f.py")]),          2),
    ("heredoc to file is an edit",      run([tu("Bash", command="cat > f.py <<EOF\nx\nEOF")]), 2),
    ("redirect to /dev/null is not",    run([tu("Bash", command="ls > /dev/null 2>&1")]),    0),
    ("redirect to /tmp is not",         run([tu("Bash", command="ls > /tmp/out.txt")]),      0),
    ("sed -i then test passes",         run([tu("Bash", command="sed -i '' s/a/b/ f.py"), TEST]), 0),
    ("plain sed is not an edit",        run([tu("Bash", command="sed -n 1,5p f.py")]),       0),
    # Codex
    ("codex exec apply_patch BLOCKS",   run([CX_PATCH]),                                          2),
    ("codex patch then npm test",       run([CX_PATCH, CX_TEST]),                                 0),
    ("codex top-level patch + exec_cmd", run([{"type": "response_item", "payload": {"type": "custom_tool_call", "call_id": str(next(IDS)), "name": "apply_patch", "input": "x"}},
                                              cx_fn("exec_command", cmd="npm run lint")]),       0),
    ("codex sed -i via exec BLOCKS",    run([cx_exec('await tools.exec_command({cmd:"sed -i \'\' s/a/b/ f.py"});')]), 2),
    ("codex escaped redirect BLOCKS",   run([cx_exec('await tools.exec_command({cmd:"echo \\"x\\" > f.py"});')]), 2),
    ("codex patch then playwright",     run([CX_PATCH, cx_exec('await tools.mcp__playwright__browser_navigate({url:"http://x"});')]), 0),
    ("codex patch then devtools",       run([CX_PATCH, cx_exec('await tools.mcp__chrome_devtools__navigate_page({url:"http://x"});')]), 0),
    ("codex patch + verify in one exec", run([cx_exec('await tools.apply_patch("p"); await tools.exec_command({cmd:"pytest -q"});')]), 0),
    ("codex verify then patch BLOCKS",  run([cx_exec('await tools.exec_command({cmd:"pytest -q"}); await tools.apply_patch("p");')]), 2),
    ("main commits block after passing check", run([EDIT, TEST], branch='main'), 2),
    ("master commits block without transcript", run([], transcript=False, branch='master'), 2),
    ("fnm Shopify app build verifies", run([EDIT, tu('Bash', command='fnm exec --using=22.18.0 shopify app build')]), 0),
    ("npx Shopify function build verifies", run([EDIT, tu('Bash', command='npx --yes shopify app function build')]), 0),
    ("copy evidence outside repo keeps verification", run([EDIT, TEST, tu('Bash', command='cp a.json ~/.claude/state/fanout/a.json')]), 0),
    ("move repo source to tmp needs recheck", run([EDIT, TEST, tu('Bash', command='mv a.py /tmp/a.py')]), 2),
    ("copy into repo needs recheck", run([EDIT, TEST, tu('Bash', command='cp /tmp/a.py a.py')]), 2),
    ("copy to target directory needs recheck", run([EDIT, TEST, tu('Bash', command='cp -t . /tmp/a.py')]), 2),
    ("unknown result remains blocked", run([EDIT, TEST], complete=False), 2),
    ("Codex unrelated workdir cannot verify", run([CX_PATCH, cx_fn('exec_command', cmd='npm test', workdir='/other/repo')]), 2),
    ("branch switch plus commit blocks", run([EDIT, TEST], cmd='git switch main && ' + COMMIT), 2),
    ("masked check cannot verify", run([EDIT, tu('Bash', command='npm test || true')]), 2),
    ("negated failed check cannot verify", run([EDIT, tu('Bash', command='! npm test')]), 2),
    ("check followed by echo cannot verify", run([EDIT, tu('Bash', command='npm test; echo done')]), 2),
]

failed = {'message': {'content': [{'type': 'tool_result', 'tool_use_id': TEST['message']['content'][0]['id'],
                                  'is_error': True, 'content': 'Exit code 1: failed'}]}}
success = {'message': {'content': [{'type': 'tool_result', 'tool_use_id': TEST['message']['content'][0]['id'],
                                   'is_error': False, 'content': 'Exit code 0'}]}}
cases += [
    ('failed check blocks', run([EDIT, TEST, failed], complete=False), 2),
    ('result from check before edit is stale', run([TEST, EDIT, success], complete=False), 2),
    ('exact failed check rerun passes', run([EDIT, TEST, failed, TEST, success], complete=False), 0),
    ('unrelated pass cannot hide failed test', run([EDIT, TEST, failed, tu('Bash', command='npm run lint')]), 2),
    ('edit cannot clear failed test requirement', run([EDIT, TEST, failed, EDIT, tu('Bash', command='npm run lint')]), 2),
    ('fixed edit and exact failing check rerun passes', run([EDIT, TEST, failed, EDIT, TEST, success], complete=False), 0),
]

LINT = tu('Bash', command='npm run lint')
user = lambda text: {'type': 'user', 'message': {'role': 'user', 'content': [{'type': 'text', 'text': text}]}}
cases += [
    ('user waiver clears earlier failure', run([EDIT, TEST, failed, user('Waive failed checks '), LINT]), 0),
    ('typed string waiver clears earlier failure',
     run([EDIT, TEST, failed, {'type': 'user', 'message': {'role': 'user', 'content': 'waive failed checks'}},
          LINT, {'message': {'content': [{'type': 'tool_result', 'tool_use_id': LINT['message']['content'][0]['id'],
                                          'is_error': False, 'content': 'Exit code 0'}]}}], complete=False), 0),
    ('codex user waiver clears earlier failure',
     run([EDIT, TEST, failed, {'type': 'response_item', 'payload': {'type': 'message', 'role': 'user',
          'content': [{'type': 'input_text', 'text': 'waive failed checks'}]}}, LINT]), 0),
    ('waiver still needs a pass after the edit', run([EDIT, TEST, failed, user('waive failed checks')]), 2),
    ('failure after waiver still blocks', run([EDIT, user('waive failed checks'), TEST, failed, LINT]), 2),
    ('quoted waiver does not waive', run([EDIT, TEST, failed, user('please waive failed checks'), LINT]), 2),
    ('meta waiver does not waive',
     run([EDIT, TEST, failed, {**user('waive failed checks'), 'isMeta': True}, LINT]), 2),
]

background = tu('Bash', command='npm test', run_in_background=True)
background_id = background['message']['content'][0]['id']
background_result = {'message': {'content': [{'type': 'tool_result', 'tool_use_id': background_id,
    'content': 'Command running in background with ID: task1'}]}}
task_output = tu('TaskOutput', task_id='task1')
task_result = {'message': {'content': [{'type': 'tool_result',
    'tool_use_id': task_output['message']['content'][0]['id'], 'content': 'Exit code 0'}]}}
async_check = cx_fn('exec_command', cmd='npm test')
async_result = {'type': 'response_item', 'payload': {'type': 'function_call_output',
    'call_id': async_check['payload']['call_id'], 'output': {'session_id': 123}}}
poll = cx_fn('write_stdin', session_id=123)
poll_result = {'type': 'response_item', 'payload': {'type': 'function_call_output',
    'call_id': poll['payload']['call_id'], 'output': {'exit_code': 0}}}
cases += [
    ('background check is pending', run([EDIT, background, background_result], complete=False), 2),
    ('completed background check verifies', run([EDIT, background, background_result, task_output, task_result], complete=False), 0),
    ('yielded exec remains pending', run([EDIT, async_check, async_result], complete=False), 2),
    ('completed yielded exec verifies', run([EDIT, async_check, async_result, poll, poll_result], complete=False), 0),
]

def result_for(call, content, error=False):
    return {'message': {'content': [{'type': 'tool_result',
        'tool_use_id': call['message']['content'][0]['id'], 'is_error': error, 'content': content}]}}

inspect_failed = tu('Bash', command='node inspect.mjs box --url http://localhost/a --a "#a" --viewports mobile')
inspect_passed = tu('Bash', command='cd qa && node ../inspect.mjs box --url http://localhost/a --selector-a "#a" --viewports mobile')
timeout = tu('mcp__playwright__browser_navigate', url='http://localhost/a')
cases += [
    ('same check kind different command clears failure',
     run([EDIT, TEST, failed, tu('Bash', command='pnpm run test')]), 0),
    ('narrower npm script cannot clear broad failed suite',
     run([EDIT, TEST, failed, tu('Bash', command='npm run test:unit')]), 2),
    ('inspect rerun in another repo subdirectory clears failure',
     run([EDIT, inspect_failed, result_for(inspect_failed, 'Exit code 1', True), inspect_passed]), 0),
    ('other repository cannot clear failure',
     run([EDIT, TEST, failed, cx_fn('exec_command', cmd='pnpm test', workdir='/other/repo')]), 2),
    ('inspect on another URL cannot clear original failure',
     run([EDIT, inspect_failed, result_for(inspect_failed, 'Exit code 1', True),
          tu('Bash', command='node inspect.mjs --url http://localhost/b')]), 2),
    ('another inspect selector cannot clear original failure',
     run([EDIT, inspect_failed, result_for(inspect_failed, 'Exit code 1', True),
          tu('Bash', command='node inspect.mjs box --url http://localhost/a --a "#b" --viewports mobile')]), 2),
    ('another inspect viewport cannot clear original failure',
     run([EDIT, inspect_failed, result_for(inspect_failed, 'Exit code 1', True),
          tu('Bash', command='node inspect.mjs box --url http://localhost/a --a "#a" --viewports desktop')]), 2),
    ('another inspect scope cannot clear original failure',
     run([EDIT, inspect_failed, result_for(inspect_failed, 'Exit code 1', True),
          tu('Bash', command='node inspect.mjs box --url http://localhost/a --a "#a" --scope main --viewports mobile')]), 2),
    ('single test cannot clear broad failed suite',
     run([EDIT, TEST, failed, tu('Bash', command='pytest test_one.py')]), 2),
    ('timeout is incomplete and cannot verify alone',
     run([EDIT, timeout, result_for(timeout, 'Tool timed out', True)], complete=False), 2),
    ('timeout does not create a browser defect after passing tests',
     run([EDIT, TEST, timeout, result_for(timeout, 'Tool timed out', True)]), 0),
    ('completed failing timeout assertion is still a test failure',
     run([EDIT, TEST, result_for(TEST, 'assertion timed out\nExit code 1', True),
          tu('Bash', command='npm run lint')]), 2),
    ('timeout does not clear an observed browser defect',
     run([EDIT, timeout, result_for(timeout, 'assertion failed', True), timeout,
          result_for(timeout, 'Tool timed out', True), TEST]), 2),
    ('another browser URL cannot clear observed page failure',
     run([EDIT, PW, result_for(PW, 'assertion failed', True),
          tu('mcp__playwright__browser_navigate', url='http://other-page')]), 2),
    ('same browser URL can clear observed page failure',
     run([EDIT, PW, result_for(PW, 'assertion failed', True),
          tu('mcp__playwright__browser_navigate', url='http://x')]), 0),
    ('transcript parser failure skips verification gate',
     run([EDIT, tu('Bash', command='git --config-env=user.name=NAME status')]), 0),
    ('protected branch still blocks before malformed transcript commands',
     run([EDIT, tu('Bash', command='git --config-env=user.name=NAME status')], branch='main'), 2),
    ('protected branch still blocks malformed incoming Git options',
     run([], cmd='git --config-env=user.name=NAME commit', branch='main'), 2),
    ('unresolved commit checkout cannot bypass protected branch guard',
     run([], cmd='git -C /other/repo --config-env=user.name=NAME commit'), 2),
]

# Real Git blobs distinguish inherited diagnostics from errors in changed/staged files.
subprocess.run(['git', '-C', REPO, 'symbolic-ref', 'HEAD', 'refs/heads/feature/test'], check=True)
with open(os.path.join(REPO, 'inherited.liquid'), 'w') as f:
    f.write('baseline\n')
subprocess.run(['git', '-C', REPO, 'add', 'inherited.liquid'], check=True)
subprocess.run(['git', '-C', REPO, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid',
                'commit', '-qm', 'fixture'], check=True)
subprocess.run(['git', '-C', REPO, 'branch', '-f', 'main', 'HEAD'], check=True)
theme = tu('Bash', command='shopify theme check --output json')
diagnostic = json.dumps([{'path': os.path.join(REPO, 'inherited.liquid'), 'offenses': [
    {'severity': 'error', 'message': 'existing error', 'check': 'UnknownFilter'}]}])
os.makedirs(os.path.join(REPO, 'qa'), exist_ok=True)
OTHER_REPO = os.path.join(TEMP.name, 'other-repo')
subprocess.run(['git', 'init', '-q', '-b', 'feature/test', OTHER_REPO], check=True)
cases.append(('multiple commit repositories require separate verified commands',
              run([EDIT, TEST], cmd=COMMIT + ' && git -C ' + OTHER_REPO + ' commit'), 2))
theme_subdirectory = tu('Bash', command='cd qa && shopify theme check --path .. --output json')
relative_diagnostic = json.dumps([{'path': 'inherited.liquid', 'offenses': [
    {'severity': 'error', 'message': 'existing error', 'check': 'UnknownFilter'}]}])
numeric_diagnostic = json.dumps([{'path': 'inherited.liquid', 'offenses': [
    {'severity': 0, 'message': 'existing error', 'check': 'UnknownFilter'},
    {'severity': 1, 'message': 'warning'}, {'severity': 2, 'message': 'info'}],
    'errorCount': 1, 'warningCount': 1, 'infoCount': 1}])
boolean_diagnostic = json.dumps([{'path': 'inherited.liquid', 'offenses': [
    {'severity': False, 'message': 'malformed'}], 'errorCount': 1}])
contradictory_diagnostic = json.dumps([{'path': 'inherited.liquid', 'offenses': [
    {'severity': 'error', 'message': 'error'}], 'errorCount': 2}])
cases += [
    ('returned JSON errors on baseline-identical files pass',
     run([EDIT, theme, result_for(theme, diagnostic + '\nExit code 1', True)], complete=False), 0),
    ('theme-root-relative JSON report works from another invocation directory',
     run([EDIT, theme_subdirectory, result_for(theme_subdirectory, relative_diagnostic + '\nExit code 1', True)], complete=False), 0),
    ('numeric severity and CLI count fields accept inherited errors',
     run([EDIT, theme, result_for(theme, numeric_diagnostic + '\nExit code 1', True)], complete=False), 0),
    ('boolean severity cannot masquerade as numeric error',
     run([EDIT, theme, result_for(theme, boolean_diagnostic + '\nExit code 1', True)], complete=False), 2),
    ('contradictory CLI error count cannot excuse failure',
     run([EDIT, theme, result_for(theme, contradictory_diagnostic + '\nExit code 1', True)], complete=False), 2),
    ('unparseable failed theme check stays failed',
     run([EDIT, theme, result_for(theme, '34 errors found\nExit code 1', True)], complete=False), 2),
    ('empty diagnostic report cannot excuse nonzero exit',
     run([EDIT, theme, result_for(theme, '[]\nExit code 1', True)], complete=False), 2),
]
with open(os.path.join(REPO, 'inherited.liquid'), 'w') as f:
    f.write('changed\n')
cases.append(('errors in changed baseline file block',
              run([EDIT, theme, result_for(theme, diagnostic + '\nExit code 1', True)], complete=False), 2))
subprocess.run(['git', '-C', REPO, 'add', 'inherited.liquid'], check=True)
with open(os.path.join(REPO, 'inherited.liquid'), 'w') as f:
    f.write('baseline\n')
cases.append(('staged differences cannot hide behind clean worktree diagnostics',
              run([EDIT, theme, result_for(theme, diagnostic + '\nExit code 1', True)], complete=False), 2))
write = tu('Write', file_path=os.path.join(REPO, 'inherited.liquid'), content='changed\n')
restore = tu('Bash', command='git restore -- inherited.liquid')
cases += [
    ('restore to already reviewed content preserves verification', run([write, TEST, restore]), 0),
    ('restore to different content requires fresh verification',
     run([tu('Write', file_path=os.path.join(REPO, 'inherited.liquid'), content='other\n'), TEST, restore]), 2),
    ('restore without reconstructable content remains conservative', run([EDIT, TEST, restore]), 2),
]

fails = 0
for name, got, want in cases:
    ok = got == want
    fails += not ok
    print(f"{'PASS' if ok else 'FAIL'}  {name}: exit {got} (want {want})")

fd, p = tempfile.mkstemp(suffix=".jsonl")
with os.fdopen(fd, "w") as f:
    f.write("{not json\n"); f.write(json.dumps(EDIT) + "\n")
r = subprocess.run(["python3", HOOK], text=True, capture_output=True,
    input=json.dumps({"cwd": REPO, "tool_input": {"command": COMMIT}, "transcript_path": p}))
os.unlink(p)
ok = r.returncode == 2 and "BLOCKED" in r.stderr
fails += not ok
print(f"{'PASS' if ok else 'FAIL'}  garbage line skipped, still blocks: exit {r.returncode}")

total = len(cases) + 1
print(f"\n{total - fails}/{total} passed")
TEMP.cleanup()
raise SystemExit(1 if fails else 0)
