#!/usr/bin/env node
// Isolated ownership/failure checks. Does not launch Safari or a simulator.
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {EventEmitter, once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(new URL('./apple-browser-qa.mjs', import.meta.url), 'utf8');
for (const args of [['test'], ['test', '--browser', 'safari', '--url', 'http://localhost/fixture'],
  ['test', '--browser', 'safari', '--driver', 'technology-preview']]) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./apple-browser-qa.mjs', import.meta.url)), ...args], {encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /BLOCKED: desktop Safari tests are disabled/);
  assert.equal(result.stdout, '');
}
const launchGuard = source.indexOf("if (args.positionals[0] === 'test' && options.browser === 'safari' && options.transport === 'webdriver')");
assert.ok(launchGuard > 0 && launchGuard < source.indexOf('const command ='));
assert.ok(!source.includes('process.kill('), 'Do not infer app ownership and signal discovered PIDs');
const preflightBody = source.slice(source.indexOf('async function preflight()'), source.indexOf('async function fixtureServer()'));
const availability = await vm.runInNewContext(preflightBody + '\npreflight()', {
  process: {platform: 'darwin'}, existsSync: () => true, command: async () => 'installed',
  options: {driver: 'safari'}, driverPath: '/usr/bin/safaridriver',
  inventory: async () => ({devices: []}), driverProcesses: async () => [],
});
assert.equal(availability.testAvailability.safari.status, 'BLOCKED');
assert.match(availability.testAvailability.safari.reason, /ownership.*exit.*unverified/);
assert.equal(availability.testAvailability.ios.status, 'UNVERIFIED');
assert.equal(availability.selectedDriver.path, '/usr/bin/safaridriver');
assert.equal(availability.selectedDriverVersion, 'installed');
for (const value of ['unknown', '/tmp/safaridriver', 'Safari', '']) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./apple-browser-qa.mjs', import.meta.url)),
    'preflight', '--driver', value], {encoding: 'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /driver must be safari or technology-preview/);
}
const driverSelection = source.slice(source.indexOf('const driverPath ='), source.indexOf('const simctl ='));
for (const [name, expected] of [['safari', '/usr/bin/safaridriver'],
  ['technology-preview', '/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver']]) {
  const path = vm.runInNewContext(driverSelection + '\ndriverPath', {options: {driver: name}});
  assert.equal(path, expected);
  const report = await vm.runInNewContext(preflightBody + '\npreflight()', {
    process: {platform: 'darwin'}, existsSync: () => false,
    options: {driver: name}, driverPath: path,
    command: async (bin, args) => {
      assert.ok(!args.includes('--enable'));
      if (bin === path && args[0] === '--version') throw new Error('Driver missing');
      return 'installed';
    }, inventory: async () => ({devices: []}), driverProcesses: async () => [],
  });
  assert.equal(report.selectedDriver.name, name);
  assert.equal(report.selectedDriver.installed, false);
  assert.equal(report.selectedDriverVersion.error, 'Driver missing');
  assert.equal(report.testAvailability.safari.status, 'BLOCKED');
}
const guardRoot = mkdtempSync(join(tmpdir(), 'safari-launch-guard-'));
try {
  const out = join(guardRoot, 'must-not-exist');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./apple-browser-qa.mjs', import.meta.url)),
    'test', '--browser', 'safari', '--out', out], {encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No browser launched/);
  assert.equal(existsSync(out), false, 'Blocked runs must not create output or ownership state');
} finally { rmSync(guardRoot, {recursive: true}); }
for (const args of [['preflight', '--journey', '/unused'], ['test', '--journey', '/unused']]) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./apple-browser-qa.mjs', import.meta.url)), ...args], {encoding: 'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--journey requires test with an explicit --url/);
}
for (const value of ['0', '3601', 'Infinity', 'NaN', '1.5']) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./apple-browser-qa.mjs', import.meta.url)),
    'preflight', '--boot-timeout', value], {encoding: 'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /boot-timeout must be an integer from 1 to 3600 seconds/);
}
const body = source.slice(source.indexOf('async function cleanupSimulator('), source.indexOf('async function test()'));
assert.ok(body.startsWith('async function cleanupSimulator('));
const cleanup = vm.runInNewContext(body + '\ncleanupSimulator', {assert});
const owned = '11111111-1111-1111-1111-111111111111';
const user = '22222222-2222-2222-2222-222222222222';
const make = () => ({cleanup: {}, ownedSimulatorName: 'apple-browser-qa-unique', runtime: 'ios-runtime',
  initialDeviceIds: [user], initialBootedDevices: [user]});
const userDevice = {udid: user, name: 'User iPhone', runtime: 'ios-runtime', state: 'Booted'};

const nativeTest = vm.runInNewContext('async function driverProcesses() { return []; }\n'
  + source.slice(source.indexOf('async function test()'), source.lastIndexOf('\ntry {')) + '\ntest', {
  assert, AbortController, process: {platform: 'darwin', once() {}, removeListener() {}},
  options: {browser: 'ios', runtime: 'ios-runtime', 'device-type': 'iphone', out: '/unused'},
  driverPath: '/usr/bin/safaridriver', existsSync: () => true, command: async () => 'test version',
  resolve: value => value, mkdir: async () => {}, writeFile: async () => {}, join: (...parts) => parts.join('/'),
  inventory: async () => ({runtimes: [{identifier: 'ios-runtime'}],
    deviceTypes: [{identifier: 'iphone'}], devices: [userDevice]}),
  simctl: async () => {throw new Error('Must not create a second simulator');},
  cleanupSimulator: cleanup,
});
const blocked = await nativeTest();
assert.equal(blocked.passed, false);
assert.match(blocked.error, /Another simulator is already booted/);
assert.equal(blocked.ownedSimulatorName, undefined);
for (const missing of [true, false]) {
  const run = vm.runInNewContext('async function driverProcesses() { return []; }\n'
    + source.slice(source.indexOf('async function test()'), source.lastIndexOf('\ntry {')) + '\ntest', {
    assert, AbortController, process: {platform: 'darwin', once() {}, removeListener() {}},
    options: {browser: 'ios', runtime: 'ios-runtime', out: '/unused'},
    driverPath: '/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver',
    existsSync: () => !missing, command: async () => {throw new Error('Version probe failed');},
    resolve: value => value, mkdir: async () => {}, writeFile: async () => {}, join: (...parts) => parts.join('/'),
    inventory: async () => {throw new Error('Must not enumerate or create simulator after driver prerequisite failure');},
    simctl: async () => {throw new Error('Must not create a simulator');}, cleanupSimulator: cleanup,
  });
  const report = await run();
  assert.equal(report.passed, false);
  assert.equal(report.error, missing ? 'Selected SafariDriver is not installed' : 'Version probe failed');
  assert.equal(report.ownedSimulatorName, undefined);
  assert.equal(report.ownedDriverPid, undefined);
}

// Stub module loading, not the session cleanup path, for credential-free failure checks.
const testBody = source.slice(source.indexOf('async function test()'), source.lastIndexOf('\ntry {'));
const importExpression = 'await import(pathToFileURL(journeyPath).href)';
assert.ok(testBody.includes(importExpression));
for (const mode of ['pass', 'throw', 'changed', 'invalid', 'import-throw', 'import-hang', 'hang', 'interrupt', 'bigint', 'cycle',
  'throw-null', 'throw-string', 'throw-object', 'error-bigint', 'error-cycle', 'error-stdio',
  'driver-signal-error', 'driver-refuses-exit', 'driver-force-exit', 'session-delete-error',
  'driver-emitted-error', 'driver-emitted-error-then-exit', 'technology-preview']) {
  const requests = [];
  const kills = [];
  const released = [];
  const driver = Object.assign(new EventEmitter(), {pid: 73, exitCode: null, signalCode: null,
    stderr: {on() {}, unref() {released.push('stderr');}}, unref() {released.push('driver');},
    kill(signal) {
      kills.push(signal);
      if (mode === 'driver-signal-error') throw new Error('Driver signal denied');
      if (mode === 'driver-emitted-error' || (mode === 'driver-emitted-error-then-exit' && signal === 'SIGTERM')) {
        this.emit('error', new Error('Emitted driver signal denial'));
        return false;
      }
      if (mode === 'driver-refuses-exit' || (mode === 'driver-force-exit' && signal === 'SIGTERM')) return false;
      this.signalCode = signal;
      return true;
    }});
  let reads = 0, invoked = 0, simulatorCleanup = 0;
  const signals = new Map(), files = new Map();
  const run = vm.runInNewContext('async function driverProcesses() { return []; }\n'
    + 'async function inventory() { return {devices: [], runtimes: [{identifier: "ios-runtime"}], deviceTypes: [{identifier: "iphone"}]}; }\n'
    + testBody.replace(importExpression, 'await loadJourney(journeyPath)') + '\ntest', {
    assert, AbortController, AbortSignal, Buffer, createHash, clearTimeout, bootTimeout: 300,
    setTimeout: (callback, ms) => setTimeout(callback,
      ['hang', 'import-hang'].includes(mode) || ms === 3000 ? 1 : ms),
    process: {platform: 'darwin', pid: 42, once(name, callback) {signals.set(name, callback);}, removeListener(name) {signals.delete(name);}},
    options: {browser: mode === 'technology-preview' ? 'ios' : 'safari', runtime: 'ios-runtime',
      'device-type': 'iphone', url: 'http://localhost/fixture', selector: '.controls', journey: '/trusted.mjs'},
    driverPath: mode === 'technology-preview' ? '/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver' : '/usr/bin/safaridriver',
    existsSync: () => true, command: async (bin, args) => {
      if (bin === '/usr/bin/xcrun') {
        assert.deepEqual(Array.from(args), ['simctl', 'bootstatus', owned, '-b']);
        return '';
      }
      assert.deepEqual(Array.from(args), ['--version']); return 'test version';
    },
    mkdtemp: async () => '/unused', tmpdir: () => '/tmp',
    resolve: value => value, mkdir: async () => {}, writeFile: async (path, bytes) => files.set(path, bytes), join: (...parts) => parts.join('/'),
    readFile: async () => Buffer.from(mode === 'changed' && ++reads > 1 ? 'changed entry' : 'original entry'),
    loadJourney: async () => {
      if (mode === 'import-throw') throw new Error('Module import failed');
      if (mode === 'import-hang') return new Promise(() => {});
      return {default: mode === 'invalid' ? null : async ({signal}) => {
      invoked++;
      assert.equal(signal.aborted, false);
      if (mode === 'throw') throw new Error('Journey assertion failed');
      if (mode === 'throw-null') throw null;
      if (mode === 'throw-string') throw 'String assertion failed';
      if (mode === 'throw-object') throw Object.create(null);
      if (mode.startsWith('error-')) {
        const error = new Error('Failure metadata control');
        if (mode === 'error-bigint') error.code = 1n;
        if (mode === 'error-cycle') {error.code = {}; error.code.self = error.code;}
        if (mode === 'error-stdio') {error.stdout = {}; error.stderr = 1n;}
        throw error;
      }
      if (mode === 'interrupt') {signals.get('SIGINT')(); return new Promise(() => {});}
      if (mode === 'hang') return new Promise(() => {});
      if (mode === 'bigint') return {value: 1n};
      if (mode === 'cycle') {const result = {}; result.self = result; return result;}
      return {assertedStates: 1};
    }};},
    createPortServer: () => ({listen() {}, address: () => ({port: 9000}), close: callback => callback()}),
    once: async (_emitter, event, {signal} = {}) => {
      if (event !== 'exit') return [];
      return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), {once: true}));
    },
    spawn: (bin, args) => {
      assert.equal(bin, mode === 'technology-preview' ? '/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver' : '/usr/bin/safaridriver');
      assert.ok(!args.includes('--enable'));
      return driver;
    }, pause: async () => {}, cleanupSimulator: async report => {
      simulatorCleanup++;
      if (mode === 'technology-preview') {
        report.cleanup.ownedSimulatorDeleted = true;
        report.cleanup.initialBootedDevicesStillBooted = true;
      }
    },
    simctl: async (...args) => {
      if (args[0] === 'create') {
        assert.equal(args[2], 'iphone'); assert.equal(args[3], 'ios-runtime'); return owned;
      }
      assert.equal(args[1], owned);
      assert.ok(args[0] === 'boot' || args[0] === 'launch');
      if (args[0] === 'launch') assert.equal(args[2], 'com.apple.mobilesafari');
      return '';
    }, inventory: async () => ({devices: [], runtimes: [{identifier: 'ios-runtime'}],
      deviceTypes: [{identifier: 'iphone'}]}),
    fetch: async (url, {method, body}) => {
      const path = new URL(url).pathname;
      requests.push(method + ' ' + path);
      if (method === 'POST' && path === '/session') {
        assert.deepEqual(JSON.parse(body), {capabilities: {alwaysMatch: mode === 'technology-preview'
          ? {browserName: 'Safari', platformName: 'iOS', 'safari:useSimulator': true, 'safari:deviceUDID': owned}
          : {browserName: 'Safari', platformName: 'macOS'}}});
      }
      if (mode === 'session-delete-error' && method === 'DELETE') throw new Error('Session deletion failed');
      const value = path === '/session' ? {sessionId: 'owned', capabilities: {browserName: 'Safari'}}
        : path.endsWith('/element') ? {'element-6066-11e4-a52e-4f735466cecf': 'control'}
        : path.endsWith('/screenshot') ? Buffer.from('PNG').toString('base64')
        : path.endsWith('/execute/sync') ? 'Next' : {};
      return {ok: true, json: async () => ({value})};
    },
  });
  const result = await run();
  assert.equal(result.passed, ['pass', 'driver-force-exit', 'technology-preview'].includes(mode), `${mode}: ${result.error}`);
  assert.equal(result.driverVersion, 'test version');
  assert.equal(result.cleanup.sessionDeleted, mode === 'session-delete-error' ? undefined : true);
  assert.equal(result.cleanup.driverTerminated, !['driver-signal-error', 'driver-refuses-exit', 'driver-emitted-error'].includes(mode));
  assert.deepEqual(released, result.cleanup.driverTerminated ? [] : ['stderr', 'driver']);
  assert.equal(driver.listenerCount('error'), 1, 'Only the original diagnostic listener remains');
  assert.equal(simulatorCleanup, 1, 'Driver cleanup failure must not skip simulator cleanup');
  if (mode === 'driver-signal-error') assert.match(result.cleanup.driverError, /Driver signal denied/);
  if (mode === 'driver-refuses-exit') assert.match(result.cleanup.driverError, /did not exit/);
  if (mode.startsWith('driver-emitted-error')) assert.match(result.cleanup.driverError, /Emitted driver signal denial/);
  if (mode === 'session-delete-error') assert.match(result.cleanup.sessionError, /Session deletion failed/);
  assert.deepEqual(kills, ['driver-refuses-exit', 'driver-force-exit', 'driver-emitted-error', 'driver-emitted-error-then-exit'].includes(mode)
    ? ['SIGTERM', 'SIGKILL'] : ['SIGTERM']);
  assert.equal(requests.filter(r => r === 'DELETE /session/owned').length, 1);
  assert.equal(invoked, ['invalid', 'import-throw', 'import-hang'].includes(mode) ? 0 : 1);
  assert.equal(result.journey.sha256, createHash('sha256').update('original entry').digest('hex'));
  if (mode === 'changed') assert.match(result.error, /entry file changed/);
  if (mode === 'throw') assert.match(result.error, /Journey assertion failed/);
  if (mode === 'invalid') assert.match(result.error, /default function/);
  if (mode === 'import-throw') assert.match(result.error, /Module import failed/);
  if (['hang', 'import-hang'].includes(mode)) assert.match(result.error, /Journey exceeded 120 seconds/);
  if (mode === 'interrupt') assert.match(result.error, /Interrupted; cleaning up/);
  if (mode === 'bigint') assert.match(result.error, /BigInt/);
  if (mode === 'cycle') assert.match(result.error, /circular/i);
  if (mode === 'throw-null') assert.equal(result.error, 'null');
  if (mode === 'throw-string') assert.equal(result.error, 'String assertion failed');
  if (mode === 'throw-object') assert.equal(result.error, 'Unknown failure');
  if (mode.startsWith('error-')) assert.equal(result.error, 'Failure metadata control');
  const persisted = JSON.parse(files.get('/unused/report.json'));
  assert.equal(persisted.passed, result.passed);
  assert.equal(persisted.error, result.error);
  assert.equal(signals.size, 0);
  assert.equal(result.requestedCapabilities.browserName, 'Safari');
  assert.equal(result.requestedCapabilities.platformName, mode === 'technology-preview' ? 'iOS' : 'macOS');
  if (mode === 'technology-preview') {
    assert.equal(result.ownedSimulator, owned);
    assert.equal(result.requestedCapabilities['safari:useSimulator'], true);
    assert.equal(result.requestedCapabilities['safari:deviceUDID'], owned);
  }
  const owner = JSON.parse(files.get('/unused/.browser-qa-owner.json'));
  assert.equal(typeof owner.finishedAt, ['driver-signal-error', 'driver-refuses-exit', 'session-delete-error',
    'driver-emitted-error', 'driver-emitted-error-then-exit'].includes(mode)
    ? 'undefined' : 'string', 'Incomplete cleanup must retain unfinished ownership evidence');
}

let report = make(), calls = [];
for (const initial of [user, 'ABCDEF00-1234-1234-1234-123456789ABC']) {
  report = {...make(), initialDeviceIds: [initial]}; calls = [];
  await cleanup(report, initial.toLowerCase(), async (...args) => calls.push(args), async () => ({devices: []}));
  assert.equal(calls.length, 0, 'Rejected existing simulator must never be stopped or deleted');
  assert.match(report.cleanup.simulatorError, /Existing device is not owned/);
}
report = {cleanup: {}, initialBootedDevices: []}; calls = [];
await cleanup(report, owned, async (...args) => calls.push(args), async () => ({devices: []}));
assert.equal(calls.length, 0);
assert.match(report.cleanup.simulatorError, /Missing initial device inventory/);
report = make(); calls = [];
await cleanup(report, owned, async (...args) => calls.push(args), async () => {throw new Error('Inventory unavailable');});
assert.deepEqual(calls, [['shutdown', owned], ['delete', owned]]);
assert.equal(report.cleanup.ownedSimulatorDeleted, true);
assert.match(report.cleanup.simulatorError, /Inventory unavailable/);

report = make(); calls = []; let reads = 0;
await cleanup(report, undefined, async (...args) => calls.push(args), async () => ({devices: ++reads === 1
  ? [userDevice, {udid: owned, name: report.ownedSimulatorName, runtime: report.runtime}]
  : [userDevice]}));
assert.deepEqual(calls, [['shutdown', owned], ['delete', owned]]);
assert.equal(report.ownedSimulator, owned);
assert.equal(report.cleanup.initialBootedDevicesStillBooted, true);
assert.equal(report.cleanup.simulatorError, undefined);

report = make(); calls = [];
await cleanup(report, undefined, async (...args) => calls.push(args), async () => ({devices:
  [{...userDevice, name: report.ownedSimulatorName}]}));
assert.equal(calls.length, 0); // An initial user device is never recovered as ours.
assert.match(report.cleanup.simulatorError, /could not be resolved/);

report = make();
await cleanup(report, owned, async command => {if (command === 'shutdown') throw new Error('Already shutdown');},
  async () => ({devices: [userDevice]}));
assert.equal(report.cleanup.ownedSimulatorDeleted, true);
assert.equal(report.cleanup.simulatorError, undefined);

report = make();
await cleanup(report, owned, async command => {if (command === 'delete') throw new Error('Deletion failed');},
  async () => ({devices: [userDevice]}));
assert.equal(report.cleanup.ownedSimulatorDeleted, undefined);
assert.match(report.cleanup.simulatorError, /Deletion failed/);

report = make();
await cleanup(report, owned, async () => {}, async () => ({devices: [{...userDevice, state: 'Shutdown'}]}));
assert.equal(report.cleanup.initialBootedDevicesStillBooted, false);

// Exercise the real ChildProcess exit contract without launching an Apple browser.
const driverCleanupBody = source.slice(source.indexOf('    if (driver?.pid) {'), source.indexOf('    await cleanupSimulator(report,'));
const stopDriver = vm.runInNewContext(`(async (driver, report) => {${driverCleanupBody}})`,
  {AbortController, once, setTimeout, clearTimeout});
for (const ignoreTerm of [false, true]) {
  const child = spawn(process.execPath, ['--eval',
    `${ignoreTerm ? 'process.on("SIGTERM", () => {});' : ''}setTimeout(() => process.exit(2), 10000);process.stdout.write("ready");`],
    {stdio: ['ignore', 'pipe', 'ignore']});
  try {
    await once(child.stdout, 'data');
    const report = {cleanup: {}};
    await stopDriver(child, report);
    assert.equal(report.cleanup.driverTerminated, true);
    assert.equal(report.cleanup.driverError, undefined);
    assert.equal(child.signalCode, ignoreTerm ? 'SIGKILL' : 'SIGTERM');
    assert.equal(child.listenerCount('exit'), 0, 'Timed-out exit listeners must be removed');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit');
    }
  }
}

// The test driver stops itself when its owning supervisor exits, including on timeout.
const supervisor = spawnSync(process.execPath, ['--input-type=module', '--eval', `
  import {spawn} from 'node:child_process';
  import {once} from 'node:events';
  const driver = spawn(process.execPath, ['--eval', ${JSON.stringify('const parent = process.ppid; setInterval(() => {try {process.kill(parent, 0);} catch {process.exit(0);}}, 20); setTimeout(() => process.exit(2), 5000); process.stderr.write("ready");')}],
    {stdio: ['ignore', 'ignore', 'pipe']});
  await once(driver.stderr, 'data');
  console.log(JSON.stringify({pid: driver.pid}));
  driver.on('error', () => {});
  driver.kill = () => {driver.emit('error', new Error('Test denial')); return false;};
  const report = {cleanup: {}};
  const stop = async (driver, report) => {${driverCleanupBody}};
  const nativeSetTimeout = globalThis.setTimeout;
  const setTimeout = (callback) => nativeSetTimeout(callback, 1);
  await stop(driver, report);
  console.log(JSON.stringify(report));
`], {encoding: 'utf8', timeout: 2000});
await new Promise(resolve => setTimeout(resolve, 100));
const supervisorRows = supervisor.stdout.trim().split('\n').map(line => JSON.parse(line));
const survivingPid = supervisorRows[0]?.pid;
if (survivingPid) {
  const started = Date.now();
  for (;;) {
    try { process.kill(survivingPid, 0); }
    catch (error) { assert.equal(error.code, 'ESRCH'); break; }
    assert.ok(Date.now() - started < 6000, 'Disposable test driver did not stop');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
assert.equal(supervisor.status, 0, supervisor.stderr || supervisor.error?.message);
assert.equal(supervisorRows[1].cleanup.driverTerminated, false);
assert.equal(supervisorRows[1].cleanup.driverError, 'Test denial');
console.log('PASS: journey failures and interruption cleanup; bounded driver termination, denied signals, forced exit, failed session deletion, report persistence and artifact retention; timeout validation, occupied-simulator guard, owned deletion and failed-create recovery');
