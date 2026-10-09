#!/usr/bin/env python3
"""Block protected-branch commits and edits without completed, passing verification.

Scans the session transcript for the last edit (Edit/Write, or Bash that writes files:
redirects, sed -i, tee, cp/mv/rm, git apply), then checks verification results
after it (a test/build/lint command, or a browser MCP call). Commands are parsed by
shellcmd.py, so `rtk git commit`, `git -C x commit` and `env X=1 git commit` are gated.

Check retries match repository, kind and explicit file/URL/selector targets, with
edit generations rejecting stale results. This remains transcript evidence, not a
dependency graph: edits inside subagents and inline scripts can be invisible, and
browser tool success alone does not establish rendered QA. A no-op git restore can
retain verification when preceding full Write content proves identical bytes.
"""
import json
import os
import re
import sys
import subprocess

sys.dont_write_bytecode = True  # no __pycache__ in the dotfiles
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from shellcmd import _git, _resolve, commands, git_commands  # noqa: E402

EDIT_TOOLS = ("Edit", "Write", "NotebookEdit")
WAIVER = "waive failed checks"
VERIFY_MCP = ("mcp__playwright__", "mcp__chrome-devtools__", "mcp__chrome_devtools__",
              "mcp__claude-in-chrome__")

# Codex transcripts (rollout-*.jsonl) record tools differently: top-level `exec_command` /
# `apply_patch` calls, or, in code mode, JavaScript inside an `exec` call that invokes
# tools.exec_command({cmd: ...}), tools.apply_patch(...) and tools.mcp__playwright__... .
CODEX_CALL = re.compile(
    r"""tools\.(?:exec_command\(\s*\{\s*["']?cmd["']?\s*:\s*(?P<cmd>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)(?P<options>[^{}]*)"""
    r"""|(?P<edit>apply_patch)\(|(?P<mcp>mcp__\w+?__)\w+\()""")

# A verification is judged by the command actually run, never by a word appearing
# anywhere in it (`cat tests/x`, `echo test` and `shopify theme dev` do not count).
VERIFY_BIN = {"pytest", "vitest", "jest", "mocha", "playwright", "tsc", "eslint", "stylelint",
              "theme-check", "shellcheck", "luacheck", "rspec", "phpunit"}
RUNNERS = {"npm", "pnpm", "yarn", "bun", "npx", "pnpx", "bunx", "make", "just", "cargo", "go",
           "deno", "composer"}
VERIFY_WORD = re.compile(r"test|lint|check|build|tsc|vitest|jest|playwright|spec")
SCRIPTS = re.compile(r"(^|/)(test_[^/]*|[^/]*_test\.\w+|[^/]*\.test\.\w+|inspect\.mjs|figma-qa\.mjs|check-ai-setup\.py)$")

# Bash that changes files counts as an edit, like Edit/Write do.
WRITERS = {"tee", "cp", "mv", "rm", "patch", "truncate"}
SCRATCH = ("/dev/", "/tmp/", "/private/tmp/", "/private/var/folders/", "/var/folders/")
CWD_LITERAL = re.compile(r'''["']?workdir["']?\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')''')


def is_verify(c):
    argv = c.argv
    a0, rest = argv[0], argv[1:]
    words = [a for a in rest if not a.startswith("-")][:4]
    if a0 in VERIFY_BIN:
        return True
    if a0 in RUNNERS:
        return any(VERIFY_WORD.search(w) for w in words)
    if a0 == "shopify":
        return (words[:2] in (["theme", "check"], ["app", "build"])
                or words[:3] in (["app", "function", "build"], ["app", "function", "run"],
                                 ["app", "config", "validate"]))
    if a0 == "nvim":
        return "--headless" in rest
    if a0 == "tmux":
        return words[:1] == ["source-file"]
    if a0 in ("fish", "bash", "sh", "zsh"):
        return "-n" in rest or (a0 == "fish" and "-c" in rest)
    if a0 in ("node", "python", "python3", "bun", "deno", "ruby"):
        return any(SCRIPTS.search(w) for w in words) or (
            "-m" in rest and bool({"pytest", "unittest"} & set(rest)))
    return False


def check_kind(c):
    words = ' '.join(c.argv)
    if 'inspect.mjs' in words or 'figma-qa.mjs' in words:
        return 'inspect'
    if c.argv[0] == 'theme-check' or re.search(r'\btheme check\b|\btheme-check\b', words):
        return 'theme-check'
    if re.search(r'\bplaywright\b', words):
        return 'browser'
    if re.search(r'lint|eslint|stylelint|shellcheck|luacheck', words):
        return 'lint'
    if re.search(r'build|\btsc\b', words):
        return 'build'
    if re.search(r'test|pytest|spec|vitest|jest|mocha|unittest', words):
        return 'test'
    return 'check'


def check_scope(c):
    targets = set()
    if c.argv[0] in ('npm', 'pnpm', 'yarn', 'bun'):
        words = [arg for arg in c.argv[1:] if not arg.startswith('-')]
        if words:
            script = words[1] if words[0] in ('run', 'run-script') and len(words) > 1 else words[0]
            targets.add(('script', script))
    aliases = {'--selector-a': '--a', '--selector-b': '--b', '--url-live': '--url',
               '--url-a': '--url', '--url-preview': '--url-b'}
    flags = {'--url', '--url-b', '--a', '--b', '--a-text', '--b-text', '--scope', '--scope-b',
             '--selector', '--selectors', '--viewports', '--viewport-size', '--batch-file',
             '--image-a', '--image-b'}
    inspect = check_kind(c) == 'inspect'
    seen_viewports = False
    for i, arg in enumerate(c.argv[1:], 1):
        if aliases.get(c.argv[i - 1], c.argv[i - 1]) in flags:
            continue
        option, separator, inline = arg.partition('=')
        flag = aliases.get(option, option)
        if flag in flags and (separator or i + 1 < len(c.argv)):
            value = inline if separator else c.argv[i + 1]
            if flag in ('--batch-file', '--image-a', '--image-b'):
                value = os.path.realpath(_resolve(c.cwd, value))
            if flag == '--viewports':
                value = ','.join(sorted(part.strip() for part in value.split(',')))
                seen_viewports = True
            targets.add((flag[2:], value))
        if arg.startswith(('http://', 'https://')):
            targets.add(('url', arg))
        elif not arg.startswith('-') and re.search(r'\.(?:py|[cm]?js|tsx?|jsx|liquid|css|json)$', arg):
            if os.path.basename(arg) not in ('inspect.mjs', 'figma-qa.mjs'):
                targets.add(('file', os.path.realpath(_resolve(c.cwd, arg))))
        elif inspect and os.path.basename(c.argv[i - 1]) == 'inspect.mjs' and not arg.startswith('-'):
            targets.add(('mode', arg))
    if inspect and not seen_viewports:
        targets.add(('viewports', 'desktop,mobile,tablet'))
    return frozenset(targets)


def output_text(result):
    if isinstance(result, str):
        try:
            decoded = json.loads(result)
        except ValueError:
            return result
        return output_text(decoded) if isinstance(decoded, (dict, list)) else result
    if isinstance(result, list):
        return '\n'.join(output_text(item) for item in result)
    if isinstance(result, dict):
        return '\n'.join(output_text(result[key]) for key in ('content', 'text', 'output')
                         if key in result)
    return ''


def incomplete(result):
    raw = json.dumps(result) if not isinstance(result, str) else result
    codes = [int(x) for x in re.findall(
        r'(?:"exit_code"\s*:\s*|Exit code[: ]+|Process exited with code\s+)(-?\d+)', raw)]
    if codes and any(code not in (0, 124, 137, 143) for code in codes):
        return False  # A test assertion mentioning timeout is still an observed failure.
    return bool(re.search(r'time[ -]?out|timed out|interrupted|cancelled|canceled|'
                          r'Script running with cell ID|Process running with session ID|'
                          r'Command running in background|"session_id"\s*:', raw, re.I))


def baseline_theme_errors(result, root):
    """Accept absolute or repository-root-relative reports on identical baseline files.

    Reports relative to a separate nested theme root are deliberately not inferred.
    """
    text = output_text(result).strip()
    try:
        report = json.loads(text)
    except ValueError:
        # CLI output may put an exit-code envelope after the JSON report.
        try:
            report, end = json.JSONDecoder().raw_decode(text)
        except ValueError:
            return False
        suffix = text[end:]
        if suffix.strip() and not re.fullmatch(r'\s*(?:Exit code[: ]+|Process exited with code\s+)\d+\s*', suffix):
            return False
    if not isinstance(report, list) or not report:
        return False
    base = next((ref for ref in ('main', 'origin/main', 'master', 'origin/master')
                 if _git(root, 'rev-parse', '--verify', ref)), None)
    if not base:
        return False
    errors = []
    for item in report:
        if not isinstance(item, dict) or not isinstance(item.get('path'), str):
            return False
        offenses = item.get('offenses')
        if not isinstance(offenses, list) or any(not isinstance(o, dict) or
                                               type(o.get('severity')) not in (int, str) or
                                               o.get('severity') not in (0, 1, 2, 'error', 'warning', 'info')
                                               for o in offenses):
            return False
        for key, severities in (('errorCount', (0, 'error')), ('warningCount', (1, 'warning')),
                                ('infoCount', (2, 'info'))):
            if key in item and (type(item[key]) is not int or item[key] != sum(
                    o['severity'] in severities for o in offenses)):
                return False
        if any(o['severity'] in (0, 'error') for o in offenses):
            errors.append(item['path'])
    if not errors:
        return False  # A nonzero exit with no reported errors is not a baseline pass.
    for path in errors:
        absolute = os.path.realpath(_resolve(root, path))
        if not affects_repo(root, absolute, root):
            return False
        relative = os.path.relpath(absolute, root)
        if os.path.basename(relative) == '.env' or os.path.basename(relative).startswith('.env.'):
            return False
        try:
            original = subprocess.run(['git', '-C', root, 'show', f'{base}:{relative}'],
                                      capture_output=True, timeout=5)
            staged = subprocess.run(['git', '-C', root, 'show', f':{relative}'],
                                    capture_output=True, timeout=5)
            with open(absolute, 'rb') as fh:
                current = fh.read()
        except (OSError, subprocess.TimeoutExpired):
            return False
        if original.returncode or staged.returncode or original.stdout != current or staged.stdout != current:
            return False
    return True


def remember_edit(call, known, cwd):
    content = (call.get('message') or {}).get('content')
    if not isinstance(content, list):
        known.clear()
        return
    block = content[0]
    args = block.get('input') or {}
    path = args.get('file_path')
    if not path:
        known.clear()
        return
    path = os.path.realpath(_resolve(cwd, path))
    if block.get('name') == 'Write' and isinstance(args.get('content'), str):
        known[path] = args['content'].encode()
    else:
        known.pop(path, None)


def browser_scope(call):
    keys = ('url', 'selector', 'target', 'ref')
    content = (call.get('message') or {}).get('content')
    if isinstance(content, list):
        args = content[0].get('input') or {}
    else:
        payload = call.get('payload') or {}
        if payload.get('name') == 'exec':
            scopes = set()
            for key in keys:
                pattern = r'''["']?''' + key + r'''["']?\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')'''
                scopes.update((key, _js_string(match[1])) for match in re.finditer(pattern, payload.get('input') or ''))
            return frozenset(scopes)
        args = json.loads(payload.get('arguments') or '{}')
    return frozenset((key, str(args[key])) for key in keys if key in args)


def unchanged_restore(c, known):
    if c.argv[:2] != ['git', 'restore'] or any(a.startswith('-') and a != '--' for a in c.argv[2:]):
        return False
    paths = [a for a in c.argv[2:] if a != '--']
    if not paths:
        return False
    for path in paths:
        absolute = os.path.realpath(_resolve(c.cwd, path))
        if absolute not in known:
            return False
        result = subprocess.run(['git', '-C', c.cwd, 'show', f':{path}'], capture_output=True, timeout=5)
        if result.returncode or result.stdout != known[absolute]:
            return False
    return True


def affects_repo(cwd, target, repo):
    if "$" in target or target.startswith("~") and not target.startswith("~/"):
        return True  # Runtime expansion cannot establish an external destination.
    resolved = os.path.realpath(_resolve(cwd, target))
    return os.path.commonpath((repo, resolved)) == repo


def operands(rest):
    paths, i = [], 0
    while i < len(rest):
        arg = rest[i]
        if arg == "--":
            paths.extend(rest[i + 1:])
            break
        if arg in ("-t", "--target-directory") and i + 1 < len(rest):
            paths.append(rest[i + 1])
            i += 2
            continue
        if arg.startswith("--target-directory="):
            paths.append(arg.split("=", 1)[1])
        elif not arg.startswith("-"):
            paths.append(arg)
        i += 1
    return paths


def is_write(c, repo=None):
    repo = os.path.realpath(repo or c.cwd)
    a0, rest = c.argv[0], c.argv[1:]
    for op, target in c.redirects:
        if ">" in op and not target.isdigit() and affects_repo(c.cwd, target, repo):
            return True
    if a0 in ("sed", "gsed", "perl", "ruby"):
        return any(a == "--in-place" or (a.startswith("-") and not a.startswith("--") and "i" in a)
                   for a in rest)
    if a0 in ("cp", "mv", "rm", "tee", "truncate"):
        paths = operands(rest)
        if a0 == "cp":
            target = next((rest[i + 1] for i, a in enumerate(rest[:-1])
                           if a in ("-t", "--target-directory")), None)
            target = target or next((a.split("=", 1)[1] for a in rest
                                     if a.startswith("--target-directory=")), None)
            paths = [target] if target else paths[-1:]
        return any(affects_repo(c.cwd, path, repo) for path in paths)
    if a0 in WRITERS:
        return True
    if a0 == "git":
        return any(sub[0] in ("apply", "am", "restore", "checkout") and (
            sub[0] != "checkout" or "--" in sub[1]) for sub in git_commands(c))
    return False


def _js_string(lit):
    if lit[0] == '"':
        try:
            return json.loads(lit)
        except ValueError:
            pass
    return lit[1:-1]


def events(entry):
    """Normalise one transcript line, Claude or Codex, to ("edit"|"verify"|"bash", cmd)."""
    content = (entry.get("message") or {}).get("content")
    if isinstance(content, list):  # Claude Code
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            name = block.get("name", "")
            if name in EDIT_TOOLS:
                yield "edit", block.get("input", {}).get("file_path"), None
            elif name.startswith(VERIFY_MCP):
                yield "verify", None, None
            elif name == "Bash":
                yield "bash", block.get("input", {}).get("command", ""), None
        return
    p = entry.get("payload") if entry.get("type") == "response_item" else None
    if not isinstance(p, dict) or p.get("type") not in ("function_call", "custom_tool_call"):
        return
    name = p.get("name") or ""
    if name == "apply_patch":
        yield "edit", None, None
    elif name.startswith(VERIFY_MCP):
        yield "verify", None, None
    elif name in ("exec_command", "shell"):
        try:
            args = json.loads(p.get("arguments") or "{}")
        except ValueError:
            return
        cmd = args.get("cmd") or args.get("command") or ""
        yield "bash", " ".join(cmd) if isinstance(cmd, list) else cmd, args.get("workdir")
    elif name == "exec":
        for m in CODEX_CALL.finditer(p.get("input") or ""):
            if m.group("cmd"):
                directory = CWD_LITERAL.search(m.group("options") or '')
                yield "bash", _js_string(m.group("cmd")), _js_string(directory[1]) if directory else None
            elif m.group("edit"):
                yield "edit", None, None
            elif m.group("mcp").startswith(VERIFY_MCP):
                yield "verify", None, None


def calls(entry):
    content = (entry.get("message") or {}).get("content")
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "tool_use":
                yield block.get("id"), {"message": {"content": [block]}}
    elif entry.get("type") == "response_item":
        p = entry.get("payload") or {}
        if p.get("type") in ("function_call", "custom_tool_call"):
            yield p.get("call_id"), entry


def results(entry):
    content = (entry.get("message") or {}).get("content")
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "tool_result":
                yield block.get("tool_use_id"), block, True
    elif entry.get("type") == "response_item":
        p = entry.get("payload") or {}
        if p.get("type") in ("function_call_output", "custom_tool_call_output"):
            yield p.get("call_id"), p.get("output"), False


def passed(result, claude=False):
    """An invocation or running-tool response is never passing evidence."""
    raw = json.dumps(result) if not isinstance(result, str) else result
    if isinstance(result, dict) and (result.get("is_error") or result.get("isError")):
        return False
    if re.search(r'"(?:is_error|isError|interrupted)"\s*:\s*true|Script running with cell ID|'
                 r'Process running with session ID|Command running in background|'
                 r'"status"\s*:\s*"(?:rejected|error|interrupted)"', raw):
        return False
    codes = [int(x) for x in re.findall(
        r'(?:"exit_code"\s*:\s*|Exit code[: ]+|Process exited with code\s+)(-?\d+)', raw)]
    if codes:
        return all(code == 0 for code in codes)
    return claude and isinstance(result, dict) and 'content' in result


def handle(result):
    raw = json.dumps(result) if not isinstance(result, str) else result
    for pattern, kind in [(r'"session_id"\s*:\s*(\d+)', 'session'),
                          (r'Process running with session ID[: ]+(\d+)', 'session'),
                          (r'Script running with cell ID[: ]+([\w-]+)', 'cell'),
                          (r'Command running in background with ID[: ]+([\w-]+)', 'task')]:
        match = re.search(pattern, raw)
        if match:
            return kind, match[1]
    return None


def poll_handle(call):
    content = (call.get('message') or {}).get('content')
    if isinstance(content, list):
        block = content[0]
        if block.get('name') == 'TaskOutput':
            return 'task', str((block.get('input') or {}).get('task_id', ''))
        return None
    p = call.get('payload') or {}
    name = (p.get('name') or '').split('.')[-1]
    if name in ('write_stdin', 'wait'):
        args = json.loads(p.get('arguments') or '{}')
        key = 'session_id' if name == 'write_stdin' else 'cell_id'
        return ('session' if name == 'write_stdin' else 'cell'), str(args.get(key, ''))
    if name == 'exec':
        match = re.search(r'tools\.(write_stdin|wait)\(\s*\{[^}]*?'
                          r'(?:session_id|cell_id)\s*:\s*(?:"([\w-]+)"|([\w-]+))', p.get('input') or '')
        if match:
            return ('session' if match[1] == 'write_stdin' else 'cell'), match[2] or match[3]
    return None


def waived(entry):
    """A user message that is exactly WAIVER clears failures recorded before it.

    Exact match only, so injected instructions or pasted text quoting it never waive.
    """
    if entry.get("isMeta"):
        return False
    msg = entry.get("message") or {}
    p = entry.get("payload") or {}
    if entry.get("type") == "user" and msg.get("role") == "user":
        content = msg.get("content")
    elif entry.get("type") == "response_item" and p.get("type") == "message" and p.get("role") == "user":
        content = p.get("content")
    else:
        return False
    texts = [content] if isinstance(content, str) else [
        b.get("text") or "" for b in content or [] if isinstance(b, dict) and b.get("type") in ("text", "input_text")]
    return any(t.strip().lower() == WAIVER for t in texts)


def unmasked(command):
    # A successful wrapper cannot prove a check passed when shell control can hide its failure.
    return not re.search(r'\|\||(?<![|])\|(?![|])|[;\n]|(?:^|[\s(])!\s', command)


def main() -> int:
    try:
        hook = json.load(sys.stdin)
    except ValueError:
        return 0  # malformed payload: never block on our own bug

    command = hook.get("tool_input", {}).get("command", "")
    cwd = hook.get("cwd") or os.getcwd()
    try:
        git_calls = [g for c in commands(command, cwd) for g in git_commands(c)]
    except (ValueError, TypeError):
        # Verification parser errors must not disable the protected-branch backstop.
        if re.search(r'\bcommit\b', command):
            print('BLOCKED: cannot resolve the commit target from this command. '
                  'Use supported explicit Git options and a named working branch.', file=sys.stderr)
            return 2
        raise
    commits = [g for g in git_calls if g[0] == 'commit']
    if not commits:
        return 0
    if any(g[0] in ('switch', 'checkout', 'symbolic-ref', 'update-ref') for g in git_calls):
        print('BLOCKED: run branch-changing commands separately, then verify the actual commit branch.', file=sys.stderr)
        return 2

    for _, _, directory, options in commits:
        branch = _git(directory, *options, 'symbolic-ref', '--short', '-q', 'HEAD')
        if not branch or branch in ('main', 'master'):
            print(f"BLOCKED: commit target is {branch or 'unresolved/detached HEAD'}. "
                  "Use the task's named working branch.", file=sys.stderr)
            return 2

    transcript = hook.get("transcript_path")
    if not transcript:
        return 0

    roots = {_git(directory, *options, 'rev-parse', '--show-toplevel')
             for _, _, directory, options in commits}
    if '' in roots:
        print('BLOCKED: cannot resolve the commit checkout.', file=sys.stderr)
        return 2
    if len(roots) > 1:
        print('BLOCKED: commit one repository per command so verification applies to its checkout.', file=sys.stderr)
        return 2
    edited = verified = False
    generation, pending, failures, running, known = 0, {}, set(), {}, {}
    try:
        with open(transcript, encoding="utf-8") as fh:
            for line in fh:
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                if waived(entry):
                    failures.clear()
                for call_id, call in calls(entry):
                    poll = poll_handle(call)
                    if poll in running and call_id:
                        pending[call_id] = running[poll]
                    checks = []
                    call_cwd = entry.get('cwd') or cwd
                    for kind, value, directory in events(call):
                        if kind == 'edit':
                            if value and not any(affects_repo(cwd, value, root) for root in roots):
                                continue
                            generation += 1
                            edited, verified = True, False
                            remember_edit(call, known, call_cwd)
                            checks.clear()
                        elif kind == 'verify':
                            checks.extend((root, 'browser', browser_scope(call)) for root in roots
                                          if affects_repo(call_cwd, '.', root))
                        else:
                            for c in commands(value, directory or call_cwd):
                                if any(is_write(c, root) for root in roots):
                                    if unchanged_restore(c, known):
                                        continue
                                    generation += 1
                                    edited, verified = True, False
                                    known.clear()
                                    checks.clear()
                                elif (is_verify(c) and unmasked(value)
                                      and any(affects_repo(c.cwd, '.', root) for root in roots)):
                                    checks.extend((root, check_kind(c), check_scope(c)) for root in roots
                                                  if affects_repo(c.cwd, '.', root))
                    if checks and call_id:
                        pending[call_id] = (generation, checks)
                for call_id, result, claude in results(entry):
                    candidate = pending.pop(call_id, None)
                    if not candidate or candidate[0] != generation:
                        continue
                    active = handle(result)
                    if active and not passed(result, claude):
                        running[active] = candidate
                        continue
                    running = {key: value for key, value in running.items() if value != candidate}
                    passed_checks = [check for check in candidate[1] if passed(result, claude) or
                                     (check[1] == 'theme-check' and not incomplete(result) and
                                      baseline_theme_errors(result, check[0]))]
                    if passed_checks:
                        failures = {failed for failed in failures if not any(
                            failed[:2] == check[:2] and failed[2] == check[2]
                            for check in passed_checks)}
                        verified = True
                    elif not incomplete(result):
                        failures.update(candidate[1])
    except OSError:
        return 0

    if edited and (not verified or failures or any(g == generation for g, _ in
                                                 [*pending.values(), *running.values()])):
        print(
            "BLOCKED: edited files need completed, passing verification; a check is missing, pending or failed.\n"
            "A pass is a completed exit-0 check after the latest edit in this repository. "
            "Re-run failed checks by kind (test, lint, build, theme-check, inspect, browser), "
            "including the same explicit file, URL and selector targets; a different command "
            "or subdirectory is accepted. "
            "Timeouts are incomplete, not failed checks. Piped or failure-masking commands do not count.\n"
            "Theme-check may pass with baseline errors only when its returned JSON report lists "
            "errors exclusively in files byte-identical to main/master, including the index. "
            "Use theme-check JSON output for that exemption.\n"
            f"If a failed check is pre-existing or cannot pass as invoked, explain why and ask the user "
            f"to send exactly `{WAIVER}`; a passing check after the latest edit is still required.",
            file=sys.stderr,
        )
        return 2

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
        print(f'WARNING: commit verification hook could not parse its input ({type(error).__name__}); '
              'verification gate skipped.', file=sys.stderr)
        sys.exit(0)
