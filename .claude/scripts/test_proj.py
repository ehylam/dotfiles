#!/usr/bin/env python3
"""Run without real sessions: python3 .claude/scripts/test_proj.py"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

SOURCE = Path(__file__).resolve().parents[2] / '.config/fish/functions/proj.fish'
FISH = shutil.which('fish')
assert FISH, 'fish is required'

with tempfile.TemporaryDirectory(prefix='proj-check-') as folder:
    root = Path(folder)
    binary = root / 'bin'
    binary.mkdir()
    stub = binary / 'herdr'
    stub.write_text('#!/usr/bin/env python3\nimport json,os,sys\n'
                    'with open(os.environ["PROJ_LOG"],"a") as out: out.write(json.dumps(sys.argv[1:])+"\\n")\n'
                    'sys.exit(int(os.environ.get("PROJ_EXIT","0")))\n')
    stub.chmod(0o755)
    picker = root / '.config/herdr/project-picker.sh'
    picker.parent.mkdir(parents=True)
    picker.write_text('printf "picker\\n" >> "$PROJ_LOG"\n')
    project = root / 'project with spaces'
    project.mkdir()
    log = root / 'calls'
    base = dict(os.environ, HOME=str(root), HERDR_ENV='1', PROJ_LOG=str(log),
                PROJ_SOURCE=str(SOURCE), PATH=str(binary) + os.pathsep + os.environ['PATH'])

    def run(*args, **extra):
        return subprocess.run([FISH, '--no-config', '-c', 'source "$PROJ_SOURCE"; proj $argv', '--', *args],
                              env=dict(base, **extra), text=True, capture_output=True, timeout=5)

    assert run('w9').returncode == 0
    assert json.loads(log.read_text().splitlines()[-1]) == ['workspace', 'focus', 'w9']
    assert run(str(project)).returncode == 0
    assert json.loads(log.read_text().splitlines()[-1]) == [
        'workspace', 'create', '--cwd', str(project.resolve()), '--label', project.name, '--focus']
    assert run().returncode == 0 and log.read_text().splitlines()[-1] == 'picker'
    before = log.read_text()
    assert run('w9', HERDR_ENV='0').returncode == 1 and log.read_text() == before
    assert run('w9', 'w10').returncode == 2 and log.read_text() == before
    assert run('w9', PROJ_EXIT='1').returncode == 1
    stub.unlink()
    result = run('w9', PATH='/usr/bin:/bin')
    assert result.returncode == 127 and 'requires herdr' in result.stderr

print('PASS: native workspace focus/create, spaced paths, picker routing, missing/context guards and errors')
