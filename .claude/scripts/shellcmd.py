"""Split a Bash tool command into the simple commands it would actually run.

Shared by the PreToolUse gates (verify-before-commit.py, guard-push.py) so both see
`rtk git push`, `env X=1 git commit`, `cd repo && git -C sub push`, `bash -c '...'`
and `$(...)` the same way.

ponytail: shlex plus a quote-aware pre-pass, not a shell. It handles separators,
redirects, heredoc bodies, comments, wrapper prefixes, `-c` shells, substitutions,
`cd` and git aliases. Commands built at runtime (variables, functions defined inline)
stay invisible; a real parser (bashlex) is the upgrade if that ever matters.
"""
import os
import re
import shlex
import subprocess
from dataclasses import dataclass, field

HEREDOC = re.compile(r"<<-?[ \t]*(['\"]?)(\w+)\1[^\n]*\n.*?\n[ \t]*\2[ \t]*(?=\n|$)", re.S)
SUBST = re.compile(r"\$\((.*)\)|`([^`]*)`", re.S)
ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
PREFIXES = {"command", "builtin", "exec", "nohup", "time", "sudo", "nice", "caffeinate",
            "xargs", "if", "then", "else", "elif", "do", "while", "until", "!", "{", "}"}
RTK_WRAPPERS = {"proxy", "err", "summary", "test"}
SHELLS = {"bash", "sh", "zsh", "fish", "dash"}
GIT_VALUE_OPTS = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env",
                  "--super-prefix", "--exec-path"}
GIT_BUILTINS = {"add", "am", "apply", "bisect", "blame", "branch", "checkout", "cherry-pick",
                "clean", "clone", "commit", "config", "diff", "fetch", "grep", "init", "log",
                "merge", "mv", "pull", "push", "rebase", "remote", "reset", "restore", "rev-parse",
                "rm", "show", "stash", "status", "switch", "symbolic-ref", "tag", "worktree"}


@dataclass
class Cmd:
    argv: list
    cwd: str
    redirects: list = field(default_factory=list)  # [(op, target)]


def _flatten(cmd):
    """Drop comments and line continuations, turn unquoted newlines into `;`."""
    out, quote, i = [], None, 0
    while i < len(cmd):
        c = cmd[i]
        if quote:
            if c == "\\" and quote == '"':
                out.append(cmd[i:i + 2])
                i += 2
                continue
            if c == quote:
                quote = None
        elif cmd.startswith("\\\n", i):
            i += 2
            continue
        elif c == "\\":
            out.append(cmd[i:i + 2])
            i += 2
            continue
        elif c in "'\"":
            quote = c
        elif c == "#" and (not out or out[-1][-1:] in " \t\n;&|("):
            while i < len(cmd) and cmd[i] != "\n":
                i += 1
            continue
        elif c == "\n":
            c = ";"
        out.append(c)
        i += 1
    return "".join(out)


def _resolve(cwd, path):
    return os.path.normpath(os.path.join(cwd, os.path.expanduser(path)))


def _strip(argv):
    """Peel env assignments and wrappers (`env`, `rtk`, `sudo`, ...) off the front."""
    while argv:
        a0 = os.path.basename(argv[0])
        if ASSIGN.match(argv[0]) or a0 in PREFIXES:
            argv = argv[1:]
        elif a0 == "env":
            argv = argv[1:]
            while argv and (argv[0].startswith("-") or ASSIGN.match(argv[0])):
                argv = argv[2:] if argv[0] in ("-u", "-C", "-S") else argv[1:]
        elif a0 == "rtk":
            argv = argv[1:]
            if len(argv) > 1 and argv[0] in RTK_WRAPPERS:
                argv = argv[1:]
        elif a0 == "fnm" and argv[1:2] == ["exec"]:
            argv = argv[2:]
            while argv and argv[0].startswith("-"):
                flag = argv.pop(0)
                if flag == "--":
                    break
                if flag in ("--using", "--log-level", "--fnm-dir", "--arch") and argv:
                    argv = argv[1:]
        elif a0 in ("npx", "pnpx", "bunx"):
            argv = argv[1:]
            while argv and argv[0].startswith("-"):
                flag = argv.pop(0)
                if flag == "--":
                    break
                if flag in ("-p", "--package", "-c", "--call") and argv:
                    if flag in ("-c", "--call"):
                        return ["sh", "-c", argv[0]]
                    argv = argv[1:]
            if argv:
                argv = [argv[0].split("@", 1)[0] if not argv[0].startswith("@") else argv[0], *argv[1:]]
        else:
            break
    if argv:
        argv = [os.path.basename(argv[0])] + argv[1:]
    return argv


def commands(cmd, cwd=None, _depth=0):
    """Every simple command in `cmd`, in order, with the cwd it would run in."""
    cwd = cwd or os.getcwd()
    if _depth > 5:
        return []
    cmd = HEREDOC.sub(lambda m: m.group(0).split("\n", 1)[0], cmd)
    lex = shlex.shlex(_flatten(cmd), posix=True, punctuation_chars=True)
    lex.commenters = ""
    lex.whitespace_split = True
    tokens = list(lex)

    found, argv, redirects, skip = [], [], [], False

    def flush():
        nonlocal argv, redirects, cwd
        stripped = _strip(argv)
        if stripped:
            if stripped[0] in ("cd", "pushd"):
                target = next((a for a in stripped[1:] if not a.startswith("-")), "~")
                cwd = _resolve(cwd, target)
            elif stripped[0] in SHELLS and any(
                    a.startswith("-") and not a.startswith("--") and "c" in a for a in stripped[1:-1]):
                flag = next(i for i, a in enumerate(stripped) if i and a.startswith("-") and "c" in a)
                if flag + 1 < len(stripped):
                    found.extend(commands(stripped[flag + 1], cwd, _depth + 1))
            elif stripped[0] == "eval":
                found.extend(commands(" ".join(stripped[1:]), cwd, _depth + 1))
            found.append(Cmd(stripped, cwd, redirects))
        argv, redirects = [], []

    for i, tok in enumerate(tokens):
        if skip:
            skip = False
            continue
        if set(tok) <= set("();&|<>") and ("<" in tok or ">" in tok):
            if argv and argv[-1].isdigit():
                argv.pop()  # the fd in `2>&1`
            if i + 1 < len(tokens):
                redirects.append((tok, tokens[i + 1]))
                skip = True
            continue
        if set(tok) <= set("();&|"):
            flush()
            continue
        for m in SUBST.finditer(tok):
            found.extend(commands(m.group(1) or m.group(2) or "", cwd, _depth + 1))
        argv.append(tok)
    flush()
    return found


def _git(cwd, *args):
    try:
        p = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return p.stdout.strip() if p.returncode == 0 else ""


def git_commands(c, _depth=0, _options=()):
    """Resolve every Git command in aliases, retaining effective Git config."""
    if not c.argv or c.argv[0] != "git":
        return []
    cwd, args = c.cwd, c.argv[1:]
    options = list(_options)
    while args and args[0].startswith("-"):
        opt = args[0]
        if opt in GIT_VALUE_OPTS and len(args) > 1:
            if opt == "-C":
                cwd = _resolve(cwd, args[1])
            elif opt == "--config-env":
                raise ValueError("Git --config-env cannot be verified from shell text; use explicit configuration")
            else:
                options.extend((opt, args[1]))
            args = args[2:]
        else:
            if opt.startswith("--config-env="):
                raise ValueError("Git --config-env cannot be verified from shell text; use explicit configuration")
            if opt.startswith("-c") and opt != "-c":
                options.extend(("-c", opt[2:]))
            elif opt.startswith("--git-dir=") or opt.startswith("--work-tree="):
                name, value = opt.split("=", 1)
                options.extend((name, value))
            else:
                options.append(opt)
            args = args[1:]
    if not args:
        return []
    sub, rest = args[0], args[1:]
    if sub not in GIT_BUILTINS and _depth < 3:
        alias = _git(cwd, *options, "config", "--get", f"alias.{sub}")
        if alias.startswith("!"):
            hits = []
            for inner in commands(alias[1:] + " " + " ".join(shlex.quote(a) for a in rest), cwd):
                hits.extend(git_commands(inner, _depth + 1, options))
            return hits
        if alias:
            return git_commands(Cmd(["git", *shlex.split(alias), *rest], cwd), _depth + 1, options)
    return [(sub, rest, cwd, tuple(options))]
