import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {assertVisible, decodeToolResult} from './apple-safari-mcp-qa.mjs';

const source = await readFile(new URL('./apple-safari-mcp-qa.mjs', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('const message ='), source.indexOf('export function decodeToolResult'));
const watchExit = vm.runInNewContext(`${helpers}\nwatchExit`, {Error, String, Promise});

const spawned = new EventEmitter();
spawned.pid = 123;
const report = {};
let exited = false;
const exit = watchExit(spawned, report, 'driverError').then(() => { exited = true; });
spawned.emit('error', new Error('EPERM signal denied'));
await Promise.resolve();
assert.equal(exited, false, 'An error is not confirmation that a launched child exited');
assert.equal(report.driverError, 'EPERM signal denied');
spawned.emit('exit', 0);
await exit;
assert.equal(exited, true);

const failedSpawn = new EventEmitter();
const failedReport = {};
const failedExit = watchExit(failedSpawn, failedReport, 'driverError');
failedSpawn.emit('error', new Error('ENOENT failed spawn'));
await failedExit;
assert.equal(failedReport.driverError, 'ENOENT failed spawn');
assert.match(source, /report\.driverError \|\| report\.observerError/);
assert.match(source, /abort\.signal\.throwIfAborted\(\);\s*driver = spawn/);
assert.match(source, /if \(abort\.signal\.aborted && !report\.error\) report\.error/);
assert.match(source, /if \(diagnosticScript\) \{\s*try \{ report\.dialogDiagnostics = await captureStorefrontDiagnostics/,
  'Generic MCP journey errors must retain bounded dialog diagnostics without relying on timeout wording');
assert.match(source, /event\.request === request/);
const result = value => ({content: [{type: 'text', text: value}]});
assert.equal(decodeToolResult('switch_tab', {handle: 'page-owned'}, result('Switched to tab page-owned')), 'Switched to tab page-owned');
assert.throws(() => decodeToolResult('switch_tab', {handle: 'page-owned'}, result('Switched to tab page-other')));
assert.throws(() => decodeToolResult('evaluate_javascript', {}, result('not JSON')));
assert.equal(decodeToolResult('evaluate_javascript', {}, result('null')), null);
assert.throws(() => decodeToolResult('page_interactions', {}, result('{"requested":2,"successful":1}')));
assert.throws(() => decodeToolResult('switch_tab', {}, {...result('Switched to tab undefined'), isError: true}));
assertVisible({visibility: 'visible', hidden: false, focus: false}, 'Animation');
for (const state of [null, {}, {visibility: 'hidden', hidden: true}, {visibility: 'visible', hidden: true}]) {
  assert.throws(() => assertVisible(state, 'Animation'), error => error.code === 'QA_BLOCKED');
}
const observer = await readFile(new URL('./apple-browser-observer.swift', import.meta.url), 'utf8');
assert.match(observer, /owned\.count == 1 && !initial\.contains/);
assert.match(observer, /com\.apple\.SafariTechnologyPreview/);
console.log('PASS: spawn failure versus confirmed exit, denied signal, interruption guards and fresh lifecycle correlation; no native apps launched');
