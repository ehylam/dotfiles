import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, mkdir, readdir, readFile, writeFile, stat, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {STOREFRONT_OVERLAYS} from './storefront-overlays.mjs';

const exec = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function validateIosJourney(value) {
  assert.ok(value && value.version === 1 && Array.isArray(value.steps), 'iOS journey requires version 1 and steps');
  assert.ok(value.steps.length > 0 && value.steps.length <= 40, 'iOS journey needs 1 to 40 steps');
  assert.deepEqual(Object.keys(value).sort(), ['steps', 'version'], 'Unknown iOS journey property');
  let assertions = 0;
  for (const step of value.steps) {
    assert.ok(step && typeof step === 'object' && !Array.isArray(step));
    const keys = {assertText: ['action', 'text', 'visible', 'timeoutMs'],
      waitFor: ['action', 'text', 'label', 'kind', 'visible', 'timeoutMs', 'scopeLabel'],
      tap: ['action', 'label', 'kind', 'optional', 'timeoutMs', 'scopeLabel', 'allowToolbarCovered', 'expectText'],
      scrollTo: ['action', 'label', 'kind', 'scopeLabel', 'maxSwipes', 'direction', 'timeoutMs'],
      dismissOverlay: ['action', 'overlay', 'scopeLabel', 'timeoutMs'],
      swipe: ['action', 'from', 'to'], screenshot: ['action', 'name'],
      navigate: ['action', 'path', 'expectText', 'timeoutMs'], back: ['action', 'expectText', 'timeoutMs'],
      dismissKeyboard: ['action', 'timeoutMs']}[step.action];
    assert.ok(keys, 'iOS actions: assertText, waitFor, tap, scrollTo, dismissOverlay, swipe, screenshot, navigate, back, dismissKeyboard');
    assert.ok(Object.keys(step).every(key => keys.includes(key)), 'Unknown iOS step property');
    const text = key => assert.ok(typeof step[key] === 'string' && step[key].trim() && step[key].length <= 200, `Invalid ${key}`);
    if (step.timeoutMs !== undefined) assert.ok(Number.isInteger(step.timeoutMs) && step.timeoutMs >= 1 && step.timeoutMs <= 30000, 'timeoutMs must be 1 to 30000');
    if (step.scopeLabel !== undefined) text('scopeLabel');
    if (step.action === 'assertText') {
      text('text'); assertions++;
      assert.ok(step.visible === undefined || typeof step.visible === 'boolean', 'visible must be boolean');
    }
    if (step.action === 'waitFor') {
      assert.ok(Boolean(step.text) !== Boolean(step.label), 'waitFor requires exactly one text or label');
      text(step.text ? 'text' : 'label');
      assert.ok(step.visible === undefined || typeof step.visible === 'boolean', 'visible must be boolean');
      if (step.text) assert.equal(step.kind, undefined, 'Text waitFor does not take kind');
      else assert.ok(['button', 'link', 'text'].includes(step.kind), 'Label waitFor requires kind');
    }
    if (['tap', 'scrollTo'].includes(step.action)) {
      text('label'); assert.ok(['button', 'link', 'text'].includes(step.kind), 'tap kind must be button, link or text');
    }
    if (step.action === 'tap') {
      for (const key of ['optional', 'allowToolbarCovered']) assert.ok(step[key] === undefined || typeof step[key] === 'boolean', `${key} must be boolean`);
      if (step.expectText !== undefined) { text('expectText'); if (!step.optional) assertions++; }
      if (step.allowToolbarCovered) {
        text('expectText');
        assert.ok(!step.optional, 'Toolbar-covered taps cannot be optional');
      }
    }
    if (step.action === 'scrollTo') {
      assert.ok(step.maxSwipes === undefined || (Number.isInteger(step.maxSwipes) && step.maxSwipes >= 1 && step.maxSwipes <= 10), 'maxSwipes must be 1 to 10');
      assert.ok(step.direction === undefined || ['up', 'down'].includes(step.direction), 'scrollTo direction must be up or down');
    }
    if (step.action === 'dismissOverlay') {
      assert.ok(Object.hasOwn(STOREFRONT_OVERLAYS, step.overlay), 'Unknown storefront overlay');
      text('scopeLabel');
    }
    if (step.action === 'swipe') {
      for (const key of ['from', 'to']) assert.ok(Array.isArray(step[key]) && step[key].length === 2
        && step[key].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0.05 && n <= 0.95), 'Swipe points must be within the webview (0.05 to 0.95)');
      assert.notDeepEqual(step.from, step.to, 'Swipe points must differ');
    }
    if (step.action === 'screenshot') text('name');
    if (step.action === 'navigate') {
      // A path keeps navigation on the starting origin; the native runner resolves it.
      text('path'); assert.ok(step.path.startsWith('/') && !step.path.startsWith('//') && !/[\s\\]/.test(step.path), 'navigate path must be a same-origin absolute path');
    }
    if (['navigate', 'back'].includes(step.action)) { text('expectText'); assertions++; }
  }
  assert.ok(assertions > 0, 'A journey needs a native text assertion; screenshots alone do not prove behaviour');
  return value;
}

export async function validateIosAttachments(directory, simulator, steps = 0) {
  const root = await realpath(directory);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json')));
  assert.ok(Array.isArray(manifest) && manifest.length === 1 && manifest[0].testIdentifier === 'SafariTests/testNativeJourney()', 'Attachments must belong to the executed native test');
  const images = [];
  for (const item of manifest[0].attachments) {
    if (!item.exportedFileName?.endsWith('.png')) continue;
    assert.equal(item.deviceId, simulator, 'Screenshot belongs to another simulator');
    assert.equal(basename(item.exportedFileName), item.exportedFileName, 'Screenshot path escapes attachments');
    const path = join(root, item.exportedFileName);
    assert.equal(await realpath(path), resolve(path), 'Screenshot must not be a symlink');
    const bytes = await readFile(path);
    assert.ok(bytes.length >= 67 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && bytes.subarray(12, 16).toString() === 'IHDR' && bytes.subarray(-8, -4).toString() === 'IEND'
      && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0, 'Screenshot is missing or not a complete PNG');
    images.push({path, name: item.suggestedHumanReadableName, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)});
  }
  assert.ok(images.some(image => image.name?.startsWith('Safari final state_')), 'Final native screenshot is missing');
  for (let i = 1; i <= steps; i++) assert.ok(images.some(image => image.name?.startsWith(`Step ${i} `)), `Step ${i} native screenshot is missing`);
  return images;
}

export async function readIosJourneyEvidence(directory, simulator) {
  const root = await realpath(directory);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json')));
  assert.ok(Array.isArray(manifest) && manifest.length === 1 && manifest[0].testIdentifier === 'SafariTests/testNativeJourney()', 'Native diagnostics must belong to the executed test');
  const entries = manifest[0].attachments.filter(item => item.suggestedHumanReadableName?.startsWith('Safari journey evidence_'));
  assert.equal(entries.length, 1, 'Native journey evidence attachment is missing or ambiguous');
  const item = entries[0];
  assert.equal(item.deviceId, simulator, 'Native diagnostics belong to another simulator');
  assert.equal(basename(item.exportedFileName), item.exportedFileName, 'Native diagnostics path escapes attachments');
  const path = join(root, item.exportedFileName);
  assert.equal(await realpath(path), resolve(path), 'Native diagnostics must not be a symlink');
  assert.ok((await stat(path)).size <= 65536, 'Native diagnostics exceed 64 KiB');
  const evidence = JSON.parse(await readFile(path, 'utf8'));
  assert.ok(Array.isArray(evidence.steps) && evidence.steps.length <= 40 && Array.isArray(evidence.dialogs) && evidence.dialogs.length <= 12, 'Invalid native evidence bounds');
  for (const step of evidence.steps) assert.ok(['completed', 'skipped', 'failed'].includes(step.status), 'Unknown native step status');
  return evidence;
}

export function validateXctestResults(summary, tests, simulator) {
  assert.equal(summary.result, 'Passed');
  assert.equal(summary.totalTestCount, 1);
  assert.equal(summary.passedTests, 1);
  for (const key of ['failedTests', 'skippedTests', 'expectedFailures']) assert.equal(summary[key], 0);
  assert.deepEqual(summary.devicesAndConfigurations.map(entry => entry.device.deviceId), [simulator]);
  const cases = [];
  const walk = node => { if (node.nodeType === 'Test Case') cases.push(node); (node.children || []).forEach(walk); };
  tests.testNodes.forEach(walk);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].nodeIdentifier, 'SafariTests/testNativeJourney()');
  assert.equal(cases[0].result, 'Passed');
}

export async function testXctest({options, command, inventory, driverProcesses, fixtureServer, cleanupSimulator}) {
  assert.equal(process.platform, 'darwin');
  assert.equal(options.browser, 'ios');
  assert.ok(options.runtime, 'XCTest requires an explicit --runtime');
  assert.ok(!options.journey && options.selector === 'h1' && !options.diagnose, 'XCTest does not use CSS selectors, WebDriver diagnostics or Node journeys');
  if (options.url) {
    assert.ok(/^https?:\/\//.test(options.url), '--url must use http or https');
    assert.ok(options.expect?.trim() || options['ios-journey'], 'XCTest URL smoke requires --expect page text or --ios-journey');
  }
  let journey;
  if (options['ios-journey']) {
    assert.ok(options.url, 'iOS journey requires an explicit URL');
    const path = await realpath(resolve(options['ios-journey']));
    assert.ok(!basename(path).startsWith('.env'), 'Environment files are not journey manifests');
    assert.ok((await stat(path)).size <= 32768, 'iOS journey exceeds 32 KiB');
    const bytes = await readFile(path);
    journey = {path, sha256: createHash('sha256').update(bytes).digest('hex'), manifest: validateIosJourney(JSON.parse(bytes))};
  }
  assert.deepEqual(await driverProcesses(), [], 'Another SafariDriver exists; run native QA serially');
  const before = await inventory();
  assert.ok(before.runtimes.some(runtime => runtime.identifier === options.runtime), 'Requested runtime is unavailable');
  assert.ok(before.devices.every(device => device.state !== 'Booted'), 'Existing booted simulator; leave it untouched');
  const out = options.out ? resolve(options.out) : await mkdtemp(join(tmpdir(), 'apple-ios-xctest-qa-'));
  await mkdir(out, {recursive: true});
  const resultBundle = join(out, 'NativeResult.xcresult');
  await stat(resultBundle).then(() => { throw new Error('Existing result bundle; use a fresh --out directory'); }, error => {
    if (error.code !== 'ENOENT') throw error;
  });
  const report = {browser: 'Native Mobile Safari in iOS Simulator', transport: 'xctest', runtime: options.runtime,
    fixture: !options.url, out, resultBundle, checks: [], cleanup: {}, commands: [], passed: false,
    initialDeviceIds: before.devices.map(device => device.udid), initialBootedDevices: []};
  if (journey) report.journey = journey;
  report.coverage = journey ? 'Native journey assertions; screenshots require visual review' : options.url ? 'Text existence smoke only' : 'Synthetic native fixture';
  const abort = new AbortController();
  const interrupted = () => abort.abort(new Error('Interrupted; cleaning up owned resources'));
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  let simulator, local;
  const run = async (bin, args, timeout = 60000) => {
    abort.signal.throwIfAborted();
    const evidence = {bin, args}; report.commands.push(evidence);
    const job = exec(bin, args, {timeout, signal: abort.signal, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024});
    const child = job.child;
    evidence.pid = child.pid;
    let exited = false;
    const exit = new Promise(resolve => {
      child.once('exit', () => { exited = true; resolve(); });
      child.on('error', error => { if (!child.pid) { exited = true; resolve(); } });
    });
    try {
      const result = await job;
      evidence.stdout = result.stdout; evidence.stderr = result.stderr;
      return result.stdout.trim();
    } catch (error) {
      evidence.error = error.message; evidence.stdout = error.stdout; evidence.stderr = error.stderr;
      throw error;
    } finally {
      await Promise.race([exit, pause(3000)]);
      evidence.exited = exited;
      if (!exited) {
        report.cleanup.commandError = `Owned command ${child.pid} did not confirm exit`;
        child.unref(); child.stdout?.unref?.(); child.stderr?.unref?.();
      }
    }
  };
  const sim = (...args) => run('/usr/bin/xcrun', ['simctl', ...args]);
  try {
    const source = fileURLToPath(new URL('./apple-ios-xctest/SafariQA.xcodeproj', import.meta.url));
    const derived = join(out, 'DerivedData');
    report.xcodeVersion = await run('/usr/bin/xcodebuild', ['-version']);
    await run('/usr/bin/xcodebuild', ['build-for-testing', '-project', source, '-scheme', 'SafariQA',
      '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', derived,
      `CLANG_MODULE_CACHE_PATH=${join(out, 'ModuleCache')}`, `SWIFT_MODULE_CACHE_PATH=${join(out, 'SwiftModuleCache')}`, 'CODE_SIGNING_ALLOWED=NO'], 600000);
    const products = join(derived, 'Build', 'Products');
    const files = (await readdir(products)).filter(name => name.endsWith('.xctestrun'));
    assert.equal(files.length, 1, 'Expected one generated XCTest runner');
    const runner = join(products, files[0]);
    const config = JSON.parse(await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', runner]));
    assert.ok(config.SafariTests?.EnvironmentVariables, 'Generated XCTest configuration does not match the test target');
    abort.signal.throwIfAborted();
    const current = await inventory();
    assert.ok(current.devices.every(device => device.state !== 'Booted'), 'A simulator was booted during build; stop');
    report.ownedSimulatorName = `codex-xctest-${process.pid}-${Date.now()}`;
    const createdSimulator = await sim('create', report.ownedSimulatorName, options['device-type'], options.runtime);
    assert.match(createdSimulator, /^[A-F0-9-]{36}$/i);
    assert.ok(!report.initialDeviceIds.some(id => id.toUpperCase() === createdSimulator.toUpperCase()), 'Create returned an existing device');
    simulator = createdSimulator;
    report.ownedSimulator = simulator;
    await sim('boot', simulator);
    await run('/usr/bin/xcrun', ['simctl', 'bootstatus', simulator, '-b'], Number(options['boot-timeout']) * 1000);
    if (!options.url) local = await fixtureServer();
    report.url = options.url || local.url;
    Object.assign(config.SafariTests.EnvironmentVariables, {SAFARI_QA_URL: report.url, SAFARI_QA_FIXTURE: local ? '1' : '0', SAFARI_QA_EXPECT: options.expect || '',
      SAFARI_QA_JOURNEY: journey ? JSON.stringify(journey.manifest) : '', SAFARI_QA_OVERLAYS: JSON.stringify(STOREFRONT_OVERLAYS)});
    await writeFile(runner, JSON.stringify(config));
    await run('/usr/bin/plutil', ['-convert', 'xml1', runner]);
    await run('/usr/bin/xcodebuild', ['test-without-building', '-xctestrun', runner,
      '-destination', `platform=iOS Simulator,id=${simulator}`, '-parallel-testing-enabled', 'NO',
      '-maximum-concurrent-test-simulator-destinations', '1', '-collect-test-diagnostics', 'never', '-resultBundlePath', resultBundle], 300000);
    report.nativeSummary = JSON.parse(await run('/usr/bin/xcrun', ['xcresulttool', 'get', 'test-results', 'summary', '--path', resultBundle, '--compact']));
    report.nativeTests = JSON.parse(await run('/usr/bin/xcrun', ['xcresulttool', 'get', 'test-results', 'tests', '--path', resultBundle, '--compact']));
    validateXctestResults(report.nativeSummary, report.nativeTests, simulator);
    if (local) {
      assert.deepEqual(local.requests, [{market: 'NZ', quantity: 2}]);
      report.requests = local.requests;
      report.checks = ['Navigation and heading', 'Native disclosure tap', 'NZ market change', 'Native quantity input', 'Async cart POST and rendered result'];
    } else if (journey) {
      assert.equal(createHash('sha256').update(await readFile(journey.path)).digest('hex'), journey.sha256, 'iOS journey changed during execution');
      report.checks = journey.manifest.steps.map((step, i) => `Step ${i + 1}: ${step.action}${step.text ? ` ${JSON.stringify(step.text)} (${step.visible === false ? 'existence' : 'hittable'})` : ''}`);
    } else report.checks = ['Native URL navigation and expected page text (accessibility-tree existence)'];
    report.passed = true;
  } catch (error) { report.error = error.message; }
  finally {
    if (await stat(resultBundle).then(() => true, () => false)) {
      try {
        const attachments = join(out, 'attachments');
        const args = ['xcresulttool', 'export', 'attachments', '--path', resultBundle, '--output-path', attachments];
        report.commands.push({bin: '/usr/bin/xcrun', args, diagnostics: true, timeoutMs: 10000});
        await command('/usr/bin/xcrun', args, 10000);
        report.attachments = attachments;
        report.nativeJourney = await readIosJourneyEvidence(attachments, simulator);
        report.dialogDiagnostics = {dialogs: report.nativeJourney.dialogs, limits: report.nativeJourney.limits, scope: report.nativeJourney.scope};
        report.screenshots = await validateIosAttachments(attachments, simulator, report.passed && journey ? journey.manifest.steps.length : 0);
        if (journey && report.passed) {
          assert.equal(report.nativeJourney.steps.length, journey.manifest.steps.length, 'Native step results are incomplete');
          for (const [index, result] of report.nativeJourney.steps.entries()) {
            const step = journey.manifest.steps[index];
            assert.equal(result.step, index + 1); assert.equal(result.action, step.action);
            assert.ok(result.status !== 'failed', 'Native journey contains a failed step');
            if (result.status === 'skipped') assert.ok(step.optional === true || ['dismissOverlay', 'dismissKeyboard'].includes(step.action), 'Required native step was skipped');
            if (step.allowToolbarCovered) assert.equal(result.assertion, 'Changed-state text became hittable', 'Coordinate tap lacks changed-state proof');
          }
          report.checks = report.nativeJourney.steps.map(step => `Step ${step.step}: ${step.action}: ${step.status}${step.reason ? ` (${step.reason})` : ''}`);
        }
      } catch (error) { report.attachmentError = error.message; }
    }
    await cleanupSimulator(report, simulator, (...args) => command('/usr/bin/xcrun', ['simctl', ...args], 60000), inventory);
    try {
      const after = (await inventory()).devices;
      report.cleanup.initialDevicesPreserved = before.devices.every(device => after.some(current => current.udid === device.udid && current.state === device.state));
    } catch (error) { report.cleanup.inventoryError = error.message; }
    if (local) await new Promise(resolve => local.server.close(resolve));
    if (abort.signal.aborted && !report.error) report.error = abort.signal.reason.message;
    process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
    if (report.error || report.attachmentError || report.cleanup.commandError || report.cleanup.simulatorError || !report.cleanup.initialDevicesPreserved || (report.ownedSimulatorName && !report.cleanup.ownedSimulatorDeleted)) report.passed = false;
    await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
  if (!report.passed) process.exitCode = 1;
  const {commands, nativeSummary, nativeTests, initialDeviceIds, ...summary} = report;
  return {...summary, reportPath: join(out, 'report.json')};
}
