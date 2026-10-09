#!/usr/bin/env python3
"""PreToolUse gate: `git push` to working branches is fine, protected targets are not.

Protected: main, master, production, prod, live, the remote's default branch, and any
glob set per repo for a branch wired to a live theme or deploy:
    git config --add claude.protectedBranch 'theme-live-*'
Also blocked: force pushes (--force, -f, +refspec), --mirror, --all, matching pushes,
and GitHub MCP file writes to a protected branch.

Fails closed: a push it cannot resolve, or a crash of this script, blocks with the
reason. Commands mentioning neither "push" nor "git" exit 0 before any parsing.
"""
import fnmatch
import json
import os
import sys

sys.dont_write_bytecode = True  # no __pycache__ in the dotfiles
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from shellcmd import _git, commands, git_commands  # noqa: E402

STATIC = ("main", "master", "production", "prod", "live")
VALUE_OPTS = {"--repo", "-o", "--push-option", "--receive-pack", "--exec"}
FORCE = ("--force", "--force-with-lease", "--force-if-includes")
EVERYTHING = ("--mirror", "--all", "--branches")
MCP_WRITES = ("push_files", "create_or_update_file", "delete_file")


class Block(Exception):
    pass


def protected(cwd, remote, options=()):
    pats = list(STATIC)
    head = _git(cwd, *options, "symbolic-ref", "--short", "-q", f"refs/remotes/{remote or 'origin'}/HEAD")
    if "/" in head:
        pats.append(head.split("/", 1)[1])
    pats += _git(cwd, *options, "config", "--get-all", "claude.protectedBranch").splitlines()
    return pats


def branch_of(ref):
    if ref.startswith("refs/heads/"):
        return ref[len("refs/heads/"):]
    if ref.startswith("refs/"):
        return None  # tags, notes: not branches
    return ref


def check_push(args, cwd, options=()):
    pos, delete, i, repo_option = [], False, 0, None
    while i < len(args):
        a = args[i]
        name = a.split("=", 1)[0]
        if a == "--":
            pos += args[i + 1:]
            break
        if name in FORCE:
            raise Block("force push")
        if name in EVERYTHING:
            raise Block(f"`{name}` pushes every branch")
        if name == "--delete":
            delete = True
        elif name == '--repo':
            if '=' in a:
                repo_option = a.split('=', 1)[1]
            elif i + 1 < len(args):
                i += 1
                repo_option = args[i]
            else:
                raise Block('missing --repo target')
        elif name in VALUE_OPTS and "=" not in a:
            i += 1
        elif a.startswith("-") and not a.startswith("--") and len(a) > 1:
            for ch in a[1:]:
                if ch == "f":
                    raise Block("force push")
                if ch == "d":
                    delete = True
                if ch == "o":
                    if a.endswith("o"):
                        i += 1
                    break
        elif not a.startswith("-"):
            pos.append(a)
        i += 1

    remote, specs = (pos[0] if pos else repo_option), pos[1:]
    current = _git(cwd, *options, "symbolic-ref", "--short", "-q", "HEAD")
    if not remote:
        remote = (_git(cwd, *options, 'config', '--get', f'branch.{current}.pushRemote')
                  or _git(cwd, *options, 'config', '--get', 'remote.pushDefault')
                  or _git(cwd, *options, 'config', '--get', f'branch.{current}.remote')
                  or 'origin')
    if _git(cwd, *options, 'config', '--bool', '--get', f'remote.{remote}.mirror') == 'true':
        raise Block('remote mirror configuration pushes every ref')
    targets = []

    if not specs:
        if delete:
            raise Block("`--delete` with no branch named")
        if _git(cwd, *options, "config", "--get", "push.default") == "matching":
            raise Block("push.default=matching pushes every branch")
        configured = _git(cwd, *options, "config", "--get-all", f"remote.{remote or 'origin'}.push").splitlines()
        if configured:
            specs = configured
        else:
            if not current:
                raise Block("detached HEAD: name the target branch explicitly")
            targets.append(current)
            upstream = _git(cwd, *options, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{push}")
            if "/" in upstream:
                targets.append(upstream.split("/", 1)[1])

    for spec in specs:
        if spec.startswith("+"):
            raise Block(f"force refspec `{spec}`")
        if "*" in spec or spec == ":":
            raise Block(f"refspec `{spec}` pushes many branches")
        src, _, dst = spec.partition(":")
        dst = dst or src
        if dst in ("HEAD", "@"):
            if not current:
                raise Block("detached HEAD: name the target branch explicitly")
            dst = current
        branch = branch_of(dst)
        if branch:
            targets.append(branch)

    pats = protected(cwd, remote, options)
    for t in targets:
        hit = next((p for p in pats if fnmatch.fnmatchcase(t, p)), None)
        if hit:
            raise Block(f"`{t}` is protected ({'matches ' + hit if hit != t else 'production branch'})")


def check(hook):
    tool = hook.get("tool_name", "")
    inp = hook.get("tool_input") or {}
    if tool.startswith("mcp__github") and tool.endswith(MCP_WRITES):
        branch = inp.get("branch")
        if not branch:
            raise Block("GitHub write with no branch defaults to the repo's default branch")
        if any(fnmatch.fnmatchcase(branch, p) for p in STATIC):
            raise Block(f"GitHub write to protected branch `{branch}`")
        return
    cmd = inp.get("command") or ""
    if "push" not in cmd and "git" not in cmd:
        return  # fast path; "git" kept so aliases like `git p` still get resolved
    for c in commands(cmd, hook.get("cwd") or os.getcwd()):
        for hit in git_commands(c):
            if hit[0] == "push":
                check_push(hit[1], hit[2], hit[3])


def main():
    try:
        hook = json.load(sys.stdin)
    except ValueError:
        return 0
    try:
        check(hook)
    except Block as e:
        reason = str(e)
    except Exception as e:  # fail closed on pushes: exit 1 would let the push through
        if not any(word in json.dumps(hook.get("tool_input") or {}) for word in ('git', 'push')):
            return 0
        reason = f"push guard could not parse this command ({type(e).__name__}: {e})"
    else:
        return 0
    print(
        f"BLOCKED: {reason}.\n"
        "Pushes are allowed only to working branches (feature/, fix/, hotfix/ ...), never to\n"
        "main, master, production, prod, live, the remote default branch, or a branch listed in\n"
        "`git config claude.protectedBranch`. No force or mirror pushes. Open a PR instead,\n"
        "or ask the user to run it themselves.",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
