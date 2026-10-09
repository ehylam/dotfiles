#!/usr/bin/env node
// Native Safari/Mobile Safari QA, activated only by an explicit command.
import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createServer as createPortServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {promisify, parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {page as fixture} from './benchmark-browser-fixture.mjs';
import {captureStorefrontDiagnostics} from './storefront-overlays.mjs';

const exec = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const args = parseArgs({allowPositionals: true, options: {
  browser: {type: 'string', default: 'safari'}, runtime: {type: 'string'},
  'device-type': {type: 'string', default: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16'},
  url: {type: 'string'}, selector: {type: 'string', default: 'h1'},
  expect: {type: 'string'}, out: {type: 'string'}, diagnose: {type: 'boolean'}, help: {type: 'boolean'},
  journey: {type: 'string'},
  'ios-journey': {type: 'string'}, visible: {type: 'boolean'},
  driver: {type: 'string', default: 'safari'},
  transport: {type: 'string', default: 'webdriver'},
  'boot-timeout': {type: 'string', default: '300'},
}});
const options = args.values;
if (options.help || !args.positionals.length) {
  console.log('apple-browser-qa.mjs preflight | test [--browser safari|ios] [--driver safari|technology-preview] [--transport webdriver|mcp|xctest] [--runtime <simctl runtime ID>] [--device-type <ID>] [--boot-timeout <seconds, default 300>] [--url <URL> --selector <CSS> --expect <text> --journey <trusted local .mjs> | --ios-journey <steps.json>] [--visible (desktop MCP)] [--out <directory>] [--diagnose]');
  process.exit(0);
}
assert.equal(args.positionals.length, 1);
assert.ok(['preflight', 'test'].includes(args.positionals[0]), 'Use preflight or test');
assert.ok(['safari', 'ios'].includes(options.browser), 'browser must be safari or ios');
assert.ok(['safari', 'technology-preview'].includes(options.driver), 'driver must be safari or technology-preview');
assert.ok(['webdriver', 'mcp', 'xctest'].includes(options.transport), 'transport must be webdriver, mcp or xctest');
if (options.transport === 'mcp') assert.ok(options.browser === 'safari' && options.driver === 'technology-preview', 'MCP QA requires desktop Technology Preview');
if (options.transport === 'xctest') assert.ok(options.browser === 'ios' && options.driver === 'safari', 'XCTest requires --browser ios and no Technology Preview driver');
if (options.journey) assert.ok(args.positionals[0] === 'test' && options.url,
  '--journey requires test with an explicit --url');
if (options['ios-journey']) assert.ok(args.positionals[0] === 'test' && options.url && options.transport === 'xctest',
  '--ios-journey requires an explicit URL and XCTest transport');
if (options.visible) assert.ok(args.positionals[0] === 'test' && options.transport === 'mcp',
  '--visible requires a desktop MCP test');
const bootTimeout = Number(options['boot-timeout']);
assert.ok(Number.isInteger(bootTimeout) && bootTimeout >= 1 && bootTimeout <= 3600,
  'boot-timeout must be an integer from 1 to 3600 seconds');
// Session deletion stops the driver, but can leave its separate Safari app running.
if (args.positionals[0] === 'test' && options.browser === 'safari' && options.transport === 'webdriver') {
  console.error('BLOCKED: desktop Safari tests are disabled until owned app cleanup is verified. No browser launched.');
  process.exit(1);
}
const command = async (bin, params, timeout = 15000) => (await exec(bin, params, {timeout, maxBuffer: 4 * 1024 * 1024})).stdout.trim();
const driverPath = options.driver === 'technology-preview'
  ? '/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver'
  : '/usr/bin/safaridriver';
const simctl = (...params) => command('/usr/bin/xcrun', ['simctl', ...params], 60000);

async function inventory() {
  const all = JSON.parse(await simctl('list', '--json'));
  return {
    runtimes: all.runtimes.filter(r => r.isAvailable && r.platform === 'iOS').map(r => ({identifier: r.identifier, version: r.version, name: r.name})),
    devices: Object.entries(all.devices).flatMap(([runtime, devices]) => devices.filter(d => d.isAvailable).map(d => ({runtime, name: d.name, udid: d.udid, state: d.state}))),
    deviceTypes: all.devicetypes.filter(d => ['iPhone', 'iPad'].includes(d.productFamily)).map(d => ({name: d.name, identifier: d.identifier})),
  };
}

async function driverProcesses() {
  const ps = await command('/bin/ps', ['-axo', 'pid=,comm=']);
  return ps.split('\n').filter(line => /\/safaridriver$/.test(line.trim()));
}

async function preflight() {
  const report = {platform: process.platform, safariDriver: existsSync('/usr/bin/safaridriver'),
    selectedDriver: {name: options.driver, path: driverPath, installed: existsSync(driverPath)},
    testAvailability: {safari: {status: 'BLOCKED', reason: 'Production desktop WebDriver app ownership and confirmed app exit are unverified'},
      safariTechnologyPreviewMcp: {status: 'UNVERIFIED', reason: 'Explicit --driver technology-preview --transport mcp required; preflight does not probe native input or cleanup'},
      iosXctest: {status: 'UNVERIFIED', reason: 'Explicit --browser ios --transport xctest and compatible Xcode/runtime required; preflight does not run tests'},
      ios: {status: 'UNVERIFIED', reason: 'Requires an available native session; preflight does not test one'}},
    remoteAutomation: 'Not changed or session-probed', labels: {safari: 'Native desktop Safari', ios: 'Native Mobile Safari in a newly created iOS Simulator', webkit: 'Playwright WebKit is a separate engine build, not installed Safari or real iOS'}};
  for (const [key, operation] of Object.entries({macOS: () => command('/usr/bin/sw_vers', ['-productVersion']), developerDirectory: () => command('/usr/bin/xcode-select', ['-p']), safariVersion: () => command('/usr/bin/safaridriver', ['--version']), selectedDriverVersion: () => command(driverPath, ['--version']), xcode: () => command('/usr/bin/xcodebuild', ['-version']), simulators: inventory, existingDrivers: driverProcesses})) {
    try { report[key] = await operation(); } catch (error) { report[key] = {error: error.message.split('\n')[0]}; }
  }
  return report;
}

async function fixtureServer() {
  const requests = [];
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/cart/add.js' && req.method === 'POST') {
        let body = ''; for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body);
        requests.push(payload);
        res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(payload));
      } else if (req.url === '/api/diagnostic-failure') {
        res.writeHead(503).end('Intentional fixture failure');
      } else {
        res.writeHead(200, {'Content-Type': 'text/html'}).end(fixture);
      }
    } catch { res.writeHead(400).end('Invalid fixture request'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return {server, requests, url: `http://127.0.0.1:${server.address().port}/`};
}

async function cleanupSimulator(report, simulator, simctl, inventory) {
  if (!simulator && report.ownedSimulatorName) {
    try {
      const matches = (await inventory()).devices.filter(d => d.name === report.ownedSimulatorName
        && d.runtime === report.runtime && !report.initialDeviceIds.some(id => id.toUpperCase() === d.udid.toUpperCase()));
      assert.ok(matches.length <= 1, 'Ambiguous owned simulator name; cleanup needs review');
      simulator = matches[0]?.udid;
      if (!simulator) throw new Error('Failed create could not be resolved; inspect the recorded owned simulator name');
      report.ownedSimulator = simulator;
    } catch (error) { report.cleanup.simulatorError = error.message.split('\n')[0]; return; }
  }
  if (!simulator) return;
  try {
    assert.match(simulator, /^[A-F0-9-]{36}$/i, 'Invalid owned simulator UUID');
    assert.ok(Array.isArray(report.initialDeviceIds), 'Missing initial device inventory; cleanup refused');
    assert.ok(!report.initialDeviceIds.some(id => id.toUpperCase() === simulator.toUpperCase()), 'Existing device is not owned; cleanup refused');
    assert.ok(Array.isArray(report.initialBootedDevices), 'Missing initial booted device inventory; cleanup refused');
    await simctl('shutdown', simulator).catch(() => {}); // Shutdown devices already stopped can reject.
    await simctl('delete', simulator);
    report.cleanup.ownedSimulatorDeleted = true;
    const after = (await inventory()).devices;
    assert.ok(!after.some(d => d.udid === simulator), 'Owned simulator remains after deletion');
    report.cleanup.initialBootedDevicesStillBooted = report.initialBootedDevices.every(id => after.some(d => d.udid === id && d.state === 'Booted'));
  } catch (error) { report.cleanup.simulatorError = error.message.split('\n')[0]; }
}

async function test() {
  assert.equal(process.platform, 'darwin', 'Native Safari requires macOS');
  // ponytail: process snapshot only; serialize native Safari runs instead of adding a global coordinator.
  assert.deepEqual(await driverProcesses(), [], 'Another SafariDriver exists; leave its session untouched');
  if (options.url) assert.ok(/^https?:\/\//.test(options.url), '--url must use http or https');
  const out = options.out ? resolve(options.out) : await mkdtemp(join(tmpdir(), 'apple-browser-qa-'));
  await mkdir(out, {recursive: true});
  const owner = options.out ? undefined : {version: 1, kind: 'apple-browser-qa', pid: process.pid, startedAt: new Date().toISOString()};
  if (owner) await writeFile(join(out, '.browser-qa-owner.json'), JSON.stringify(owner));
  const report = {browser: options.browser === 'ios' ? 'Native Mobile Safari in iOS Simulator' : 'Native desktop Safari', driverPath, fixture: !options.url, out, checks: [], cleanup: {}, passed: false};
  let driver, session, simulator, local, base;
  let stderr = '';
  const abort = new AbortController();
  const interrupt = () => abort.abort(new Error('Interrupted; cleaning up owned resources'));
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  async function request(method, path, body, cleanup = false, timeoutMs = 10000) {
    const signal = cleanup ? AbortSignal.timeout(timeoutMs) : AbortSignal.any([abort.signal, AbortSignal.timeout(path === '/session' ? 90000 : 30000)]);
    const response = await fetch(base + path, {method, headers: {'Content-Type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal});
    const result = await response.json();
    if (!response.ok || result.value?.error) throw new Error(result.value?.message || `WebDriver HTTP ${response.status}`);
    return result.value;
  }
  try {
    assert.ok(existsSync(driverPath), 'Selected SafariDriver is not installed');
    report.driverVersion = await command(driverPath, ['--version']);
    const capabilities = {browserName: 'Safari', platformName: options.browser === 'ios' ? 'iOS' : 'macOS'};
    if (options.browser === 'ios') {
      assert.ok(options.runtime, 'ios requires --runtime from preflight; never auto-select a user simulator');
      const available = await inventory();
      assert.ok(available.runtimes.some(r => r.identifier === options.runtime), 'Requested iOS runtime is unavailable');
      assert.ok(available.deviceTypes.some(d => d.identifier === options['device-type']), 'Requested device type is unavailable');
      report.initialBootedDevices = available.devices.filter(d => d.state === 'Booted').map(d => d.udid);
      report.initialDeviceIds = available.devices.map(d => d.udid);
      assert.deepEqual(report.initialBootedDevices, [],
        'Another simulator is already booted; finish or shut it down before starting an isolated iOS check');
      report.runtime = options.runtime;
      report.ownedSimulatorName = `apple-browser-qa-${process.pid}-${Date.now()}`;
      const createdSimulator = await simctl('create', report.ownedSimulatorName, options['device-type'], options.runtime);
      assert.match(createdSimulator, /^[A-F0-9-]{36}$/i, 'simctl did not return a new simulator UUID');
      assert.ok(!report.initialDeviceIds.some(id => id.toUpperCase() === createdSimulator.toUpperCase()), 'Create returned an existing device');
      simulator = createdSimulator;
      report.ownedSimulator = simulator;
      await simctl('boot', simulator);
      await command('/usr/bin/xcrun', ['simctl', 'bootstatus', simulator, '-b'], bootTimeout * 1000);
      report.safariLaunch = await simctl('launch', simulator, 'com.apple.mobilesafari');
      if (options.diagnose) {
        try { report.simulatorInspector = (await simctl('spawn', simulator, 'launchctl', 'print', 'system/com.apple.webinspectord')).split('\n').filter(line => /^\s*(state|pid|runs|last exit code|program|path) =/.test(line)).join('\n'); }
        catch (error) { report.simulatorInspector = {error: error.message}; }
      }
      capabilities['safari:useSimulator'] = true;
      capabilities['safari:deviceUDID'] = simulator;
    }
    const portServer = createPortServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening');
    const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve));
    base = `http://127.0.0.1:${port}`;
    driver = spawn(driverPath, ['-p', String(port), ...(options.diagnose ? ['--diagnose'] : [])], {stdio: ['ignore', 'ignore', 'pipe']});
    report.diagnosticsEnabled = !!options.diagnose;
    driver.on('error', error => { stderr += error.message; });
    driver.stderr.on('data', chunk => { stderr += chunk.toString(); });
    report.ownedDriverPid = driver.pid;
    const started = Date.now();
    for (;;) {
      assert.ok(!abort.signal.aborted, 'Interrupted');
      assert.ok(driver.exitCode === null && Date.now() - started < 10000, stderr || 'SafariDriver did not start');
      try { await request('GET', '/status'); break; } catch { await pause(100); }
    }
    report.requestedCapabilities = capabilities;
    const created = await request('POST', '/session', {capabilities: {alwaysMatch: capabilities}});
    session = created.sessionId;
    assert.ok(session, 'WebDriver did not return a session ID');
    report.capabilities = created.capabilities;
    const call = (method, path, body) => request(method, `/session/${session}${path}`, body);
    const script = (source, params = []) => call('POST', '/execute/sync', {script: source, args: params});
    const element = async selector => (await call('POST', '/element', {using: 'css selector', value: selector}))['element-6066-11e4-a52e-4f735466cecf'];
    const click = async selector => call('POST', `/element/${await element(selector)}/click`, {});
    await call('POST', '/timeouts', {pageLoad: 30000, script: 15000, implicit: 5000});
    if (options.browser === 'safari') await call('POST', '/window/rect', {width: 1280, height: 1000});
    if (!options.url) local = await fixtureServer();
    await call('POST', '/url', {url: options.url || local.url});
    report.url = await call('GET', '/url');
    await element(options.selector);
    const selectedText = await script('return document.querySelector(arguments[0]).innerText;', [options.selector]);
    if (options.expect) assert.ok(selectedText.includes(options.expect), 'Selected element does not contain --expect text');
    report.checks.push('Navigation and selected element', ...(options.expect ? ['Expected element text'] : []));
    if (options.journey) {
      abort.signal.throwIfAborted();
      let rejectInterrupted;
      const interrupted = new Promise((_, reject) => { rejectInterrupted = reject; });
      const onAbort = () => rejectInterrupted(abort.signal.reason);
      abort.signal.addEventListener('abort', onAbort, {once: true});
      const deadline = setTimeout(() => abort.abort(new Error('Journey exceeded 120 seconds')), 120000);
      try {
        // Bound asynchronous module loading and assertions; trusted code must not block the event loop.
        await Promise.race([interrupted, (async () => {
          const journeyPath = resolve(options.journey);
          const hash = bytes => createHash('sha256').update(bytes).digest('hex');
          const sha256 = hash(await readFile(journeyPath));
          abort.signal.throwIfAborted();
          report.journey = {path: journeyPath, sha256};
          const journey = await import(pathToFileURL(journeyPath).href);
          abort.signal.throwIfAborted();
          assert.equal(typeof journey.default, 'function', 'Journey must export a default function');
          const result = await journey.default({call, script, element, click, out, signal: abort.signal});
          abort.signal.throwIfAborted();
          assert.equal(hash(await readFile(journeyPath)), sha256, 'Journey entry file changed during execution');
          abort.signal.throwIfAborted();
          const json = JSON.stringify(result);
          report.journey.result = json === undefined ? undefined : JSON.parse(json);
        })()]);
      } finally {
        clearTimeout(deadline);
        abort.signal.removeEventListener('abort', onAbort);
      }
    }
    if (local) {
      assert.equal(await call('GET', '/title'), 'Benchmark Store');
      await click('#details');
      assert.equal(await script('return document.querySelector("#description").hidden;'), false);
      await click('#market option[value="NZ"]');
      assert.equal(await script('return document.querySelector("#price").textContent;'), 'NZD 45');
      const quantity = await element('#quantity');
      await call('POST', `/element/${quantity}/clear`, {});
      await call('POST', `/element/${quantity}/value`, {text: '2'});
      await click('#add');
      const start = Date.now();
      while (await script('return document.querySelector("#cart").hidden;')) {
        assert.ok(Date.now() - start < 10000, 'Cart did not render'); await pause(100);
      }
      assert.equal(await script('return document.querySelector("#cart").textContent;'), '2 × Everyday tee | NZ | 90 NZD');
      assert.deepEqual(local.requests, [{market: 'NZ', quantity: 2}]);
      report.checks.push('Details disclosure', 'NZ market change', 'Native quantity input', 'Async cart POST and rendered result');
    }
    report.page = await script('return {title:document.title,userAgent:navigator.userAgent,width:innerWidth,height:innerHeight,dpr:devicePixelRatio};');
    await writeFile(join(out, 'screenshot.png'), Buffer.from(await call('GET', '/screenshot'), 'base64'));
    report.passed = true;
  } catch (error) {
    report.error = typeof error?.message === 'string' ? error.message
      : error === null || (typeof error !== 'object' && typeof error !== 'function') ? String(error)
      : 'Unknown failure';
    report.errorDetail = {
      ...(typeof error?.code === 'string' || Number.isFinite(error?.code) ? {code: error.code} : {}),
      ...(typeof error?.signal === 'string' ? {signal: error.signal} : {}),
      ...(typeof error?.killed === 'boolean' ? {killed: error.killed} : {}),
      ...(typeof error?.stdout === 'string' ? {stdout: error.stdout.trim().slice(-4000)} : {}),
      ...(typeof error?.stderr === 'string' ? {stderr: error.stderr.trim()} : {})};
    if (session) {
      try { report.dialogDiagnostics = await captureStorefrontDiagnostics(source => request('POST', `/session/${session}/execute/sync`, {script: source, args: []}, true, 2500)); }
      catch (diagnosticError) { report.dialogDiagnostics = {error: diagnosticError.message, scope: 'Owned page diagnostics unavailable'}; }
    }
    process.exitCode = 1;
  } finally {
    if (session) {
      try { await request('DELETE', `/session/${session}`, undefined, true); report.cleanup.sessionDeleted = true; }
      catch (error) { report.cleanup.sessionError = error.message; }
    }
    if (driver?.pid) {
      const alive = () => driver.exitCode === null && driver.signalCode === null;
      const waitForExit = async () => {
        const controller = new AbortController();
        const deadline = setTimeout(() => controller.abort(), 3000);
        try { await once(driver, 'exit', {signal: controller.signal}); }
        catch (error) { if (!controller.signal.aborted) throw error; }
        finally { clearTimeout(deadline); }
      };
      const onCleanupError = error => { report.cleanup.driverError ||= error.message; };
      driver.on('error', onCleanupError);
      try {
        if (alive()) driver.kill('SIGTERM');
        if (alive()) await waitForExit();
        if (alive()) driver.kill('SIGKILL');
        if (alive()) await waitForExit();
        if (alive()) throw new Error('Owned SafariDriver did not exit after SIGTERM and SIGKILL');
      } catch (error) {
        report.cleanup.driverError ||= error?.message || String(error);
      } finally {
        driver.removeListener('error', onCleanupError);
      }
      report.cleanup.driverTerminated = driver.exitCode !== null || driver.signalCode !== null;
      if (!report.cleanup.driverTerminated) {
        // Release parent handles so a surviving driver cannot hide the failing report.
        driver.stderr.unref();
        driver.unref();
      }
    }
    await cleanupSimulator(report, simulator, simctl, inventory);
    if (local) await new Promise(resolve => local.server.close(error => {
      if (error) report.cleanup.fixtureError = error.message;
      resolve();
    }));
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    if (report.cleanup.sessionError || report.cleanup.driverError || report.cleanup.simulatorError || report.cleanup.fixtureError || report.cleanup.driverTerminated === false
        || report.cleanup.initialBootedDevicesStillBooted === false) {
      report.passed = false;
      process.exitCode = 1;
    }
    await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
    if (owner && !report.cleanup.sessionError && !report.cleanup.driverError && !report.cleanup.simulatorError && !report.cleanup.fixtureError
        && (!session || report.cleanup.sessionDeleted === true)
        && (!driver?.pid || (session && report.cleanup.driverTerminated === true))
        && (!report.ownedSimulatorName || report.cleanup.ownedSimulatorDeleted === true)
        && report.cleanup.initialBootedDevicesStillBooted !== false) {
      owner.finishedAt = new Date().toISOString();
      await writeFile(join(out, '.browser-qa-owner.json'), JSON.stringify(owner));
    }
  }
  return report;
}

try {
  const result = args.positionals[0] === 'preflight' ? await preflight()
    : options.transport === 'mcp' ? await (await import('./apple-safari-mcp-qa.mjs')).testMcp({options, driverPath, command, driverProcesses, fixtureServer})
    : options.transport === 'xctest' ? await (await import('./apple-ios-xctest-qa.mjs')).testXctest({options, command, inventory, driverProcesses, fixtureServer, cleanupSimulator})
    : await test();
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
