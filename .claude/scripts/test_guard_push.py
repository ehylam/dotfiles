import json, os, re, subprocess, tempfile
HOOK = os.path.join(os.path.dirname(os.path.realpath(__file__)), "guard-push.py")
PUSH = "git" + " push"              # split so this file never trips the live gate

tmp = tempfile.mkdtemp()
origin, repo = os.path.join(tmp, "origin.git"), os.path.join(tmp, "repo")
sh = lambda *a, cwd=repo: subprocess.run(a, cwd=cwd, check=True, capture_output=True)
sh("git", "init", "-q", "--bare", "-b", "main", origin, cwd=tmp)
sh("git", "clone", "-q", origin, repo, cwd=tmp)
sh("git", "commit", "-q", "--allow-empty", "-m", "init")
# Populate the disposable local remote without executing a protected-branch push.
sh("git", "--git-dir", origin, "fetch", "-q", repo, "HEAD:refs/heads/main", cwd=tmp)
sh("git", "fetch", "-q", "origin")
sh("git", "remote", "set-head", "origin", "main")
sh("git", "config", "--add", "claude.protectedBranch", "theme-live-*")
sh("git", "config", "alias.pm", "push origin main")


def run(cmd, head="feature/x", tool="Bash", **inp):
    sh("git", "checkout", "-q", "-B", head)
    payload = {"tool_name": tool, "cwd": repo, "tool_input": inp or {"command": cmd}}
    return subprocess.run(["python3", HOOK], input=json.dumps(payload),
                          capture_output=True, text=True).returncode


GH = "mcp__github-mcp__push_files"
root = os.path.dirname(os.path.dirname(os.path.dirname(HOOK)))
for path in (".claude/settings.json", ".codex/hooks.user.json"):
    with open(os.path.join(root, path)) as source:
        groups = json.load(source)["hooks"]["PreToolUse"]
    for suffix in ("push_files", "create_or_update_file", "delete_file"):
        assert any(re.fullmatch(group.get("matcher", ""), "mcp__github-mcp__" + suffix)
                   and any("guard-push.py" in hook.get("command", "") for hook in group["hooks"])
                   for group in groups), f"Missing GitHub guard wiring: {path} {suffix}"
cases = [
    ("working branch",                 run(f"{PUSH} origin feature/x"),                 0),
    ("-u origin HEAD on feature",      run(f"{PUSH} -u origin HEAD"),                   0),
    ("bare push on feature",           run(PUSH),                                       0),
    ("piped + redirected",             run(f"{PUSH} origin feature/x 2>&1 | tail -3"),  0),
    ("delete own branch",              run(f"{PUSH} origin --delete feature/old"),      0),
    ("tags",                           run(f"{PUSH} origin --tags"),                    0),
    ("quoted mention ignored",         run(f'echo "{PUSH} origin main"'),               0),
    ("non-git command",                run("ls -la"),                                   0),
    ("main BLOCKS",                    run(f"{PUSH} origin main"),                      2),
    ("HEAD:main BLOCKS",               run(f"{PUSH} origin HEAD:main"),                 2),
    ("refs/heads/master BLOCKS",       run(f"{PUSH} origin x:refs/heads/master"),       2),
    ("bare push on main BLOCKS",       run(PUSH, head="main"),                        2),
    ("HEAD on main BLOCKS",            run(f"{PUSH} origin HEAD", head="main"),       2),
    ("production BLOCKS",              run(f"{PUSH} origin production"),                2),
    ("live BLOCKS",                    run(f"{PUSH} origin feature/x:live"),            2),
    ("repo glob BLOCKS",               run(f"{PUSH} origin theme-live-au"),             2),
    ("--force BLOCKS",                 run(f"{PUSH} --force origin feature/x"),         2),
    ("-uf BLOCKS",                     run(f"{PUSH} -uf origin feature/x"),             2),
    ("+refspec BLOCKS",                run(f"{PUSH} origin +feature/x"),                2),
    ("--force-with-lease BLOCKS",      run(f"{PUSH} --force-with-lease origin feature/x"), 2),
    ("--mirror BLOCKS",                run(f"{PUSH} --mirror origin"),                  2),
    ("--all BLOCKS",                   run(f"{PUSH} --all origin"),                     2),
    ("delete main BLOCKS",             run(f"{PUSH} origin :main"),                     2),
    ("--delete main BLOCKS",           run(f"{PUSH} origin --delete main"),             2),
    ("rtk wrapper BLOCKS",             run(f"rtk {PUSH} origin main"),                  2),
    ("env prefix BLOCKS",              run(f"GIT_TRACE=0 env X=1 {PUSH} origin main"),  2),
    ("git -C BLOCKS",                  run(f"git -C {repo} push origin main"),          2),
    ("cd && push on main BLOCKS",      run(f"cd {repo} && {PUSH}", head="main"),      2),
    ("bash -c BLOCKS",                 run(f"bash -c '{PUSH} origin main'"),            2),
    ("$(...) BLOCKS",                  run(f"echo $({PUSH} origin main)"),              2),
    ("subshell BLOCKS",                run(f"(cd {repo}; {PUSH} origin master)"),       2),
    ("after comment line BLOCKS",      run(f"# note\n{PUSH} origin main"),              2),
    ("alias BLOCKS",                   run("git pm"),                                   2),
    ("inline target BLOCKS",           run("git -c remote.origin.push=HEAD:main push origin"), 2),
    ("compact inline target BLOCKS",   run("git -cremote.origin.push=HEAD:master push origin"), 2),
    ("inline matching BLOCKS",         run("git -c push.default=matching push origin"), 2),
    ("inline alias BLOCKS",            run("git -c 'alias.pp=push origin HEAD:main' pp"), 2),
    ("inline shell alias BLOCKS",      run("git -c 'alias.pp=!git push origin HEAD:main' pp"), 2),
    ("shell alias later push BLOCKS",  run("git -c 'alias.pp=!git status; git push origin HEAD:main' pp"), 2),
    ("shell alias later safe push",    run("git -c 'alias.pp=!git status; git push origin feature/x' pp"), 0),
    ("mirror config BLOCKS",           run("git -c remote.origin.mirror=true push origin"), 2),
    ("repo option target BLOCKS",      run("git -c remote.deploy.push=HEAD:main push --repo=deploy"), 2),
    ("split repo option BLOCKS",       run("git -c remote.deploy.push=HEAD:main push --repo deploy"), 2),
    ("default mirror remote BLOCKS",   run("git -c remote.pushDefault=mirror -c remote.mirror.mirror=true push"), 2),
    ("false mirror config",            run("git -c remote.origin.mirror=false push origin feature/x"), 0),
    ("inline safe alias",              run("git -c 'alias.pp=push origin feature/x' pp"), 0),
    ("inline safe target",             run("git -c remote.origin.push=HEAD:feature/x push origin"), 0),
    ("benign config",                  run("git -c color.ui=false push origin feature/x"), 0),
    ("git dir before -C alias BLOCKS",  run("git --git-dir=repo/.git -C .. pm"), 2),
    ("split git dir -C alias BLOCKS",   run("git --git-dir repo/.git -C .. pm"), 2),
    ("config env unresolved BLOCKS",   run("git --config-env=remote.origin.push=TARGET push origin"), 2),
    ("config env equals BLOCKS",       run("git --config-env remote.origin.push=TARGET push origin"), 2),
    ("config env alias BLOCKS",        run("git --config-env=color.ui=TARGET pm"), 2),
    ("split config env alias BLOCKS",  run("git --config-env color.ui=TARGET pm"), 2),
    ("MCP feature branch",             run(None, tool=GH, branch="feature/x", owner="o", repo="r"), 0),
    ("MCP main BLOCKS",                run(None, tool=GH, branch="main", owner="o", repo="r"),      2),
    ("MCP no branch BLOCKS",           run(None, tool=GH, owner="o", repo="r"),                     2),
]

fails = 0
for name, got, want in cases:
    ok = got == want
    fails += not ok
    print(f"{'PASS' if ok else 'FAIL'}  {name}: exit {got} (want {want})")
print(f"\n{len(cases) - fails}/{len(cases)} passed")
raise SystemExit(1 if fails else 0)
