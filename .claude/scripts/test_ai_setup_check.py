#!/usr/bin/env python3
"""Check runner failure reporting and private logs against real tiny fixtures."""
from contextlib import redirect_stdout
import importlib.util
from io import StringIO
from pathlib import Path
import tempfile
from unittest.mock import patch

SOURCE = Path(__file__).with_name('check-ai-setup.py')
spec = importlib.util.spec_from_file_location('ai_setup_check', SOURCE)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
assert runner.test_command('test_herdr_editor.lua')[:-1] == ['nvim', '--headless', '-u', 'NONE', '-i', 'NONE', '-l']
assert Path(runner.test_command('test_migrate.py')[-1]) == runner.ROOT / 'test_migrate.py'
assert Path(runner.test_command('test_guard_push.py')[-1]) == runner.SCRIPTS / 'test_guard_push.py'
assert runner.test_command('test_storefront_qa.py')[-1] == '--offline'

with tempfile.TemporaryDirectory(prefix='ai-check-runner-') as folder:
    fixtures = Path(folder)
    (fixtures / 'passing.py').write_text('print("fixture pass")\n')
    (fixtures / 'failing.py').write_text('raise SystemExit(7)\n')
    logs = fixtures / 'logs'
    logs.mkdir()
    output = StringIO()
    with patch.object(runner, 'SUITES', {'core': ['failing.py', 'passing.py']}), \
            patch.object(runner, 'SCRIPTS', fixtures), \
            patch.object(runner.tempfile, 'mkdtemp', return_value=str(logs)), \
            redirect_stdout(output):
        assert runner.main([]) == 1
    assert 'FAIL failing.py' in output.getvalue()
    assert 'PASS passing.py' in output.getvalue(), 'Failure stopped later checks'
    assert '1/2 offline checks passed' in output.getvalue()
    assert logs.stat().st_mode & 0o777 == 0o700
    assert all(p.stat().st_mode & 0o777 == 0o600 for p in logs.iterdir())
    output = StringIO()
    with patch.object(runner, 'SUITES', {'core': ['passing.py']}), \
            patch.object(runner, 'SCRIPTS', fixtures), \
            patch.object(runner.tempfile, 'mkdtemp', return_value=str(logs)), \
            redirect_stdout(output):
        assert runner.main([]) == 0
    with patch.object(runner.subprocess, 'run', side_effect=AssertionError('List must not execute checks')), \
            redirect_stdout(StringIO()):
        assert runner.main(['--list']) == 0
print('PASS: failures return nonzero, remaining checks run, passing suite succeeds, private logs and list-only mode')
