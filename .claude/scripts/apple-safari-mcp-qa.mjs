import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp, mkdir, readFile, writeFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {deepQueryAll, nativeClickScript, captureStorefrontDiagnostics, dismissStorefrontOverlay} from './storefront-overlays.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const message = error => error instanceof Error ? error.message : String(error);
const watchExit = (child, report, key) => new Promise(resolve => {
  child.on('error', error => {
    report[key] = message(error);
    if (!child.pid) resolve();
  });
  child.once('exit', resolve);
});

export function decodeToolResult(name, args, result) {
  assert.ok(!result.isError, `Native MCP ${name} failed`);
  const value = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
  let decoded;
  try { decoded = JSON.parse(value); }
  catch {
    if (name === 'screenshot') return value;
    if (name === 'switch_tab' && value === `Switched to tab ${args.handle}`) return value;
    throw new Error(`Native MCP ${name} returned invalid JSON or acknowledgement`);
  }
  assert.ok(!decoded?.failureReason, decoded?.failureReason);
  if (decoded?.requested !== undefined) assert.equal(decoded.successful, decoded.requested, 'Native interactions did not all succeed');
  return decoded;
}

export function assertVisible(state, stage) {
  if (state?.visibility !== 'visible' || state?.hidden !== false) {
    const error = new Error(`BLOCKED: ${stage}: Safari page is hidden; foreground rendering/animation is unverified`);
    error.code = 'QA_BLOCKED';
    throw error;
  }
}

export async function testMcp({options, driverPath, command, driverProcesses, fixtureServer}) {
  assert.equal(options.browser, 'safari', 'MCP transport currently supports desktop Safari only');
  assert.equal(options.driver, 'technology-preview', 'MCP QA requires the verified Technology Preview driver');
  assert.deepEqual(await driverProcesses(), [], 'Another SafariDriver exists; leave its session untouched');
  if (options.url) assert.ok(/^https?:\/\//.test(options.url), '--url must use http or https');
  const out = options.out ? resolve(options.out) : await mkdtemp(join(tmpdir(), 'apple-safari-mcp-qa-'));
  await mkdir(out, {recursive: true});
  const screenshot = join(out, 'screenshot.png');
  await stat(screenshot).then(() => { throw new Error('Existing screenshot; use a fresh --out directory'); }, error => {
    if (error.code !== 'ENOENT') throw error;
  });
  const report = {browser: 'Native desktop Safari Technology Preview', transport: 'mcp', driverPath,
    fixture: !options.url, out, checks: [], operations: [], cleanup: {}, passed: false};
  report.coverage = !options.url ? 'Synthetic native fixture; not client acceptance'
    : options.visible ? 'Visible-mode assertions; acceptance limited to the reviewed journey'
    : 'DOM/native-input assertions; foreground animation and visual acceptance not established';
  const source = fileURLToPath(new URL('./apple-browser-observer.swift', import.meta.url));
  await command('/usr/bin/xcrun', ['swiftc', '-module-cache-path', join(out, 'module-cache'), source, '-o', join(out, 'observer')], 60000);
  let observer, driver, local, diagnosticScript;
  const abort = new AbortController();
  const interrupted = () => abort.abort(new Error('Interrupted; cleaning up owned resources'));
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  const pending = new Map();
  let nextId = 0;
  const observerEvents = [];
  let observerExit, driverExit;
  try {
    observer = spawn(join(out, 'observer'), [], {stdio: ['pipe', 'pipe', 'pipe']});
    observerExit = watchExit(observer, report, 'observerError');
    observer.stdin.on('error', error => { report.observerError = message(error); });
    const observation = createInterface({input: observer.stdout});
    observation.on('line', line => {
      try { observerEvents.push(JSON.parse(line)); }
      catch { report.observerError = 'Invalid lifecycle response'; }
    });
    const readyStarted = Date.now();
    while (!observerEvents.some(event => event.event === 'ready')) {
      abort.signal.throwIfAborted();
      assert.ok(!report.observerError && observer.exitCode === null && Date.now() - readyStarted < 10000, 'Browser lifecycle observer did not start');
      await pause(50);
    }
    report.driverVersion = await command(driverPath, ['--version']);
    abort.signal.throwIfAborted();
    driver = spawn(driverPath, ['--mcp'], {stdio: ['pipe', 'pipe', 'pipe']});
    report.ownedDriverPid = driver.pid;
    driverExit = watchExit(driver, report, 'driverError');
    const rejectPending = error => { for (const settle of [...pending.values()]) settle({error: {message: message(error)}}); };
    driverExit.then(() => rejectPending(new Error('MCP driver exited')));
    driver.stdin.on('error', rejectPending);
    driver.stderr.on('data', chunk => { report.driverStderr = (report.driverStderr || '') + chunk; });
    const replies = createInterface({input: driver.stdout});
    replies.on('line', line => {
      try { const reply = JSON.parse(line); pending.get(reply.id)?.(reply); }
      catch { report.protocolError = 'Invalid JSON-RPC response'; rejectPending(new Error(report.protocolError)); }
    });
    const request = (method, params, {timeoutMs = 30000, diagnostics = false} = {}) => new Promise((resolve, reject) => {
      if (!diagnostics) abort.signal.throwIfAborted();
      const id = ++nextId;
      const settle = (error, value) => {
        clearTimeout(deadline); pending.delete(id); abort.signal.removeEventListener('abort', onAbort);
        if (error) reject(error); else resolve(value);
      };
      const onAbort = () => settle(abort.signal.reason);
      const deadline = setTimeout(() => settle(new Error(`MCP ${method} timed out`)), timeoutMs);
      pending.set(id, reply => settle(reply.error ? new Error(JSON.stringify(reply.error)) : undefined, reply.result));
      if (!diagnostics) abort.signal.addEventListener('abort', onAbort, {once: true});
      driver.stdin.write(JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n');
    });
    report.server = await request('initialize', {protocolVersion: '2024-11-05', capabilities: {}, clientInfo: {name: 'apple-browser-qa', version: '1'}});
    driver.stdin.write(JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'}) + '\n');
    const tool = async (name, args = {}) => {
      if (options.visible && ['page_interactions', 'screenshot'].includes(name)) await requireVisible(`Before ${name}`);
      const result = await request('tools/call', {name, arguments: args});
      report.operations.push({name, args, result});
      const decoded = decodeToolResult(name, args, result);
      if (options.visible && name === 'page_interactions') await requireVisible('After native input');
      return decoded;
    };
    const script = async expression => tool('evaluate_javascript', {expression});
    diagnosticScript = async expression => decodeToolResult('evaluate_javascript', {}, await request('tools/call',
      {name: 'evaluate_javascript', arguments: {expression}}, {timeoutMs: 2500, diagnostics: true}));
    const visibility = async stage => {
      const state = await script('return {visibility:document.visibilityState,hidden:document.hidden,focus:document.hasFocus()}');
      (report.visibility ||= []).push({stage, ...state});
      return state;
    };
    const requireVisible = async (stage = 'Journey assertion') => assertVisible(await visibility(stage), stage);
    const content = async () => JSON.parse((await tool('get_page_content', {format: 'json', nodeIds: 'interactive', includeSelectOptions: true})).content);
    const click = async selector => {
      const point = await script(nativeClickScript(selector));
      await tool('page_interactions', {interactions: [{type: 'click', point, purpose: `Activate ${selector}`}]});
    };
    const dismissOverlay = async (overlay, settings) => {
      const result = await dismissStorefrontOverlay({script, signal: abort.signal,
        input: (point, purpose) => tool('page_interactions', {interactions: [{type: 'click', point, purpose}]})}, overlay, settings);
      (report.overlays ||= []).push(result);
      return result;
    };
    const deepQuery = async selector => script(`const deepQueryAll=${deepQueryAll.toString()};return deepQueryAll(${JSON.stringify(selector)}).map(e=>({tag:e.tagName.toLowerCase(),id:e.id,rect:e.getBoundingClientRect().toJSON()}));`);
    if (!options.url) local = await fixtureServer();
    report.url = options.url || local.url;
    await tool('navigate_to_url', {url: report.url});
    await visibility('After navigation');
    if (options.visible) {
      const tabs = await tool('list_tabs');
      assert.equal(tabs.length, 1, 'Visible mode expects one owned navigation tab; no user tabs selected');
      await tool('switch_tab', {handle: tabs[0].handle});
      const activationRequest = `activate-stp ${Date.now()}`;
      observer.stdin.write(activationRequest + '\n');
      const started = Date.now();
      while (!observerEvents.some(event => event.request === activationRequest) && Date.now() - started < 5000) {
        abort.signal.throwIfAborted(); await pause(50);
      }
      report.activation = observerEvents.find(event => event.request === activationRequest);
      let state;
      do {
        abort.signal.throwIfAborted();
        state = await visibility('Foreground probe');
        if (state.visibility === 'visible' && state.hidden === false) break;
        await pause(100);
      } while (Date.now() - started < 10000);
      assertVisible(state, 'Before journey');
      report.checks.push('Visible native page before journey');
    }
    const selected = await script(`return document.querySelector(${JSON.stringify(options.selector)})?.innerText`);
    assert.equal(typeof selected, 'string', 'Selected element is missing');
    if (options.expect) assert.ok(selected.includes(options.expect), 'Selected element does not contain --expect text');
    report.checks.push('Navigation and selected element', ...(options.expect ? ['Expected element text'] : []));
    if (local) {
      await click('#details');
      assert.equal(await script('return document.querySelector("#description").hidden'), false);
      const nodes = [];
      const walk = node => { nodes.push(node); (node.children || []).forEach(walk); };
      walk(await content());
      const market = nodes.find(node => node.id === 'market');
      const quantity = nodes.find(node => node.label === 'Quantity');
      assert.ok(market?.uid && quantity?.uid, 'Native control handles are missing');
      await tool('page_interactions', {interactions: [{type: 'click', node: market.uid, purpose: 'Open market control'}, {type: 'selectMenuItem', text: 'New Zealand', purpose: 'Choose NZ market'}]});
      assert.equal(await script('return document.querySelector("#price").textContent'), 'NZD 45');
      await tool('page_interactions', {interactions: [{type: 'type', node: quantity.uid, value: '2', replaceAll: true, purpose: 'Set quantity'}]});
      assert.equal(await script('return document.querySelector("#quantity").value'), '2');
      await click('#add');
      const cartStarted = Date.now();
      while (await script('return document.querySelector("#cart").textContent') !== '2 \u00d7 Everyday tee | NZ | 90 NZD') {
        assert.ok(Date.now() - cartStarted < 10000, 'Rendered cart result timed out');
        await pause(100);
      }
      assert.equal(await script('return document.querySelector("#cart").textContent'), '2 \u00d7 Everyday tee | NZ | 90 NZD');
      assert.deepEqual(local.requests, [{market: 'NZ', quantity: 2}]);
      report.checks.push('Details disclosure', 'NZ market change', 'Native quantity input', 'Async cart POST and rendered result');
    }
    if (options.journey) {
      const path = resolve(options.journey);
      const hash = bytes => createHash('sha256').update(bytes).digest('hex');
      const sha256 = hash(await readFile(path));
      report.journey = {path, sha256};
      const deadline = setTimeout(() => abort.abort(new Error('Journey exceeded 120 seconds')), 120000);
      try {
        let rejectAborted;
        const aborted = new Promise((_, reject) => { rejectAborted = reject; });
        const onAbort = () => rejectAborted(abort.signal.reason);
        abort.signal.addEventListener('abort', onAbort, {once: true});
        abort.signal.throwIfAborted();
        try {
          const run = async () => {
            const module = await import(pathToFileURL(path).href);
            assert.equal(typeof module.default, 'function', 'Journey must export a default function');
            return module.default({tool, script, click, requireVisible, dismissOverlay, deepQuery, out, signal: abort.signal});
          };
          const result = await Promise.race([aborted, run()]);
          if (result !== undefined) report.journey.result = JSON.parse(JSON.stringify(result));
        }
        finally { abort.signal.removeEventListener('abort', onAbort); }
        abort.signal.throwIfAborted();
        assert.equal(hash(await readFile(path)), sha256, 'Journey entry file changed during execution');
      } finally { clearTimeout(deadline); }
    }
    if (options.visible) await requireVisible('Before final screenshot');
    report.page = await script('return {title:document.title,userAgent:navigator.userAgent,width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visibility:document.visibilityState,hidden:document.hidden}');
    await tool('screenshot', {savePath: screenshot});
    const png = await readFile(screenshot);
    assert.ok(png.length > 24 && png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0, 'Native screenshot is missing or not a PNG');
    report.screenshot = {path: screenshot, bytes: png.length, width: png.readUInt32BE(16), height: png.readUInt32BE(20)};
    if (options.visible) await requireVisible('After final screenshot');
    else await visibility('After final screenshot');
    const tabs = await tool('list_tabs');
    report.tabs = tabs;
    report.passed = true;
  } catch (error) {
    report.error = message(error); report.passed = false;
    if (error?.code === 'QA_BLOCKED') report.status = 'BLOCKED';
    if (diagnosticScript) {
      try { report.dialogDiagnostics = await captureStorefrontDiagnostics(diagnosticScript); }
      catch (diagnosticError) { report.dialogDiagnostics = {error: message(diagnosticError), scope: 'Owned page diagnostics unavailable'}; }
    }
  }
  finally {
    if (driver) {
      driver.stdin.end();
      let exited = false;
      await Promise.race([driverExit.then(() => { exited = true; }), pause(10000)]);
      if (!exited) {
        try { driver.kill('SIGTERM'); } catch (error) { report.driverError = message(error); }
        await Promise.race([driverExit.then(() => { exited = true; }), pause(5000)]);
      }
      if (!exited) {
        try { driver.kill('SIGKILL'); } catch (error) { report.driverError = message(error); }
        await Promise.race([driverExit.then(() => { exited = true; }), pause(5000)]);
      }
      report.cleanup.driverTerminated = exited;
    }
    if (observer) {
      const started = Date.now();
      let sequence = 0;
      for (;;) {
        const request = `snapshot ${++sequence}`;
        observer.stdin.write(request + '\n');
        const responseStarted = Date.now();
        while (!observerEvents.some(event => event.request === request) && observer.exitCode === null && Date.now() - responseStarted < 1000) await pause(50);
        const snapshot = observerEvents.find(event => event.request === request);
        if (snapshot?.launched.every(app => app.terminated) || Date.now() - started >= 10000 || observer.exitCode !== null) {
          report.cleanup.browserObservation = snapshot;
          report.cleanup.appsExited = !!snapshot && snapshot.launched.every(app => app.terminated);
          report.cleanup.initialAppsPreserved = snapshot?.initialPreserved === true;
          break;
        }
        await pause(100);
      }
      observer.stdin.end('finish\n');
      let exited = false;
      await Promise.race([observerExit.then(() => { exited = true; }), pause(2000)]);
      if (!exited) {
        try { observer.kill('SIGTERM'); } catch (error) { report.observerError = message(error); }
        await Promise.race([observerExit.then(() => { exited = true; }), pause(2000)]);
      }
      if (!exited) {
        try { observer.kill('SIGKILL'); } catch (error) { report.observerError = message(error); }
        await Promise.race([observerExit.then(() => { exited = true; }), pause(2000)]);
      }
      report.cleanup.observerTerminated = exited;
      report.observerEvents = observerEvents;
    }
    if (local) await new Promise(resolve => local.server.close(resolve));
    process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
    if (abort.signal.aborted && !report.error) report.error = message(abort.signal.reason);
    if (report.passed && !report.cleanup.browserObservation?.launched.length) report.error = 'No native app launch observed';
    if (report.cleanup.driverTerminated !== true || report.cleanup.observerTerminated !== true || report.cleanup.appsExited !== true || report.cleanup.initialAppsPreserved !== true || report.driverError || report.observerError || report.error) report.passed = false;
    report.status ||= report.passed ? 'PASS' : 'FAIL';
    await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
  if (!report.passed) process.exitCode = 1;
  const {operations, observerEvents: events, visibility, ...summary} = report;
  return {...summary, ...(visibility ? {visibility: {initial: visibility[0], latest: visibility.at(-1), samples: visibility.length}} : {}), reportPath: join(out, 'report.json')};
}
