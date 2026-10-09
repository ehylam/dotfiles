#!/usr/bin/env python3
"""Disposable-directory retention checks; no live cleanup or browser launches."""

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch


SCRIPTS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("artifact_cleanup", SCRIPTS / "browser-artifact-cleanup.py")
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="artifact-retention-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.old = time.time() - 30 * 86400
        self.snapshot_reader = cleanup.process_snapshot
        self.snapshot = patch.object(cleanup, "process_snapshot", return_value="1 launchd\n").start()
        self.addCleanup(patch.stopall)
        patch.object(cleanup.os, "kill", side_effect=ProcessLookupError).start()

    def age(self, path):
        for item in [*path.rglob("*"), path]:
            os.utime(item, (self.old, self.old), follow_symlinks=False)

    def artifact(self, name="apple-browser-qa-owned", **fields):
        path = self.root / name
        path.mkdir(parents=True)
        (path / "nested").mkdir()
        (path / "nested" / "screenshot.png").write_bytes(b"evidence")
        owner = dict(version=1, kind=next(kind for kind in cleanup.KINDS if path.name.startswith(kind + "-")),
                     pid=999999, startedAt="2020-01-01T00:00:00Z", finishedAt="2020-01-01T00:01:00Z")
        owner.update(fields)
        (path / cleanup.MARKER).write_text(json.dumps(owner))
        self.age(path)
        return path

    def run_cleanup(self, *args):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            cleanup.cleanup([self.root], *args)

    def test_old_owned_delete_all_kinds_and_dry_run(self):
        paths = [self.artifact(kind + "-owned") for kind in cleanup.KINDS]
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(cleanup.main(["--root", str(self.root), "--dry-run"]), 0)
        self.assertEqual(output.getvalue().count("would remove:"), 3)
        self.assertTrue(all(path.exists() for path in paths))
        self.snapshot.assert_called_once()
        self.run_cleanup()
        self.assertTrue(all(not path.exists() for path in paths))

    def test_live_and_unverifiable_owner(self):
        path = self.artifact()
        for result in [None, PermissionError(), OSError(), OverflowError()]:
            with self.subTest(result=result), patch.object(cleanup.os, "kill", return_value=result,
                                                          side_effect=result if isinstance(result, Exception) else None):
                self.run_cleanup()
                self.assertTrue(path.exists())

    def test_process_reference_and_snapshot_failure(self):
        path = self.artifact()
        for processes in [f"123 browser --output {path}/nested", f"123 browser {path.resolve()}", None]:
            with self.subTest(processes=processes), patch.object(cleanup, "process_snapshot", return_value=processes):
                if processes is None:
                    with self.assertRaises(RuntimeError):
                        self.run_cleanup()
                else:
                    self.run_cleanup()
                self.assertTrue(path.exists())

    def test_snapshot_read_and_parse_failures(self):
        # Exercise the real snapshot reader while all process execution remains stubbed.
        for result in [OSError(), subprocess.TimeoutExpired("ps", 10), UnicodeDecodeError("utf8", b"x", 0, 1, "bad"),
                       subprocess.CalledProcessError(1, "ps"),
                       subprocess.CompletedProcess([], 0, "", ""),
                       subprocess.CompletedProcess([], 0, "unparseable", ""),
                       subprocess.CompletedProcess([], 0, "1 launchd\n", "partial read")]:
            with self.subTest(result=result), patch.object(cleanup.subprocess, "run", return_value=result,
                                                          side_effect=result if isinstance(result, Exception) else None):
                self.assertIsNone(self.snapshot_reader())
        with patch.object(cleanup.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "1 launchd\n", "")):
            self.assertEqual(self.snapshot_reader(), "1 launchd\n")

    def test_process_reference_through_root_alias(self):
        path = self.artifact()
        alias = self.root / "root-alias"
        alias.symlink_to(self.root, target_is_directory=True)
        with patch.object(cleanup, "process_snapshot", return_value=f"123 browser {alias / path.name}"):
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(cleanup.main(["--root", str(alias)]), 0)
        self.assertTrue(path.exists())

    def test_recent_file_directory_and_marker(self):
        path = self.artifact()
        for item in [path, path / "nested", path / "nested" / "screenshot.png", path / cleanup.MARKER]:
            with self.subTest(item=item):
                os.utime(item, None)
                self.run_cleanup()
                self.assertTrue(path.exists())
                self.age(path)

    def test_unmarked_dependencies_and_persistent_evidence(self):
        for name in ["herdr-browser-benchmark-deps", "browser-use-benchmark-existing", "apple-browser-qa-existing"]:
            path = self.root / name
            path.mkdir()
            self.age(path)
        persistent = self.artifact("herdr-browser-benchmark-evidence")
        persistent.rename(self.root / "herd-evidence")
        nested = self.artifact("parent/apple-browser-qa-nested")
        self.run_cleanup()
        self.assertTrue(nested.exists())
        self.assertEqual(len(list(self.root.iterdir())), 5)

    def test_symlink_candidate_marker_and_descendant(self):
        outside = self.root / "untouched"
        outside.mkdir()
        (outside / "evidence").write_text("keep")
        link = self.root / "apple-browser-qa-link"
        link.symlink_to(outside, target_is_directory=True)
        for target in [outside, self.root / "missing"]:
            path = self.artifact("apple-browser-qa-descendant-" + target.name)
            (path / "link").symlink_to(target)
            self.age(path)
            self.run_cleanup()
            self.assertTrue(path.exists())
        path = self.artifact("apple-browser-qa-marker-link")
        marker = path / cleanup.MARKER
        marker.rename(outside / "owner.json")
        marker.symlink_to(outside / "owner.json")
        self.age(path)
        self.run_cleanup()
        self.assertTrue(path.exists())
        self.assertTrue(link.is_symlink())
        self.assertEqual((outside / "evidence").read_text(), "keep")

    def test_unreadable_descendants_and_read_failures(self):
        path = self.artifact()
        for item in [path / "nested" / "screenshot.png", path / "nested", path / cleanup.MARKER]:
            original = item.stat().st_mode
            try:
                item.chmod(0)
                self.run_cleanup()
                self.assertTrue(path.exists())
            finally:
                item.chmod(original)
        with patch.object(cleanup.os, "scandir", side_effect=PermissionError):
            self.run_cleanup()
            self.assertTrue(path.exists())
        read = Path.open
        def unreadable(item, *args, **kwargs):
            if item.name == "screenshot.png":
                raise OSError("read failed")
            return read(item, *args, **kwargs)
        with patch.object(Path, "open", unreadable):
            self.run_cleanup()
            self.assertTrue(path.exists())

    def test_invalid_or_unfinished_markers(self):
        invalid = [dict(version=True), dict(version=2), dict(kind="different"), dict(pid=True),
                   dict(pid=0), dict(pid=-1), dict(pid=1.5), dict(pid="42"),
                   dict(startedAt=None), dict(startedAt=""), dict(finishedAt=None), dict(finishedAt="")]
        for index, fields in enumerate(invalid):
            path = self.artifact(f"apple-browser-qa-invalid-{index}", **fields)
            self.run_cleanup()
            self.assertTrue(path.exists())
        for index, text in enumerate(["not json", "[]", '{"version":1}']):
            path = self.artifact(f"apple-browser-qa-json-{index}")
            (path / cleanup.MARKER).write_text(text)
            self.age(path)
            self.run_cleanup()
            self.assertTrue(path.exists())
        path = self.artifact("apple-browser-qa-unfinished")
        marker = path / cleanup.MARKER
        owner = json.loads(marker.read_text())
        del owner["finishedAt"]
        marker.write_text(json.dumps(owner))
        self.age(path)
        self.run_cleanup()
        self.assertTrue(path.exists())

    def test_days_and_invalid_cli_inputs(self):
        path = self.artifact()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(cleanup.main(["--root", str(self.root), "--days", "31"]), 0)
            self.assertTrue(path.exists())
            for value in ["0", "-1", "1.5", "NaN", "Infinity", "no"]:
                with self.subTest(value=value), self.assertRaises(SystemExit) as error:
                    cleanup.main(["--root", str(self.root), "--days", value])
                self.assertEqual(error.exception.code, 2)
            self.assertEqual(cleanup.main(["--root", str(self.root / "missing")]), 1)
            with self.assertRaises(SystemExit):
                cleanup.main(["--root", str(path / cleanup.MARKER)])
            self.assertEqual(cleanup.main(["--root", str(self.root), "--days", "14"]), 0)
        self.assertFalse(path.exists())

    def test_marker_wiring_without_browsers(self):
        code = r"""
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const scripts = process.argv[1];
const browser = readFileSync(scripts + '/benchmark-browser-use.mjs', 'utf8');
const start = browser.slice(browser.indexOf('const owner='), browser.indexOf('const exec='));
const finish = browser.slice(browser.indexOf('if(report.backends.every'), browser.indexOf('console.log(JSON.stringify({artifacts'));
for (const backends of [
  [{kind:'local-playwright',cleanup:{localTerminated:true}}],
  [{kind:'local-playwright',cleanup:{localTerminated:false}}],
  [{kind:'local-playwright',cleanup:{localTerminated:true,disconnectError:'failed'}}],
  [{kind:'local-playwright',cleanup:{localTerminated:true}}, {kind:'browser-use-cloud',cleanup:{cloudStopped:true}}],
  [{kind:'local-playwright',cleanup:{localTerminated:true}}, {kind:'browser-use-cloud',cleanup:{stopError:'failed'}}],
]) {
  const writes = [];
  const context = {process:{pid:42}, artifacts:'/disposable', report:{backends},
    join:(...parts)=>parts.join('/'), writeFile:async (path,text)=>writes.push(JSON.parse(text))};
  await vm.runInNewContext('(async()=>{' + start + finish + '})()', context);
  assert.equal(writes[0].version, 1); assert.equal(writes[0].kind, 'browser-use-benchmark');
  assert.equal(writes[0].pid, 42); assert.equal(typeof writes[0].startedAt, 'string');
  assert.equal(writes[0].finishedAt, undefined);
  const success = backends.every(r=>!r.cleanup.disconnectError &&
    (r.kind==='local-playwright' ? r.cleanup.localTerminated===true : r.cleanup.cloudStopped===true));
  assert.equal(writes.length, success ? 2 : 1);
  if (success) assert.equal(typeof writes[1].finishedAt, 'string');
}
const native = readFileSync(scripts + '/apple-browser-qa.mjs', 'utf8');
const body = native.slice(native.indexOf('async function test()'), native.lastIndexOf('\ntry {'));
for (const out of [undefined, '/persistent']) for (const failed of [false, true]) {
  const writes = [];
  const test = vm.runInNewContext('async function driverProcesses() { return []; }\n' + body + '\ntest', {
    assert, AbortController, process:{platform:'darwin',pid:42,once(){},removeListener(){}},
    options:{browser:'ios',out},
    driverPath:'/usr/bin/safaridriver', existsSync:()=>true, command:async()=> 'test version',
    simctl:async()=>{}, inventory:async()=>{},
    mkdtemp:async()=>'/disposable', tmpdir:()=>'/tmp', resolve:value=>value,
    mkdir:async()=>{}, join:(...parts)=>parts.join('/'),
    writeFile:async(path,text)=>{if(path.endsWith('.browser-qa-owner.json')) writes.push(JSON.parse(text));},
    cleanupSimulator:async report=>{if(failed) report.cleanup.simulatorError='failed';},
  });
  await test(); // Missing runtime stops before any native resource can be created.
  assert.equal(writes.length, out ? 0 : failed ? 1 : 2);
  if (!out) {
    assert.equal(writes[0].version, 1); assert.equal(writes[0].kind, 'apple-browser-qa');
    assert.equal(writes[0].pid, 42); assert.equal(typeof writes[0].startedAt, 'string');
    assert.equal(writes[0].finishedAt, undefined);
    if (!failed) assert.equal(typeof writes[1].finishedAt, 'string');
  }
}
{
  const writes = [], requests = [];
  const driver = {pid:73,exitCode:null,signalCode:null,on(){},removeListener(){},stderr:{on(){}},
    kill(signal){this.signalCode=signal;return true;}};
  const test = vm.runInNewContext('async function driverProcesses() { return []; }\n' + body + '\ntest', {
    assert, AbortController, AbortSignal:{timeout(){},any(){}},
    process:{platform:'darwin',pid:42,once(){},removeListener(){}}, options:{browser:'safari'},
    driverPath:'/usr/bin/safaridriver', existsSync:()=>true, command:async()=> 'test version',
    mkdtemp:async()=>'/disposable', tmpdir:()=>'/tmp', mkdir:async()=>{},
    join:(...parts)=>parts.join('/'),
    writeFile:async(path,text)=>{if(path.endsWith('.browser-qa-owner.json')) writes.push(JSON.parse(text));},
    createPortServer:()=>({listen(){},address:()=>({port:9000}),close(callback){callback();}}),
    once:async()=>[], spawn:()=>driver, pause:async()=>{},
    fetch:async(url,{method})=>{
      const path = new URL(url).pathname;
      requests.push(method + ' ' + path);
      if (method==='POST' && path==='/session') throw new Error('Session creation timed out');
      assert.equal(path, '/status');
      return {ok:true,json:async()=>({value:{ready:true}})};
    },
    simctl:async()=>{}, inventory:async()=>{}, cleanupSimulator:async()=>{},
  });
  const report = await test();
  assert.deepEqual(requests, ['GET /status', 'POST /session']);
  assert.equal(report.ownedDriverPid, 73);
  assert.equal(report.error, 'Session creation timed out');
  assert.equal(report.cleanup.driverTerminated, true);
  assert.equal(report.cleanup.sessionDeleted, undefined);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].finishedAt, undefined);
}
"""
        result = subprocess.run(["node", "--input-type=module", "-e", code, str(SCRIPTS)],
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
