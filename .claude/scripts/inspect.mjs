#!/usr/bin/env node

/**
 * inspect.mjs
 *
 * Playwright-style page inspection CLI for Claude Code & Codex agents.
 * One headless-Chrome session, multiple inspection subcommands.
 *
 * Lives in dotfiles as ~/.claude/scripts/inspect.mjs.
 * Measurements have no npm dependencies. URL runs require Node 22+ and Chrome/Chromium.
 *
 * Subcommands
 *
 *   distance     gap between two elements (vertical, horizontal, centre-to-centre)
 *   typography   font-family/size/weight/line-height/letter-spacing/decoration etc.
 *   layout       parent's flex/grid setup + per-child placement and metrics
 *   box          margin/padding/border breakdown (devtools box-model view)
 *   styles       computed CSS for an element (whitelist or all)
 *   schema       rendered JSON-LD syntax, declared types and required-type presence
 *   batch        multiple checks against the same page in one browser session
 *   diff         pixel-level visual diff of two states (URL or PNG image A vs URL or PNG image B) per viewport
 *
 * Common flags (work for every subcommand)
 *
 *   --url <URL>                          single-target measurement
 *   --url-a / --url-live <URL>           target A (label: A)
 *   --url-b / --url-preview <URL>        target B (label: B) — diff emits a pixel
 *                                          report; other subcommands run against
 *                                          both URLs and emit deltas.
 *   --image-a <PATH_OR_URL>              target A for diff: local/remote PNG instead of URL capture
 *   --image-b <PATH_OR_URL>              target B for diff: local/remote PNG instead of URL capture
 *   --a <CSS> / --selector-a <CSS>
 *   --b <CSS> / --selector-b <CSS>       distance: second locator; diff: B-side locator
 *   --a-text <STR> / --b-text <STR>      locate by visible text instead of CSS
 *   --a-index N / --b-index N            pick the Nth visible match (default: 0)
 *   --scope <CSS>                        restrict locator search to inside this element
 *   --scope-b <CSS>                      B-side locator scope for diff when markup differs
 *   --viewports mobile,tablet,desktop    default: all three
 *   --viewport-size <WIDTHxHEIGHT>       override geometry for one selected viewport
 *   --init-script <JS>                   awaited after navigation, before measurement
 *   --wait-ms <N>                        extra wait after fonts/images (default 2500)
 *   --timeout-ms <N>                     navigation timeout (default 30000)
 *   --storefront-password <STR>          unlock a Shopify storefront password gate
 *   --format json|markdown|text          default: json
 *   --reduce-motion                      force reduced motion and suppress animations (opt-in)
 *   --hide-overlays                      hide broad cookie/consent/chat selectors (opt-in)
 *   --label <STR>                        free-form label echoed into the output
 *   --keep-browser                       leave headless Chrome running after exit
 *
 * Examples
 *
 *   # Typography of a hero heading at all viewports
 *   ~/.claude/scripts/inspect.mjs typography --url https://example.com \
 *     --a '.hero h1' --format markdown
 *
 *   # Distance between two elements, compared across two URLs
 *   ~/.claude/scripts/inspect.mjs distance \
 *     --url-a https://www.example.com/cart \
 *     --url-b https://www.example.com/cart?preview_theme_id=12345 \
 *     --a '.payment-icons' --b '.recommendations h3' --format markdown
 *
 *   # Flex/grid layout of a product grid
 *   ~/.claude/scripts/inspect.mjs layout --url https://example.com/collections/all \
 *     --a '.collection-grid' --format markdown
 *
 *   # Box model of a CTA button (margin/padding/border)
 *   ~/.claude/scripts/inspect.mjs box --url https://example.com \
 *     --a '.cta-primary' --format text
 *
 *   # Specific computed styles of an element
 *   ~/.claude/scripts/inspect.mjs styles --url https://example.com \
 *     --a 'header.site-header' \
 *     --properties position,height,background-color,box-shadow,z-index
 *
 *   # Pixel-diff one element across live vs preview (writes a/b/diff PNGs)
 *   ~/.claude/scripts/inspect.mjs diff \
 *     --url-a https://www.example.com --url-b https://www.example.com?preview_theme_id=123 \
 *     --a '.product-card' --max-diff-pct 0.5 --format markdown
 *
 *   # Pixel-diff different selectors across two websites
 *   ~/.claude/scripts/inspect.mjs diff \
 *     --url-a https://www.example.com --url-b https://dev.example.com \
 *     --a '.legacy-card' --b '.product-card' --max-diff-pct 1 --format markdown
 *
 *   # Pixel-diff a Figma reference PNG against a rendered theme element
 *   ~/.claude/scripts/inspect.mjs diff \
 *     --image-a ./figma/product-card.png --url-b https://www.example.com \
 *     --a '.product-card' --viewports desktop --max-diff-pct 1 --format markdown
 *
 * diff flags (in addition to the common flags)
 *
 *   --image-a <PATH_OR_URL> / --image-b <PATH_OR_URL>
 *                                        compare a PNG image side against a URL capture side
 *   --a <CSS> / --a-text <STR>           clip to one element (recommended); omit for the
 *                                          visible viewport, or use --full-page for the document
 *   --b <CSS> / --b-text <STR>           optional B-side locator for URL B when markup differs
 *   --full-page                          capture the whole document instead of the viewport
 *   --threshold <0..1>                   pixelmatch per-pixel sensitivity (default 0.1)
 *   --max-diff-pct <N>                   pass/fail gate: fail if mismatch% exceeds N
 *   --out <DIR>                          where to write <viewport>-{a,b,diff}.png
 *                                          (default: a fresh dir under the OS temp folder)
 *
 *   diff loads pixelmatch + pngjs from the project or the shared inspect tool directory.
 *   Run bash ~/.claude/scripts/setup-inspect-diff.sh once; QA never installs packages.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { inspectSchema } from './schema-probe.mjs';

const VIEWPORTS = {
  mobile: {
    width: 375, height: 844, mobile: true, deviceScaleFactor: 2, hasTouch: true,
    pointer: 'coarse', hover: 'none',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  },
  tablet: {
    width: 768, height: 1024, mobile: false, deviceScaleFactor: 2, hasTouch: true,
    pointer: 'coarse', hover: 'none',
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  },
  desktop: {
    width: 1280, height: 1000, mobile: false, deviceScaleFactor: 1, hasTouch: false,
    pointer: 'fine', hover: 'hover',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  },
};

const SUBCOMMANDS = new Set(['distance', 'typography', 'layout', 'box', 'styles', 'schema', 'batch', 'diff']);
const MEASUREMENT_SUBCOMMANDS = new Set(['distance', 'typography', 'layout', 'box', 'styles', 'schema']);

function parseArgs(argv) {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
    printHelp();
    process.exit(0);
  }
  const subcommand = argv[0];
  if (!SUBCOMMANDS.has(subcommand)) throw new Error(`Unknown subcommand: ${subcommand}. Try one of: ${[...SUBCOMMANDS].join(', ')}`);
  const rest = argv.slice(1);
  const a = {
    subcommand,
    urlA: '', urlB: '',
    imageA: '', imageB: '',
    selectorA: '', selectorB: '',
    textA: '', textB: '',
    indexA: 0, indexB: 0,
    scope: '',
    scopeB: '',
    viewports: ['mobile', 'tablet', 'desktop'],
    viewportSize: null,
    initScript: '',
    waitMs: 2500,
    timeoutMs: 30000,
    storefrontPassword: process.env.STOREFRONT_PASSWORD || '',
    format: 'json',
    label: '',
    properties: '',
    requiredTypes: [],
    reduceMotion: false,
    keepBrowser: false,
    stabilityPasses: 1,
    hideOverlays: false,
    svgCanvasBounds: false,
    batchFile: '',
    batchChecks: [],
    threshold: 0.1,
    maxDiffPct: null,
    outDir: '',
    fullPage: false,
  };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    const value = () => {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return v;
    };
    if (arg === '--url') a.urlA = value();
    else if (arg === '--url-a' || arg === '--url-live') a.urlA = value();
    else if (arg === '--url-b' || arg === '--url-preview') a.urlB = value();
    else if (arg === '--image-a') a.imageA = value();
    else if (arg === '--image-b') a.imageB = value();
    else if (arg === '--a' || arg === '--selector-a') a.selectorA = value();
    else if (arg === '--b' || arg === '--selector-b') a.selectorB = value();
    else if (arg === '--a-text') a.textA = value();
    else if (arg === '--b-text') a.textB = value();
    else if (arg === '--a-index') a.indexA = Number(value());
    else if (arg === '--b-index') a.indexB = Number(value());
    else if (arg === '--scope') a.scope = value();
    else if (arg === '--scope-b') a.scopeB = value();
    else if (arg === '--viewports') a.viewports = value().split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--viewport-size') {
      const size = /^([1-9]\d*)x([1-9]\d*)$/.exec(value());
      if (!size || size.slice(1).some(n => !Number.isSafeInteger(Number(n)) || Number(n) > 16384)) {
        throw new Error('--viewport-size requires WIDTHxHEIGHT, each between 1 and 16384');
      }
      a.viewportSize = { width: Number(size[1]), height: Number(size[2]) };
    }
    else if (arg === '--init-script') a.initScript = value();
    else if (arg === '--wait-ms') a.waitMs = Number(value());
    else if (arg === '--timeout-ms') a.timeoutMs = Number(value());
    else if (arg === '--storefront-password') a.storefrontPassword = value();
    else if (arg === '--format') a.format = value();
    else if (arg === '--label') a.label = value();
    else if (arg === '--properties') a.properties = value();
    else if (arg === '--required-types') a.requiredTypes = value().split(',').map(s => s.trim()).filter(Boolean);
    else if (arg === '--reduce-motion') a.reduceMotion = true;
    else if (arg === '--hide-overlays') a.hideOverlays = true;
    else if (arg === '--no-reduce-motion') a.reduceMotion = false;
    else if (arg === '--no-hide-overlays') a.hideOverlays = false;
    else if (arg === '--stability-passes') a.stabilityPasses = Math.max(1, Number(value()));
    else if (arg === '--svg-canvas-bounds') a.svgCanvasBounds = true;
    else if (arg === '--batch-file') a.batchFile = value();
    else if (arg === '--threshold') a.threshold = Number(value());
    else if (arg === '--max-diff-pct') a.maxDiffPct = Number(value());
    else if (arg === '--out') a.outDir = value();
    else if (arg === '--full-page') a.fullPage = true;
    else if (arg === '--keep-browser') a.keepBrowser = true;
    else if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0); }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (subcommand === 'batch') {
    if (!a.urlA) throw new Error('--url is required');
    if (!a.batchFile) throw new Error('batch requires --batch-file <PATH>');
    if (!existsSync(a.batchFile)) throw new Error(`Batch file not found: ${a.batchFile}`);
    const parsed = JSON.parse(readFileSync(a.batchFile, 'utf-8'));
    a.batchChecks = Array.isArray(parsed) ? parsed : parsed.checks;
    if (!Array.isArray(a.batchChecks) || a.batchChecks.length === 0) throw new Error('--batch-file must contain a non-empty checks array');
  } else if (subcommand === 'diff') {
    if (!a.urlA && !a.imageA) throw new Error('diff requires --url-a or --image-a');
    if (!a.urlB && !a.imageB) throw new Error('diff requires --url-b or --image-b');
    if (a.urlA && a.imageA) throw new Error('use only one of --url-a or --image-a');
    if (a.urlB && a.imageB) throw new Error('use only one of --url-b or --image-b');
    // selector optional: with --a/--a-text we clip to that element; otherwise the
    // visible viewport (or the full page with --full-page).
  } else {
    if (!a.urlA) throw new Error('--url (or --url-a) is required');
    if (subcommand !== 'schema' && !a.selectorA && !a.textA) throw new Error('--a or --a-text is required');
    if (subcommand === 'distance' && !a.selectorB && !a.textB) throw new Error('distance requires --b or --b-text');
  }
  if (subcommand === 'diff') {
    if (!Number.isFinite(a.threshold) || a.threshold < 0 || a.threshold > 1) throw new Error('--threshold must be between 0 and 1');
    if (a.maxDiffPct !== null && (!Number.isFinite(a.maxDiffPct) || a.maxDiffPct < 0)) throw new Error('--max-diff-pct must be a non-negative number');
  }
  if (!['vertical', 'horizontal', 'both'].includes(a.axis || 'both')) throw new Error('--axis must be vertical, horizontal, or both');
  for (const v of a.viewports) if (!VIEWPORTS[v]) throw new Error(`Unknown viewport "${v}"`);
  if (a.viewportSize && a.viewports.length !== 1) throw new Error('--viewport-size requires exactly one --viewports preset');
  if (!['json', 'markdown', 'text'].includes(a.format)) throw new Error('--format must be json|markdown|text');
  if (!Number.isSafeInteger(a.timeoutMs) || a.timeoutMs < 1 || a.timeoutMs > 2147482647) throw new Error('--timeout-ms must be a positive integer below 2147482648');
  if (!Number.isSafeInteger(a.waitMs) || a.waitMs < 0 || a.waitMs > 2147483647) throw new Error('--wait-ms must be a non-negative integer below 2147483648');
  return a;
}

function printHelp() {
  process.stdout.write(`inspect.mjs — Playwright-style page inspection CLI

Usage:
  inspect.mjs <subcommand> [common flags] [subcommand flags]

Subcommands:
  distance     gap between two elements (rects + parent context)
  typography   font/text computed styles for an element
  layout       parent's flex/grid setup + per-child placement
  box          margin/padding/border breakdown (box model)
  styles       arbitrary computed CSS for an element
  schema       rendered JSON-LD syntax and declared types (not rich-results eligibility)
  batch        run multiple checks against one URL/page load
  diff         pixel-level visual diff of two states (URL or PNG image A vs URL or PNG image B) per viewport

Common flags (all subcommands):
  --url <URL>                          target a single URL
  --url-a <URL> / --url-b <URL>        compare two URLs; diff emits pixel report, other subcommands emit deltas
  --image-a <PATH_OR_URL>              diff target A as a local/remote PNG instead of URL capture
  --image-b <PATH_OR_URL>              diff target B as a local/remote PNG instead of URL capture
  --a <CSS>      / --a-text <STR>      locate the primary element
  --b <CSS>      / --b-text <STR>      distance: secondary locator; diff: B-side locator
  --a-index N / --b-index N            pick the Nth visible match if the locator matches several
  --scope <CSS>                        restrict locator search to inside this container
  --scope-b <CSS>                      B-side locator scope for diff when markup differs
  --viewports mobile,tablet,desktop    default: all three
  --init-script <JS>                   awaited after navigation, before measurement
  --wait-ms <N>                        extra wait after fonts/images (default 2500)
  --timeout-ms <N>                     navigation timeout (default 30000)
  --storefront-password <STR>          unlock a Shopify password gate
  --format json|markdown|text          default: json
  --label <STR>                        free-form label echoed into the output
  --reduce-motion                      force reduced motion + animation suppression (default off)
  --hide-overlays                      hide broad cookie/consent/chat selectors (default off)
  --no-reduce-motion / --no-hide-overlays  disable the corresponding opt-in (legacy flags)
  --stability-passes N                 run subcommand N times (default 1); flags drift
  --svg-canvas-bounds                  measure <svg> as its canvas bounds (default: tight painted bounds)
  --batch-file <PATH>                  JSON checks array for the batch subcommand
  --keep-browser                       leave headless Chrome running on exit

Subcommand-specific flags:
  styles  --properties <p1,p2,...>     comma-separated CSS property names (default: a curated set)
  schema  --required-types <types>    optional comma-separated types required by the task
  diff    --image-a/--image-b <PNG>    compare a static PNG side against a URL capture side
          --a <CSS> / --a-text <STR>   clip URL side(s) to one element (recommended); omit for viewport
          --b <CSS> / --b-text <STR>   optional B-side locator for URL B when markup differs
          --full-page                  capture the whole document instead of the viewport
          --viewport-size <WxH>        override geometry; select one --viewports preset
          --threshold <0..1>           pixelmatch per-pixel sensitivity (default 0.1)
          --max-diff-pct <N>           pass/fail gate: fail if mismatch% exceeds N
          --out <DIR>                  where to write <viewport>-{a,b,diff}.png (default: OS temp)

Examples:
  inspect.mjs typography --url https://example.com --a '.hero h1' --format markdown
  inspect.mjs distance --url-a LIVE --url-b PREVIEW --a '.payment-icons' --b '.recs h3' --format markdown
  inspect.mjs layout --url https://example.com --a '.collection-grid' --format markdown
  inspect.mjs box --url https://example.com --a '.cta-primary' --format text
  inspect.mjs styles --url https://example.com --a 'header' --properties position,height,z-index
  inspect.mjs batch --url https://example.com --batch-file checks.json
  inspect.mjs diff --url-a LIVE --url-b PREVIEW --a '.product-card' --max-diff-pct 0.5 --format markdown
  inspect.mjs diff --url-a LIVE --url-b DEV --a '.legacy-card' --b '.product-card' --max-diff-pct 1 --format markdown
`);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function chromeBin() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error('No Chrome / Chromium found. Set CHROME_PATH.');
  return found;
}

async function waitForJson(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(1000, deadline - Date.now()))) });
      if (r.ok) return await r.json();
      last = `${r.status}`;
      await r.body?.cancel();
    }
    catch (e) { last = e.message; }
    await sleep(Math.max(0, Math.min(150, deadline - Date.now())));
  }
  throw new Error(`Timed out waiting for ${url}: ${last}`);
}

async function removeChromeProfile(userDataDir, warn = true) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await sleep(300 + attempt * 200);
    try {
      await fs.rm(userDataDir, { recursive: true, force: true });
      return;
    } catch (e) {
      if (warn && attempt === 4) {
        process.stderr.write(`Warning: could not remove ${userDataDir}: ${e.message}\n`);
      }
    }
  }
}

class Cdp {
  constructor(socket, timeoutMs = 30000) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.closedError = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data); }
      catch { this.fail(new Error('Invalid CDP message')); this.socket.close(); return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result || {});
      } else if (msg.method) {
        const key = `${msg.sessionId || ''}|${msg.method}`;
        const set = this.listeners.get(key);
        if (set) for (const fn of set) fn(msg.params || {});
      }
    });
    socket.addEventListener('close', () => this.fail(new Error('CDP socket closed')));
    socket.addEventListener('error', () => this.fail(new Error('CDP socket error')));
  }
  fail(error) {
    this.closedError = error;
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
    this.listeners.clear();
  }
  close() {
    this.fail(new Error('CDP connection closed'));
    this.socket.close();
  }
  static async connect(url, timeoutMs = 10000, Socket = globalThis.WebSocket) {
    requireWebSocket(Socket);
    const socket = new Socket(url);
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer);
        socket.removeEventListener('open', opened);
        socket.removeEventListener('error', failed);
        socket.removeEventListener('close', closed);
        if (error) { socket.close(); reject(error); }
        else resolve();
      };
      const opened = () => finish();
      const failed = () => finish(new Error('CDP WebSocket connection failed'));
      const closed = () => finish(new Error('CDP WebSocket closed before connecting'));
      const timer = setTimeout(() => finish(new Error(`CDP WebSocket connection timed out after ${timeoutMs}ms`)), timeoutMs);
      socket.addEventListener('open', opened);
      socket.addEventListener('error', failed);
      socket.addEventListener('close', closed);
    });
    return new Cdp(socket);
  }
  send(method, params = {}, sessionId, timeoutMs = this.timeoutMs) {
    if (this.closedError) return Promise.reject(this.closedError);
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify(message)); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  on(method, fn, sessionId) {
    const key = `${sessionId || ''}|${method}`;
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key).add(fn);
    return () => {
      const listeners = this.listeners.get(key);
      listeners?.delete(fn);
      if (!listeners?.size) this.listeners.delete(key);
    };
  }
}

function requireWebSocket(Socket = globalThis.WebSocket) {
  if (typeof Socket !== 'function') {
    throw new Error(`URL inspection requires built-in WebSocket support. Use Node 22+ (current: ${process.version}); local PNG diffs can run without Chrome or WebSocket.`);
  }
}

function waitForExit(proc, timeoutMs) {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve(true);
  return new Promise(resolve => {
    const done = (exited) => { clearTimeout(timer); proc.removeListener('exit', exitedFn); resolve(exited); };
    const exitedFn = () => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    proc.once('exit', exitedFn);
  });
}

async function shutdownChrome(cdp, proc, timeoutMs = 2000) {
  try { if (cdp) await cdp.send('Browser.close', {}, undefined, timeoutMs); }
  catch { /* Chrome may close its socket before acknowledging Browser.close. */ }
  finally { try { cdp?.close(); } catch { /* Continue owned-process cleanup if the socket already failed. */ } }
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill('SIGTERM');
  if (!await waitForExit(proc, timeoutMs)) {
    proc.kill('SIGKILL');
    if (!await waitForExit(proc, timeoutMs)) process.stderr.write('Warning: owned Chrome process did not exit after SIGKILL\n');
  }
}

async function launchChrome() {
  requireWebSocket();
  const binary = chromeBin();
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inspect-mjs-'));
  const proc = spawn(binary, [
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-default-apps', '--hide-scrollbars',
    '--disable-background-networking', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let spawnError;
  proc.on('error', error => { spawnError = error; });
  proc.stderr.on('data', () => {});
  let cdp;
  let closing;
  const onInterrupt = () => { close().finally(() => process.exit(130)); };
  const onTerminate = () => { close().finally(() => process.exit(143)); };
  const close = (keep = false) => {
    if (closing) return closing;
    closing = (async () => {
      try {
        if (keep) {
          cdp?.close();
          proc.unref();
          proc.stderr.unref();
          return;
        }
        if (!spawnError) await shutdownChrome(cdp, proc);
        await removeChromeProfile(userDataDir);
      } finally {
        process.removeListener('SIGINT', onInterrupt);
        process.removeListener('SIGTERM', onTerminate);
      }
    })();
    return closing;
  };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  try {
    // Read Chrome's own port file so an existing browser cannot be mistaken for ours.
    const deadline = Date.now() + 12000;
    let port;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (proc.exitCode !== null || proc.signalCode !== null) throw new Error('Chrome exited before CDP became ready');
      try {
        const candidate = Number((await fs.readFile(path.join(userDataDir, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
        if (Number.isInteger(candidate) && candidate > 0 && candidate < 65536) { port = candidate; break; }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await sleep(100);
    }
    if (!port) throw new Error('Timed out waiting for owned Chrome debugging port');
    const v = await waitForJson(`http://127.0.0.1:${port}/json/version`, Math.max(1, deadline - Date.now()));
    cdp = await Cdp.connect(v.webSocketDebuggerUrl);
    return { cdp, close };
  } catch (e) {
    await close();
    throw e;
  }
}

async function newPage(cdp, viewport, args) {
  const ctx = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
  const target = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId: ctx.browserContextId });
  const att = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const sessionId = att.sessionId;
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Network.enable', {}, sessionId);
  await cdp.send('Network.setUserAgentOverride', {
    userAgent: viewport.userAgent,
    platform: viewport.mobile ? 'iPhone' : 'MacIntel',
  }, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width, height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    mobile: viewport.mobile,
    screenWidth: viewport.width, screenHeight: viewport.height,
  }, sessionId);
  await cdp.send('Emulation.setTouchEmulationEnabled',
    viewport.hasTouch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false },
    sessionId);
  try {
    const orientation = viewport.height >= viewport.width ? 'portrait' : 'landscape';
    const features = [
      { name: 'prefers-color-scheme', value: 'light' },
      { name: 'hover', value: viewport.hover },
      { name: 'any-hover', value: viewport.hover },
      { name: 'pointer', value: viewport.pointer },
      { name: 'any-pointer', value: viewport.pointer },
      { name: 'orientation', value: orientation },
    ];
    if (args.reduceMotion) features.push({ name: 'prefers-reduced-motion', value: 'reduce' });
    await cdp.send('Emulation.setEmulatedMedia', { features }, sessionId);
  } catch { /* older Chromes may not support every feature */ }
  // Page-altering CSS is opt-in; preserve the page's Intl locale handling.
  if (args.hideOverlays || args.reduceMotion) {
    const overlayCss = args.hideOverlays ? `
      iframe[src*="preview_bar"],
      iframe[src*="preview-bar"],
      iframe[src*="shopifypreview"],
      iframe[id*="preview" i],
      [id*="preview-bar" i],
      [class*="preview-bar" i],
      [id*="cookie" i],
      [class*="cookie" i],
      [id*="consent" i],
      [class*="consent" i],
      [id*="onetrust" i],
      [class*="onetrust" i],
      [aria-label*="cookie" i],
      [data-testid*="cookie" i],
      .cc-window,
      .cc-banner,
      .ot-sdk-container,
      [class*="gorgias-chat" i],
      [id*="gorgias-chat" i],
      [class*="zendesk" i],
      [id*="zendesk" i] {
        display: none !important;
        opacity: 0 !important;
        pointer-events: none !important;
        visibility: hidden !important;
      }
    ` : '';
    const animationKillCss = args.reduceMotion ? `
      *, *::before, *::after {
        animation-delay: -0.0001s !important;
        animation-duration: 0.0001s !important;
        animation-iteration-count: 1 !important;
        transition-delay: 0s !important;
        transition-duration: 0s !important;
        scroll-behavior: auto !important;
      }
      html { scroll-behavior: auto !important; }
    ` : '';
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        (() => {
          try {
            const style = document.createElement('style');
            style.id = 'inspect-mjs-overrides';
            style.textContent = ${JSON.stringify(`
              ${animationKillCss}
              ${overlayCss}
            `)};
            const appendStyle = () => {
              if (document.head) document.head.appendChild(style);
              else if (document.documentElement) document.documentElement.appendChild(style);
            };
            appendStyle();
            if (!document.head) {
              const observer = new MutationObserver(() => {
                if (document.head) {
                  document.head.appendChild(style);
                  observer.disconnect();
                }
              });
              observer.observe(document, { childList: true, subtree: true });
            }
          } catch {}
        })();
      `,
    }, sessionId);
  }

  // Console-error capture. We attach buffers to the session so downstream
  // can read them in `extrasFor(sessionId)` after the page settles. Surfaces
  // JS errors that would otherwise be invisible to a CSS-only audit but
  // often correlate with the visual problem (e.g. "icon is wrong size"
  // because its script threw).
  if (!cdp.__sessionExtras) cdp.__sessionExtras = new Map();
  const extras = { consoleErrors: [], consoleWarnings: [], pageExceptions: [], networkFailures: [] };
  cdp.__sessionExtras.set(sessionId, extras);
  cdp.on('Runtime.consoleAPICalled', (event) => {
    if (!['error', 'warning'].includes(event.type)) return;
    const text = (event.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 600);
    (event.type === 'error' ? extras.consoleErrors : extras.consoleWarnings).push({ text, ts: Date.now() });
  }, sessionId);
  cdp.on('Runtime.exceptionThrown', (event) => {
    const ex = event.exceptionDetails || {};
    const text = (ex.text || '') + (ex.exception?.description ? ': ' + ex.exception.description : '');
    extras.pageExceptions.push({ text: text.slice(0, 600), ts: Date.now() });
  }, sessionId);
  cdp.on('Network.loadingFailed', (event) => {
    if (event.type === 'Image' || event.type === 'Script' || event.type === 'Stylesheet' || event.type === 'Font') {
      extras.networkFailures.push({ type: event.type, errorText: event.errorText, ts: Date.now() });
    }
  }, sessionId);

  return sessionId;
}

function extrasFor(cdp, sessionId) {
  if (!cdp.__sessionExtras) return null;
  return cdp.__sessionExtras.get(sessionId) || null;
}

async function evaluate(cdp, sessionId, expression, options = {}) {
  const r = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: options.awaitPromise !== false,
    returnByValue: true,
    timeout: options.timeoutMs || 30000,
  }, sessionId, (options.timeoutMs || 30000) + 1000);
  if (r.exceptionDetails) {
    throw new Error([r.exceptionDetails.text, r.exceptionDetails.exception?.description].filter(Boolean).join(': '));
  }
  return r.result?.value;
}

async function waitForLoad(cdp, sessionId, timeoutMs) {
  await evaluate(cdp, sessionId, `new Promise((resolve) => {
    const cap = ${Math.min(timeoutMs, 20000)};
    const finalise = async () => {
      try { await document.fonts?.ready; } catch {}
      try {
        for (const img of document.querySelectorAll('img')) {
          if (img.loading === 'lazy') img.loading = 'eager';
          if (img.decoding === 'async') img.decoding = 'sync';
        }
        const pending = [...document.querySelectorAll('img')].filter((i) => !i.complete && i.getAttribute('src'));
        await Promise.race([
          Promise.all(pending.map((img) => new Promise((r) => {
            img.addEventListener('load', () => r(), { once: true });
            img.addEventListener('error', () => r(), { once: true });
          }))),
          new Promise((r) => setTimeout(r, 4000)),
        ]);
      } catch {}
      resolve(true);
    };
    if (document.readyState === 'complete' || document.readyState === 'interactive') finalise();
    else {
      window.addEventListener('DOMContentLoaded', () => finalise(), { once: true });
      window.addEventListener('load', () => finalise(), { once: true });
    }
    setTimeout(() => resolve(false), cap);
  })`);
}

async function navigate(cdp, sessionId, url, timeoutMs) {
  let loadEventFired = false;
  cdp.on('Page.loadEventFired', () => { loadEventFired = true; }, sessionId);
  await cdp.send('Page.navigate', { url }, sessionId);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (loadEventFired) return;
    try {
      const state = await evaluate(cdp, sessionId, 'document.readyState', { timeoutMs: 1000 });
      if (state === 'complete' || state === 'interactive') return;
    } catch {}
    await sleep(100);
  }
}

async function unlockStorefrontIfNeeded(cdp, sessionId, password, timeoutMs) {
  if (!password) return false;
  const isLocked = await evaluate(cdp, sessionId, `(() => Boolean(document.querySelector('form[action="/password"], form[action*="/password"]')))()`);
  if (!isLocked) return false;
  const { frameTree } = await cdp.send('Page.getFrameTree', {}, sessionId);
  let navigated = false;
  const off = cdp.on('Page.frameNavigated', ({ frame }) => {
    if (frame.id === frameTree.frame.id && frame.loaderId !== frameTree.frame.loaderId) navigated = true;
  }, sessionId);
  try {
    // Return before submission destroys this document's execution context.
    await evaluate(cdp, sessionId, `(() => {
    const form = document.querySelector('form[action="/password"], form[action*="/password"]');
    if (!form) throw new Error('Storefront password form disappeared');
    const input = form.querySelector('input[name="password"], input[type="password"]');
    if (!input) throw new Error('Storefront password input missing');
    input.value = ${JSON.stringify(password)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    setTimeout(() => HTMLFormElement.prototype.submit.call(form), 0);
    return true;
  })()`);
    const deadline = Date.now() + timeoutMs;
    while (!navigated && Date.now() < deadline) {
      if (cdp.closedError) throw cdp.closedError;
      await sleep(50);
    }
    if (!navigated) throw new Error('Storefront password submission navigation timed out');
    await waitForLoad(cdp, sessionId, timeoutMs);
    const stillLocked = await evaluate(cdp, sessionId,
      `Boolean(document.querySelector('form[action="/password"], form[action*="/password"]'))`);
    if (stillLocked) throw new Error('Storefront password rejected; page is still locked');
  } finally { off(); }
  return true;
}

async function navigateAndPrepare(cdp, sessionId, url, args) {
  await navigate(cdp, sessionId, url, args.timeoutMs);
  await waitForLoad(cdp, sessionId, args.timeoutMs);
  if (args.storefrontPassword) {
    const unlocked = await unlockStorefrontIfNeeded(cdp, sessionId, args.storefrontPassword, args.timeoutMs);
    if (unlocked) {
      await navigate(cdp, sessionId, url, args.timeoutMs);
      await waitForLoad(cdp, sessionId, args.timeoutMs);
    }
  }
  if (args.initScript) {
    try {
      await evaluate(cdp, sessionId, `(async () => { ${args.initScript} })()`, { awaitPromise: true, timeoutMs: args.timeoutMs });
    } catch (e) {
      return { initError: e.message };
    }
  }
  // Trigger lazy hydration (IntersectionObserver hooks): scroll to bottom,
  // settle, then back to top so absolute coords are deterministic.
  await evaluate(cdp, sessionId, `(async () => {
    const settle = (ms) => new Promise((r) => setTimeout(r, ms));
    try { window.scrollTo(0, document.documentElement.scrollHeight); } catch {}
    await settle(700);
    try { window.scrollTo(0, document.documentElement.scrollHeight / 2); } catch {}
    await settle(400);
    try { window.scrollTo(0, 0); } catch {}
    document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
    await settle(300);
    return true;
  })()`);
  await sleep(args.waitMs);
  return {};
}

function buildLocatorExpression(args, side) {
  const selector = side === 'a' ? args.selectorA : args.selectorB;
  const textNeedle = side === 'a' ? args.textA : args.textB;
  const index = side === 'a' ? args.indexA : args.indexB;
  const scope = side === 'b' ? (args.scopeB || args.scope) : args.scope;
  const scopeExpr = scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document';
  if (selector) {
    return `(() => {
      const root = ${scopeExpr};
      if (!root) return null;
      const all = [...root.querySelectorAll(${JSON.stringify(selector)})];
      const visible = all.filter((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      });
      return visible[${index}] || all[${index}] || null;
    })()`;
  }
  return `(() => {
    const root = ${scopeExpr};
    if (!root) return null;
    const needle = ${JSON.stringify(textNeedle)}.toLowerCase();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    const matches = [];
    let node = walker.currentNode;
    while (node) {
      const direct = [...node.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent || '').join(' ');
      const txt = (direct || node.innerText || '').toLowerCase();
      if (txt.includes(needle)) {
        const r = node.getBoundingClientRect();
        const s = getComputedStyle(node);
        if (r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden') {
          matches.push({ node, area: r.width * r.height });
        }
      }
      node = walker.nextNode();
    }
    matches.sort((a, b) => a.area - b.area);
    return matches[${index}]?.node || null;
  })()`;
}

function describeViewport() {
  return `({
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    scrollWidth: Math.max(document.body?.scrollWidth || 0, document.documentElement.scrollWidth || 0),
    scrollHeight: Math.max(document.body?.scrollHeight || 0, document.documentElement.scrollHeight || 0),
    scrollbarWidth: Math.max(0, window.innerWidth - document.documentElement.clientWidth),
  })`;
}

function helpers() {
  // Shared helper functions injected into the page eval. Stringified.
  return `
    const round = (n) => Math.round(n * 10) / 10;
    const safeString = (v) => v === null || v === undefined ? '' : String(v);
    const safeClassName = (el) => {
      if (!el || !el.className) return '';
      return typeof el.className === 'string' ? el.className : String(el.className.baseVal || '');
    };
    const descriptor = (el) => {
      if (!el) return '';
      const tag = el.tagName ? el.tagName.toLowerCase() : '';
      const id = el.id ? '#' + el.id : '';
      const cls = safeClassName(el).trim().split(/\\s+/).filter(Boolean).slice(0, 4).map((c) => '.' + c).join('');
      return tag + id + cls;
    };
    const rectOf = (el) => {
      if (!el || !el.getBoundingClientRect) return null;
      const r = el.getBoundingClientRect();
      return {
        top: round(r.top + window.scrollY),
        right: round(r.right + window.scrollX),
        bottom: round(r.bottom + window.scrollY),
        left: round(r.left + window.scrollX),
        width: round(r.width),
        height: round(r.height),
      };
    };
    // When the located element is an <svg>, getBoundingClientRect() reports
    // the full canvas (width × height attributes). Visually the icon is the
    // painted content — paths, rects, circles, text — which is often much
    // smaller. Compute the union of all rendered SVG graphic descendants
    // and return that as the painted bounding box. Returns null when there
    // is no painted content or the element isn't an <svg>.
    const tightSvgRect = (el) => {
      if (!el || el.tagName?.toLowerCase() !== 'svg') return null;
      const graphics = el.querySelectorAll('path, rect, circle, ellipse, line, polygon, polyline, text, use, image, foreignObject, g');
      const rects = [...graphics]
        .filter((g) => {
          // Skip nodes hidden via display or visibility; SVG \`display: none\`
          // children still appear in querySelectorAll. Ignore zero-area too.
          const s = window.getComputedStyle(g);
          if (s.display === 'none' || s.visibility === 'hidden') return false;
          const r = g.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map((g) => g.getBoundingClientRect());
      if (!rects.length) return null;
      const left = Math.min(...rects.map((r) => r.left));
      const top = Math.min(...rects.map((r) => r.top));
      const right = Math.max(...rects.map((r) => r.right));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      return {
        top: round(top + window.scrollY),
        right: round(right + window.scrollX),
        bottom: round(bottom + window.scrollY),
        left: round(left + window.scrollX),
        width: round(right - left),
        height: round(bottom - top),
      };
    };
    const positionalWarnings = (el) => {
      const warns = [];
      if (!el) return warns;
      const s = getComputedStyle(el);
      if (s.position === 'sticky' || s.position === 'fixed') warns.push('element has position: ' + s.position + ' — its rect depends on scroll position');
      if (s.transform && s.transform !== 'none') warns.push('element has transform: ' + s.transform + ' — rect reflects the transformed box');
      if (s.contain && s.contain !== 'none' && s.contain !== '') warns.push('element has contain: ' + s.contain);
      const r = el.getBoundingClientRect();
      // Element occlusion: check the centre point of the element and see
      // whether the topmost element there is el (or a descendant of el).
      // If it's something else, that something else is visually covering it
      // — could be a fixed header, overlay, or unrelated container.
      try {
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (cx >= 0 && cy >= 0 && cx < window.innerWidth && cy < window.innerHeight) {
          const topMost = document.elementFromPoint(cx, cy);
          if (topMost && topMost !== el && !el.contains(topMost) && !topMost.contains(el)) {
            warns.push('element centre is occluded by ' + descriptor(topMost));
          }
        } else {
          warns.push('element centre is outside the current viewport — scroll-position dependent');
        }
      } catch {}
      return warns;
    };
    // Force a synchronous layout / style recalculation so rects we're about
    // to read are not stale after the page's last script tick. Cheapest way
    // is to read offsetHeight on the document element.
    void document.documentElement.offsetHeight;
    const parentContext = (el) => {
      if (!el || !el.parentElement) return null;
      const p = el.parentElement;
      const ps = getComputedStyle(p);
      return {
        descriptor: descriptor(p),
        styles: {
          display: ps.display, position: ps.position,
          gap: ps.gap, rowGap: ps.rowGap, columnGap: ps.columnGap,
          marginTop: ps.marginTop, marginBottom: ps.marginBottom, marginLeft: ps.marginLeft, marginRight: ps.marginRight,
          paddingTop: ps.paddingTop, paddingBottom: ps.paddingBottom, paddingLeft: ps.paddingLeft, paddingRight: ps.paddingRight,
          flexDirection: ps.flexDirection, flexWrap: ps.flexWrap, justifyContent: ps.justifyContent, alignItems: ps.alignItems, alignContent: ps.alignContent,
          gridTemplateColumns: ps.gridTemplateColumns, gridTemplateRows: ps.gridTemplateRows, gridAutoFlow: ps.gridAutoFlow,
        },
      };
    };
  `;
}

const TYPOGRAPHY_PROPERTIES = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch',
  'lineHeight', 'letterSpacing', 'wordSpacing',
  'textAlign', 'textTransform', 'textDecorationLine', 'textDecorationColor', 'textDecorationStyle',
  'textIndent', 'textOverflow', 'textShadow',
  'whiteSpace', 'overflowWrap', 'wordBreak',
  'color',
  'verticalAlign',
  'fontFeatureSettings', 'fontVariationSettings', 'fontKerning',
  'fontOpticalSizing',
];

const DEFAULT_STYLE_PROPERTIES = [
  // Layout
  'display', 'position', 'boxSizing', 'visibility', 'opacity', 'zIndex',
  // Box
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
  'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
  // Flex
  'flexDirection', 'flexWrap', 'flexBasis', 'flexGrow', 'flexShrink',
  'justifyContent', 'alignItems', 'alignContent', 'alignSelf',
  'gap', 'rowGap', 'columnGap',
  // Grid
  'gridTemplateColumns', 'gridTemplateRows', 'gridTemplateAreas', 'gridAutoFlow',
  'gridColumn', 'gridRow', 'gridArea',
  // Type
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
  'textAlign', 'textTransform', 'textDecorationLine', 'textDecorationColor', 'whiteSpace',
  'color', 'backgroundColor', 'background',
  // Misc
  'overflow', 'overflowX', 'overflowY', 'cursor', 'transform', 'transformOrigin', 'transition',
  'boxShadow', 'filter', 'backdropFilter',
];

const BOX_STYLE_PROPERTIES = [
  'boxSizing',
  'width', 'height',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
];

const LAYOUT_STYLE_PROPERTIES = [
  'display', 'position',
  'width', 'height',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignContent',
  'gap', 'rowGap', 'columnGap',
  'gridTemplateColumns', 'gridTemplateRows', 'gridTemplateAreas', 'gridAutoFlow',
  'gridAutoColumns', 'gridAutoRows',
];

function camelCase(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

async function runSubcommand(cdp, sessionId, args) {
  if (args.subcommand === 'schema') {
    return await evaluate(cdp, sessionId, `({ viewport: ${describeViewport()}, ...(${inspectSchema.toString()})(document, ${JSON.stringify(args.requiredTypes)}) })`);
  }
  const locatorA = buildLocatorExpression(args, 'a');
  const locatorB = args.subcommand === 'distance' ? buildLocatorExpression(args, 'b') : 'null';
  const propsList = args.properties
    ? args.properties.split(',').map((p) => camelCase(p.trim())).filter(Boolean)
    : DEFAULT_STYLE_PROPERTIES;
  const expression = `(() => {
    ${helpers()}
    const a = ${locatorA};
    const b = ${locatorB};
    const viewport = ${describeViewport()};
    const useCanvasBounds = ${JSON.stringify(Boolean(args.svgCanvasBounds))};
    const dumpRect = (el) => {
      if (!el) return null;
      const borderRect = rectOf(el);
      const isSvg = el.tagName?.toLowerCase() === 'svg';
      // If the located element is an <svg> and the user didn't opt out via
      // --svg-canvas-bounds, use the painted-content bounds. \`getBBox()\`-
      // style measurement matters here because icons routinely declare a
      // large canvas (e.g. 24×24) but paint a smaller glyph inside, and
      // distance/box measurements against the canvas would be misleading.
      let chosenRect = borderRect;
      let rectSource = 'border-box';
      let canvasRect = undefined;
      const warnings = positionalWarnings(el);
      if (isSvg) {
        const tight = tightSvgRect(el);
        if (tight) {
          const noticeably =
            (borderRect.width > 0 && tight.width < borderRect.width * 0.9) ||
            (borderRect.height > 0 && tight.height < borderRect.height * 0.9);
          if (!useCanvasBounds && noticeably) {
            chosenRect = tight;
            rectSource = 'svg-painted-content';
            canvasRect = borderRect;
            warnings.push('svg painted content (' + tight.width + '×' + tight.height + ') is smaller than its canvas (' + borderRect.width + '×' + borderRect.height + '); measuring against painted bounds. Use --svg-canvas-bounds to override.');
          } else if (useCanvasBounds && noticeably) {
            // User opted into canvas bounds — surface the tight rect for
            // reference so the report still tells the truth.
            canvasRect = borderRect;
            warnings.push('svg painted content was ' + tight.width + '×' + tight.height + '; canvas bounds (' + borderRect.width + '×' + borderRect.height + ') reported as requested by --svg-canvas-bounds.');
          }
        }
      }
      return {
        descriptor: descriptor(el),
        tag: el.tagName?.toLowerCase() || '',
        rect: chosenRect,
        rectSource,
        canvasRect,
        warnings,
        parent: parentContext(el),
      };
    };
    const pickStyles = (style, properties) => {
      const out = {};
      for (const p of properties) out[p] = safeString(style[p]);
      return out;
    };

    if (${JSON.stringify(args.subcommand)} === 'distance') {
      if (!a || !b) return { viewport, error: !a ? 'A not found' : 'B not found', a: dumpRect(a), b: dumpRect(b) };
      const A = dumpRect(a);
      const B = dumpRect(b);
      const sameAncestor = (() => {
        let node = a;
        while (node) {
          if (node.contains && node.contains(b)) return descriptor(node);
          node = node.parentElement;
        }
        return null;
      })();
      return {
        viewport, a: A, b: B, sameAncestor,
        distance: {
          vertical: round(B.rect.top - A.rect.bottom),
          horizontal: round(B.rect.left - A.rect.right),
          centreToCentreVertical: round(((B.rect.top + B.rect.bottom) / 2) - ((A.rect.top + A.rect.bottom) / 2)),
          centreToCentreHorizontal: round(((B.rect.left + B.rect.right) / 2) - ((A.rect.left + A.rect.right) / 2)),
        },
      };
    }

    if (${JSON.stringify(args.subcommand)} === 'typography') {
      if (!a) return { viewport, error: 'A not found' };
      const cs = getComputedStyle(a);
      const properties = ${JSON.stringify(TYPOGRAPHY_PROPERTIES)};
      const styles = {};
      for (const p of properties) styles[p] = safeString(cs[p]);
      const hasFontWeightDeclaration = (style) => {
        if (!style) return false;
        try {
          return style.getPropertyValue('font-weight') !== '';
        } catch {
          return false;
        }
      };
      const findRuleFontWeight = (el) => {
        let match = null;
        const visitRules = (rules, source) => {
          for (const rule of Array.from(rules || [])) {
            if (rule.cssRules) {
              try { visitRules(rule.cssRules, source); } catch {}
              continue;
            }
            if (!rule.selectorText || !hasFontWeightDeclaration(rule.style)) continue;
            try {
              if (el.matches(rule.selectorText)) {
                match = {
                  selector: rule.selectorText,
                  value: rule.style.getPropertyValue('font-weight').trim(),
                  source,
                };
              }
            } catch {}
          }
        };
        for (const sheet of Array.from(document.styleSheets)) {
          let rules;
          try {
            rules = sheet.cssRules;
          } catch {
            continue;
          }
          visitRules(rules, sheet.href || 'inline stylesheet');
        }
        return match;
      };
      const fontWeightSource = (() => {
        let node = a;
        let depth = 0;
        while (node && node.nodeType === Node.ELEMENT_NODE) {
          const inlineValue = node.style ? node.style.getPropertyValue('font-weight') : '';
          if (inlineValue) {
            return {
              value: inlineValue.trim(),
              inherited: node !== a,
              depth,
              descriptor: descriptor(node),
              origin: 'inline style',
            };
          }
          const rule = findRuleFontWeight(node);
          if (rule) {
            return {
              value: rule.value,
              inherited: node !== a,
              depth,
              descriptor: descriptor(node),
              origin: 'css rule',
              selector: rule.selector,
              source: rule.source,
            };
          }
          node = node.parentElement;
          depth += 1;
        }
        node = a;
        depth = 0;
        while (node && node.nodeType === Node.ELEMENT_NODE) {
          const nodeWeight = getComputedStyle(node).fontWeight;
          const parent = node.parentElement;
          const parentWeight = parent ? getComputedStyle(parent).fontWeight : '';
          if (nodeWeight && nodeWeight !== parentWeight) {
            return {
              value: nodeWeight,
              inherited: node !== a,
              depth,
              descriptor: descriptor(node),
              origin: 'computed inheritance boundary',
            };
          }
          node = parent;
          depth += 1;
        }
        return {
          value: styles.fontWeight,
          inherited: true,
          depth: null,
          descriptor: null,
          origin: 'computed default or unresolved stylesheet',
        };
      })();
      // Resolved font family — Chromium does NOT expose the *actually used*
      // font directly, but document.fonts.check() can answer "would this
      // font face be available at this size?" for the first family in the
      // stack. We surface the first family + whether it's loaded.
      const firstFamily = (cs.fontFamily || '').split(',')[0].replace(/['\"]/g, '').trim();
      let firstFamilyLoaded = null;
      try { firstFamilyLoaded = document.fonts ? document.fonts.check(\`\${cs.fontSize} "\${firstFamily}"\`) : null; } catch {}
      return {
        viewport,
        a: dumpRect(a),
        styles,
        fontWeightSource,
        firstFontFamily: firstFamily,
        firstFontFamilyLoaded: firstFamilyLoaded,
        text: (a.innerText || a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 240),
      };
    }

    if (${JSON.stringify(args.subcommand)} === 'box') {
      if (!a) return { viewport, error: 'A not found' };
      const cs = getComputedStyle(a);
      const r = a.getBoundingClientRect();
      const px = (v) => parseFloat(v) || 0;
      const m = { top: px(cs.marginTop), right: px(cs.marginRight), bottom: px(cs.marginBottom), left: px(cs.marginLeft) };
      const p = { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
      const bw = { top: px(cs.borderTopWidth), right: px(cs.borderRightWidth), bottom: px(cs.borderBottomWidth), left: px(cs.borderLeftWidth) };
      return {
        viewport,
        a: dumpRect(a),
        styles: pickStyles(cs, ${JSON.stringify(BOX_STYLE_PROPERTIES)}),
        boxSizing: cs.boxSizing,
        margin: m,
        padding: p,
        border: {
          width: bw,
          style: { top: cs.borderTopStyle, right: cs.borderRightStyle, bottom: cs.borderBottomStyle, left: cs.borderLeftStyle },
          color: { top: cs.borderTopColor, right: cs.borderRightColor, bottom: cs.borderBottomColor, left: cs.borderLeftColor },
          radius: { topLeft: cs.borderTopLeftRadius, topRight: cs.borderTopRightRadius, bottomRight: cs.borderBottomRightRadius, bottomLeft: cs.borderBottomLeftRadius },
        },
        boxes: {
          // From outside in.
          margin: { width: round(r.width + m.left + m.right), height: round(r.height + m.top + m.bottom) },
          border: { width: round(r.width), height: round(r.height) },
          padding: { width: round(r.width - bw.left - bw.right), height: round(r.height - bw.top - bw.bottom) },
          content: { width: round(r.width - bw.left - bw.right - p.left - p.right), height: round(r.height - bw.top - bw.bottom - p.top - p.bottom) },
        },
      };
    }

    if (${JSON.stringify(args.subcommand)} === 'layout') {
      if (!a) return { viewport, error: 'A not found' };
      const cs = getComputedStyle(a);
      const isFlex = cs.display.includes('flex');
      const isGrid = cs.display.includes('grid');
      const children = [...a.children].map((child, i) => {
        const ccs = getComputedStyle(child);
        const cr = child.getBoundingClientRect();
        return {
          index: i,
          descriptor: descriptor(child),
          rect: rectOf(child),
          order: ccs.order,
          flexBasis: ccs.flexBasis, flexGrow: ccs.flexGrow, flexShrink: ccs.flexShrink, alignSelf: ccs.alignSelf,
          gridColumn: ccs.gridColumn, gridRow: ccs.gridRow, gridArea: ccs.gridArea,
          marginTop: ccs.marginTop, marginRight: ccs.marginRight, marginBottom: ccs.marginBottom, marginLeft: ccs.marginLeft,
        };
      });
      // Inter-child spacing in visual rows/columns. A single linear sort gives
      // false negative gaps for grids and wrapped flex rows because adjacent
      // DOM children can live on different axes.
      const interChildGaps = [];
      const groupBy = (items, prop) => {
        const groups = [];
        for (const item of [...items].sort((a, b) => a.rect[prop] - b.rect[prop])) {
          const group = groups.find((g) => Math.abs(g.key - item.rect[prop]) <= 2);
          if (group) group.items.push(item);
          else groups.push({ key: item.rect[prop], items: [item] });
        }
        return groups;
      };
      for (const row of groupBy(children, 'top')) {
        const rowItems = row.items.sort((a, b) => a.rect.left - b.rect.left);
        for (let i = 1; i < rowItems.length; i++) {
          const prev = rowItems[i - 1];
          const curr = rowItems[i];
          interChildGaps.push({ axis: 'horizontal', from: prev.descriptor, to: curr.descriptor, gap: round(curr.rect.left - prev.rect.right) });
        }
      }
      for (const col of groupBy(children, 'left')) {
        const colItems = col.items.sort((a, b) => a.rect.top - b.rect.top);
        for (let i = 1; i < colItems.length; i++) {
          const prev = colItems[i - 1];
          const curr = colItems[i];
          interChildGaps.push({ axis: 'vertical', from: prev.descriptor, to: curr.descriptor, gap: round(curr.rect.top - prev.rect.bottom) });
        }
      }
      return {
        viewport,
        a: dumpRect(a),
        styles: pickStyles(cs, ${JSON.stringify(LAYOUT_STYLE_PROPERTIES)}),
        layout: {
          display: cs.display,
          isFlex, isGrid,
          flex: isFlex ? {
            direction: cs.flexDirection, wrap: cs.flexWrap,
            justifyContent: cs.justifyContent, alignItems: cs.alignItems, alignContent: cs.alignContent,
            gap: cs.gap, rowGap: cs.rowGap, columnGap: cs.columnGap,
          } : null,
          grid: isGrid ? {
            templateColumns: cs.gridTemplateColumns, templateRows: cs.gridTemplateRows,
            templateAreas: cs.gridTemplateAreas, autoFlow: cs.gridAutoFlow,
            autoColumns: cs.gridAutoColumns, autoRows: cs.gridAutoRows,
            gap: cs.gap, rowGap: cs.rowGap, columnGap: cs.columnGap,
          } : null,
          padding: { top: cs.paddingTop, right: cs.paddingRight, bottom: cs.paddingBottom, left: cs.paddingLeft },
        },
        children,
        interChildGaps,
      };
    }

    if (${JSON.stringify(args.subcommand)} === 'styles') {
      if (!a) return { viewport, error: 'A not found' };
      const cs = getComputedStyle(a);
      const properties = ${JSON.stringify(propsList)};
      const styles = {};
      for (const p of properties) styles[p] = safeString(cs[p]);
      return { viewport, a: dumpRect(a), styles };
    }

    return { viewport, error: 'Unknown subcommand' };
  })()`;
  return await evaluate(cdp, sessionId, expression);
}

function locatorString(selector, text) {
  return selector ? `selector: ${selector}` : (text ? `text: ${text}` : '');
}

function failedResult(result) {
  return Boolean(result.error || result.initError || result.initErrorA || result.initErrorB
    || result.valid === false || result.pass === false || result.checks?.some(failedResult));
}

function inspectionState(args) {
  const hasPage = Boolean(args.urlA || args.urlB);
  return {
    browserEngine: hasPage ? 'Chromium' : null,
    pagePreparation: hasPage ? {
      reduceMotion: args.reduceMotion,
      hideOverlays: args.hideOverlays,
      initScript: Boolean(args.initScript || args.batchChecks?.some(check => check.initScript)),
      eagerImages: true,
      scrollForLazyHydration: true,
      localeOverride: false,
    } : null,
  };
}

function normaliseBatchCheck(args, check, index) {
  const subcommand = check.subcommand || 'styles';
  if (!MEASUREMENT_SUBCOMMANDS.has(subcommand)) throw new Error(`Unknown batch check subcommand: ${subcommand}`);
  const out = {
    ...args,
    subcommand,
    selectorA: check.selectorA || check.selector || check.a || '',
    selectorB: check.selectorB || check.b || '',
    textA: check.textA || check.aText || '',
    textB: check.textB || check.bText || '',
    indexA: Number(check.indexA ?? check.aIndex ?? 0),
    indexB: Number(check.indexB ?? check.bIndex ?? 0),
    scope: check.scope || '',
    properties: Array.isArray(check.properties) ? check.properties.join(',') : (check.properties || ''),
    requiredTypes: check.requiredTypes || args.requiredTypes,
    initScript: check.initScript || '',
    stabilityPasses: Math.max(1, Number(check.stabilityPasses || args.stabilityPasses || 1)),
    svgCanvasBounds: Boolean(check.svgCanvasBounds ?? args.svgCanvasBounds),
  };
  if (!Array.isArray(out.requiredTypes) || out.requiredTypes.some(type => typeof type !== 'string' || !type.trim())) throw new Error('requiredTypes must be an array of non-empty strings');
  if (subcommand !== 'schema' && !out.selectorA && !out.textA) throw new Error('batch check requires selector/a or aText/textA');
  if (subcommand === 'distance' && !out.selectorB && !out.textB) throw new Error('distance check requires selectorB/b or bText/textB');
  return {
    id: check.id || `check-${index + 1}`,
    label: check.label || '',
    locators: {
      a: locatorString(out.selectorA, out.textA),
      b: locatorString(out.selectorB, out.textB),
    },
    args: out,
  };
}

async function runMeasurementPasses(cdp, sessionId, args) {
  const passes = [];
  let initError = '';
  if (args.initScript) {
    try {
      await evaluate(cdp, sessionId, `(async () => { ${args.initScript} })()`, { awaitPromise: true, timeoutMs: args.timeoutMs });
    } catch (e) {
      initError = e.message;
    }
  }
  for (let i = 0; i < args.stabilityPasses; i += 1) {
    if (i > 0) {
      await evaluate(cdp, sessionId, '(async () => { await new Promise((r) => setTimeout(r, 600)); return true; })()');
    }
    passes.push(await runSubcommand(cdp, sessionId, args));
  }
  const base = passes[0] || {};
  const variance = args.stabilityPasses > 1 ? computeVariance(passes) : null;
  return {
    ...base,
    ...(passes.find(failedResult) || {}),
    ...(initError ? { initError } : {}),
    ...(variance ? { stability: variance } : {}),
  };
}

async function runBatchSubcommands(cdp, sessionId, args) {
  const out = [];
  for (let i = 0; i < args.batchChecks.length; i += 1) {
    const raw = args.batchChecks[i];
    try {
      const check = normaliseBatchCheck(args, raw, i);
      const measured = await runMeasurementPasses(cdp, sessionId, check.args);
      out.push({
        id: check.id,
        label: check.label,
        subcommand: check.args.subcommand,
        locators: check.locators,
        ...measured,
      });
    } catch (e) {
      out.push({
        id: raw?.id || `check-${i + 1}`,
        label: raw?.label || '',
        subcommand: raw?.subcommand || 'styles',
        error: e.message,
      });
    }
  }
  return out;
}

async function runForUrl(cdp, args, url, viewports) {
  const out = {};
  for (const name of viewports) {
    const viewport = { ...VIEWPORTS[name], ...args.viewportSize };
    const sessionId = await newPage(cdp, viewport, args);
    try {
      const prep = await navigateAndPrepare(cdp, sessionId, url, args);
      if (args.subcommand === 'batch') {
        const checks = await runBatchSubcommands(cdp, sessionId, args);
        const rootCustomProperties = await readRootCustomProperties(cdp, sessionId);
        const extras = extrasFor(cdp, sessionId) || {};
        out[name] = {
          viewport: await evaluate(cdp, sessionId, describeViewport()),
          resolvedUrl: await evaluate(cdp, sessionId, 'location.href'),
          checks,
          rootCustomProperties,
          consoleErrors: extras.consoleErrors || [],
          consoleWarnings: extras.consoleWarnings || [],
          pageExceptions: extras.pageExceptions || [],
          networkFailures: extras.networkFailures || [],
          ...(prep.initError ? { initError: prep.initError } : {}),
        };
        continue;
      }
      const passes = [];
      for (let i = 0; i < args.stabilityPasses; i += 1) {
        if (i > 0) {
          // Quick settle between passes so animation-driven elements have a
          // chance to differ visibly if they're going to differ at all.
          await evaluate(cdp, sessionId, '(async () => { await new Promise((r) => setTimeout(r, 600)); return true; })()');
        }
        passes.push(await runSubcommand(cdp, sessionId, args));
      }
      const base = passes[0];
      const variance = (args.stabilityPasses > 1) ? computeVariance(passes) : null;
      // Page-level extras: root CSS custom properties (foundations conformance
      // at the variable layer) + any console errors / network failures.
      const rootCustomProperties = await readRootCustomProperties(cdp, sessionId);
      const extras = extrasFor(cdp, sessionId) || {};
      out[name] = {
        ...base,
        ...(passes.find(failedResult) || {}),
        resolvedUrl: await evaluate(cdp, sessionId, 'location.href'),
        rootCustomProperties,
        consoleErrors: extras.consoleErrors || [],
        consoleWarnings: extras.consoleWarnings || [],
        pageExceptions: extras.pageExceptions || [],
        networkFailures: extras.networkFailures || [],
        ...(prep.initError ? { initError: prep.initError } : {}),
        ...(variance ? { stability: variance } : {}),
      };
    } catch (e) {
      out[name] = { error: e.message };
    }
  }
  return out;
}

async function readRootCustomProperties(cdp, sessionId) {
  try {
    const out = await evaluate(cdp, sessionId, `(() => {
      const result = {};
      try {
        const root = getComputedStyle(document.documentElement);
        for (let i = 0; i < root.length; i += 1) {
          const name = root[i];
          if (!name || name.indexOf('--') !== 0) continue;
          const value = root.getPropertyValue(name);
          result[name] = (value || '').trim();
        }
      } catch {}
      return result;
    })()`);
    return out || {};
  } catch { return {}; }
}

// Cross-pass variance summary. For distance, surfaces the spread in the
// vertical/horizontal gap; for other subcommands, surfaces any rect or
// style values that differed between passes — those probes are flaky and
// the single-pass reading should be treated as low-confidence.
function computeVariance(passes) {
  const summary = { passes: passes.length, flapping: [] };
  if (passes.length < 2) return summary;
  const first = passes[0];
  const last = passes[passes.length - 1];
  if (first?.distance && last?.distance) {
    summary.distance = {
      verticalRange: passes.map((p) => p.distance?.vertical).filter((v) => typeof v === 'number'),
      horizontalRange: passes.map((p) => p.distance?.horizontal).filter((v) => typeof v === 'number'),
    };
    const vMax = Math.max(...summary.distance.verticalRange);
    const vMin = Math.min(...summary.distance.verticalRange);
    const hMax = Math.max(...summary.distance.horizontalRange);
    const hMin = Math.min(...summary.distance.horizontalRange);
    summary.distance.verticalSpread = Math.round((vMax - vMin) * 10) / 10;
    summary.distance.horizontalSpread = Math.round((hMax - hMin) * 10) / 10;
    if (summary.distance.verticalSpread > 1 || summary.distance.horizontalSpread > 1) {
      summary.flapping.push(`distance varied across passes (vSpread=${summary.distance.verticalSpread}px, hSpread=${summary.distance.horizontalSpread}px)`);
    }
  }
  // Style flap detection (typography / styles subcommands).
  if (first?.styles && last?.styles) {
    const drifted = Object.keys(first.styles).filter((k) => first.styles[k] !== last.styles[k]);
    if (drifted.length) summary.flapping.push(`styles drifted across passes: ${drifted.join(', ')}`);
  }
  // Rect flap detection.
  if (first?.a?.rect && last?.a?.rect) {
    const fr = first.a.rect, lr = last.a.rect;
    if (Math.abs(fr.top - lr.top) > 0.5 || Math.abs(fr.left - lr.left) > 0.5 ||
        Math.abs(fr.width - lr.width) > 0.5 || Math.abs(fr.height - lr.height) > 0.5) {
      summary.flapping.push(`A rect drifted across passes: ${JSON.stringify(fr)} → ${JSON.stringify(lr)}`);
    }
  }
  return summary;
}

// ---------- Formatters ----------

function fmtViewportLine(v) {
  return `${v.width}×${v.height}  dpr=${v.devicePixelRatio}  scrollbar=${v.scrollbarWidth}px`;
}

function formatDistance(report) {
  const lines = [];
  lines.push(`# inspect.mjs · distance`);
  if (report.label) lines.push(`Label: ${report.label}`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`A locator: ${report.locators.a}`);
  lines.push(`B locator: ${report.locators.b}`);
  lines.push('');
  for (const target of report.targets) {
    lines.push(`## ${target.label}: ${target.url}`);
    lines.push('');
    lines.push('| Viewport | A rect | B rect | Vertical | Horizontal | Note |');
    lines.push('| --- | --- | --- | ---: | ---: | --- |');
    for (const [name, m] of Object.entries(target.viewports)) {
      if (m.error) { lines.push(`| ${name} | — | — | — | — | ${m.error} |`); continue; }
      const rectLabel = (side) => {
        const src = side.rectSource && side.rectSource !== 'border-box' ? `(${side.rectSource}) ` : '';
        return `${src}${side.rect.left},${side.rect.top} ${side.rect.width}×${side.rect.height}`;
      };
      const ar = rectLabel(m.a);
      const br = rectLabel(m.b);
      const flap = m.stability?.flapping?.length ? `FLAP: ${m.stability.flapping.join('; ')}` : '';
      const note = [m.sameAncestor ? `shared ${m.sameAncestor}` : '', ...(m.a?.warnings || []), ...(m.b?.warnings || []), flap].filter(Boolean).join('; ');
      lines.push(`| ${name} | ${ar} | ${br} | ${m.distance.vertical}px | ${m.distance.horizontal}px | ${note} |`);
    }
    lines.push('');
  }
  if (report.targets.length === 2) {
    const [A, B] = report.targets;
    lines.push(`## Delta (${B.label} − ${A.label})`);
    lines.push('| Viewport | Δ Vertical | Δ Horizontal |');
    lines.push('| --- | ---: | ---: |');
    for (const name of Object.keys(A.viewports)) {
      const a = A.viewports[name], b = B.viewports[name];
      if (!a?.distance || !b?.distance) { lines.push(`| ${name} | — | — |`); continue; }
      const dv = Math.round((b.distance.vertical - a.distance.vertical) * 10) / 10;
      const dh = Math.round((b.distance.horizontal - a.distance.horizontal) * 10) / 10;
      lines.push(`| ${name} | ${dv}px | ${dh}px |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function formatTypography(report) {
  const lines = [];
  lines.push(`# inspect.mjs · typography`);
  if (report.label) lines.push(`Label: ${report.label}`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Locator: ${report.locators.a}`);
  lines.push('');
  for (const target of report.targets) {
    lines.push(`## ${target.label}: ${target.url}`);
    lines.push('');
    for (const [name, m] of Object.entries(target.viewports)) {
      lines.push(`### ${name} (${fmtViewportLine(m.viewport || {})})`);
      if (m.error) { lines.push(`  error: ${m.error}`); lines.push(''); continue; }
      lines.push(`  element:    ${m.a.descriptor}`);
      lines.push(`  rect:       ${m.a.rect.left},${m.a.rect.top} ${m.a.rect.width}×${m.a.rect.height}`);
      lines.push(`  text:       ${JSON.stringify(m.text || '')}`);
      lines.push(`  first-font: ${m.firstFontFamily} (loaded=${m.firstFontFamilyLoaded})`);
      lines.push(`  styles:`);
      for (const [k, v] of Object.entries(m.styles)) lines.push(`    ${k.padEnd(22)} ${v}`);
      if (m.fontWeightSource) {
        const source = m.fontWeightSource;
        const inheritance = source.inherited ? 'inherited' : 'direct';
        const selector = source.selector ? ` selector=${JSON.stringify(source.selector)}` : '';
        const descriptor = source.descriptor ? ` from ${source.descriptor}` : '';
        lines.push(`  font-weight-source: ${inheritance}${descriptor} via ${source.origin} value=${source.value}${selector}`);
      }
      if (m.a.warnings?.length) lines.push(`  warnings:   ${m.a.warnings.join('; ')}`);
      lines.push('');
    }
  }
  if (report.targets.length === 2) {
    const [A, B] = report.targets;
    lines.push(`## Delta (${B.label} − ${A.label})`);
    lines.push('| Viewport | Property | A | B |');
    lines.push('| --- | --- | --- | --- |');
    for (const name of Object.keys(A.viewports)) {
      const a = A.viewports[name], b = B.viewports[name];
      if (!a?.styles || !b?.styles) continue;
      for (const k of Object.keys(a.styles)) {
        if (a.styles[k] !== b.styles[k]) lines.push(`| ${name} | ${k} | ${a.styles[k]} | ${b.styles[k]} |`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

function formatBox(report) {
  const lines = [];
  lines.push(`# inspect.mjs · box`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Locator: ${report.locators.a}`);
  for (const target of report.targets) {
    lines.push('');
    lines.push(`## ${target.label}: ${target.url}`);
    for (const [name, m] of Object.entries(target.viewports)) {
      lines.push('');
      lines.push(`### ${name}`);
      if (m.error) { lines.push(`  error: ${m.error}`); continue; }
      lines.push(`  element:    ${m.a.descriptor}`);
      lines.push(`  boxSizing:  ${m.boxSizing}`);
      lines.push(`  margin:     T${m.margin.top} R${m.margin.right} B${m.margin.bottom} L${m.margin.left}`);
      lines.push(`  border:     T${m.border.width.top}/${m.border.style.top}/${m.border.color.top}  R${m.border.width.right}/${m.border.style.right}/${m.border.color.right}  B${m.border.width.bottom}/${m.border.style.bottom}/${m.border.color.bottom}  L${m.border.width.left}/${m.border.style.left}/${m.border.color.left}`);
      lines.push(`  radius:     TL${m.border.radius.topLeft} TR${m.border.radius.topRight} BR${m.border.radius.bottomRight} BL${m.border.radius.bottomLeft}`);
      lines.push(`  padding:    T${m.padding.top} R${m.padding.right} B${m.padding.bottom} L${m.padding.left}`);
      lines.push(`  boxes:      margin=${m.boxes.margin.width}×${m.boxes.margin.height}  border=${m.boxes.border.width}×${m.boxes.border.height}  padding=${m.boxes.padding.width}×${m.boxes.padding.height}  content=${m.boxes.content.width}×${m.boxes.content.height}`);
    }
  }
  return lines.join('\n');
}

function formatLayout(report) {
  const lines = [];
  lines.push(`# inspect.mjs · layout`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Locator: ${report.locators.a}`);
  for (const target of report.targets) {
    lines.push('');
    lines.push(`## ${target.label}: ${target.url}`);
    for (const [name, m] of Object.entries(target.viewports)) {
      lines.push('');
      lines.push(`### ${name}`);
      if (m.error) { lines.push(`  error: ${m.error}`); continue; }
      lines.push(`  container:   ${m.a.descriptor}    ${m.a.rect.width}×${m.a.rect.height}`);
      lines.push(`  display:     ${m.layout.display}`);
      if (m.layout.flex) {
        lines.push(`  flex:        direction=${m.layout.flex.direction}  wrap=${m.layout.flex.wrap}  justify=${m.layout.flex.justifyContent}  align=${m.layout.flex.alignItems}  alignContent=${m.layout.flex.alignContent}  gap=${m.layout.flex.gap}`);
      }
      if (m.layout.grid) {
        lines.push(`  grid:        columns=${m.layout.grid.templateColumns}  rows=${m.layout.grid.templateRows}  autoFlow=${m.layout.grid.autoFlow}  gap=${m.layout.grid.gap}`);
      }
      lines.push(`  padding:     T${m.layout.padding.top} R${m.layout.padding.right} B${m.layout.padding.bottom} L${m.layout.padding.left}`);
      lines.push(`  children (${m.children.length}):`);
      m.children.forEach((c) => {
        const flex = m.layout.flex ? ` flex=${c.flexGrow}/${c.flexShrink}/${c.flexBasis}` : '';
        const grid = m.layout.grid ? ` row=${c.gridRow} col=${c.gridColumn}` : '';
        lines.push(`    [${c.index}] ${c.descriptor.padEnd(40)} ${c.rect.left},${c.rect.top} ${c.rect.width}×${c.rect.height}${flex}${grid}`);
      });
      if (m.interChildGaps.length) {
        lines.push(`  measured gaps:`);
        m.interChildGaps.forEach((g) => lines.push(`    ${g.axis}: ${g.from} → ${g.to} = ${g.gap}px`));
      }
    }
  }
  return lines.join('\n');
}

function formatStyles(report) {
  const lines = [];
  lines.push(`# inspect.mjs · styles`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Locator: ${report.locators.a}`);
  for (const target of report.targets) {
    lines.push('');
    lines.push(`## ${target.label}: ${target.url}`);
    for (const [name, m] of Object.entries(target.viewports)) {
      lines.push('');
      lines.push(`### ${name}`);
      if (m.error) { lines.push(`  error: ${m.error}`); continue; }
      lines.push(`  element: ${m.a.descriptor}`);
      for (const [k, v] of Object.entries(m.styles)) lines.push(`    ${k.padEnd(28)} ${v}`);
    }
  }
  if (report.targets.length === 2) {
    const [A, B] = report.targets;
    lines.push('');
    lines.push(`## Delta (${B.label} − ${A.label})`);
    lines.push('| Viewport | Property | A | B |');
    lines.push('| --- | --- | --- | --- |');
    for (const name of Object.keys(A.viewports)) {
      const a = A.viewports[name], b = B.viewports[name];
      if (!a?.styles || !b?.styles) continue;
      for (const k of Object.keys(a.styles)) {
        if (a.styles[k] !== b.styles[k]) lines.push(`| ${name} | ${k} | ${a.styles[k]} | ${b.styles[k]} |`);
      }
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// diff subcommand: pixel-level visual comparison of two states (URL A vs URL B)
// at the same viewport. Reuses the full navigate/settle/password/init pipeline,
// captures via CDP Page.captureScreenshot (element clip, viewport, or full page),
// and diffs with pixelmatch (+ pngjs for PNG decode/encode), both lazily loaded.
// ---------------------------------------------------------------------------

// Load only for diff; keep project packages first and measurements dependency-free.
async function loadImageDiffDeps() {
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  let pixelmatch = null;
  let PNG = null;
  const shared = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'inspect');
  for (const root of [process.cwd(), shared]) {
    try {
      const req = createRequire(path.join(root, 'noop.js'));
      const pm = await import(pathToFileURL(req.resolve('pixelmatch')).href);
      const png = await import(pathToFileURL(req.resolve('pngjs')).href);
      const candidatePixelmatch = pm.default || pm;
      const candidatePNG = png.PNG || png.default?.PNG || png.default;
      if (typeof candidatePixelmatch === 'function' && candidatePNG?.sync) {
        return { pixelmatch: candidatePixelmatch, PNG: candidatePNG };
      }
    } catch { /* try the next dependency location */ }
  }
  if (typeof pixelmatch !== 'function') {
    try { const m = await import('pixelmatch'); pixelmatch = m.default || m; } catch { /* noop */ }
  }
  if (!PNG || !PNG.sync) {
    try { const m = await import('pngjs'); PNG = m.PNG || m.default?.PNG || m.default; } catch { /* noop */ }
  }
  if (typeof pixelmatch !== 'function' || !PNG || !PNG.sync) {
    throw new Error(
      'diff needs pixelmatch + pngjs. Run bash ~/.claude/scripts/setup-inspect-diff.sh '
      + `to install shared dependencies in ${shared}; project packages remain supported.`,
    );
  }
  return { pixelmatch, PNG };
}

// Crop a decoded PNG's RGBA buffer to the top-left w×h region (no-op when it
// already matches). Used to reconcile A/B captures that differ by a pixel or
// two so pixelmatch's equal-dimensions constraint holds.
function cropRGBA(png, w, h) {
  if (png.width === w && png.height === h) return png.data;
  const out = Buffer.alloc(w * h * 4);
  const srcRow = png.width * 4;
  const dstRow = w * 4;
  for (let y = 0; y < h; y += 1) {
    png.data.copy(out, y * dstRow, y * srcRow, y * srcRow + dstRow);
  }
  return out;
}

// Capture one PNG for the already-prepared page: element clip, the full
// document (--full-page), or the visible viewport (default). Diff URL B can
// provide its own locator through --b/--b-text; otherwise it reuses A.
async function captureShot(cdp, sessionId, args, side = 'a') {
  let clip = null;
  const locatorSide = side === 'b' && (args.selectorB || args.textB) ? 'b' : 'a';
  const hasLocator = locatorSide === 'a'
    ? (args.selectorA || args.textA)
    : (args.selectorB || args.textB);
  if (hasLocator) {
    const box = await evaluate(cdp, sessionId, `(() => {
      const el = ${buildLocatorExpression(args, locatorSide)};
      if (!el) return null;
      try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
      const r = el.getBoundingClientRect();
      return {
        x: Math.max(0, Math.floor(r.left + window.scrollX)),
        y: Math.max(0, Math.floor(r.top + window.scrollY)),
        width: Math.ceil(r.width),
        height: Math.ceil(r.height),
      };
    })()`);
    if (!box) throw new Error('element not found for clip');
    if (box.width < 1 || box.height < 1) throw new Error('located element has zero size');
    clip = box;
  } else if (args.fullPage) {
    const dims = await evaluate(cdp, sessionId, `(() => ({
      width: Math.max(document.documentElement.clientWidth || 0, document.documentElement.scrollWidth || 0),
      height: Math.max(document.documentElement.clientHeight || 0, document.documentElement.scrollHeight || 0),
    }))()`);
    clip = { x: 0, y: 0, width: Math.ceil(dims.width), height: Math.ceil(dims.height) };
  }
  const params = { format: 'png' };
  if (clip) {
    params.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 };
    params.captureBeyondViewport = true;
  }
  const shot = await cdp.send('Page.captureScreenshot', params, sessionId);
  return { buffer: Buffer.from(shot.data, 'base64'), clip, locatorSide };
}

async function readImageInput(input, timeoutMs = 30000) {
  if (/^https?:\/\//i.test(input)) {
    const response = await fetch(input, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`could not fetch image ${input}: ${response.status} ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
  const filePath = input.startsWith('file://') ? new URL(input) : path.resolve(input);
  return fs.readFile(filePath);
}

async function captureDiffSide(cdp, viewport, args, side) {
  const image = side === 'a' ? args.imageA : args.imageB;
  const url = side === 'a' ? args.urlA : args.urlB;
  if (image) {
    return { buffer: await readImageInput(image, args.timeoutMs), clip: null, source: image, initError: '' };
  }
  const sessionId = await newPage(cdp, viewport, args);
  const prep = await navigateAndPrepare(cdp, sessionId, url, args);
  const shot = await captureShot(cdp, sessionId, args, side);
  return { ...shot, source: url, initError: prep.initError || '' };
}

function diffSourceLabel(args, side) {
  const image = side === 'a' ? args.imageA : args.imageB;
  const url = side === 'a' ? args.urlA : args.urlB;
  return image || url;
}

async function runDiff(cdp, args) {
  const { pixelmatch, PNG } = await loadImageDiffDeps();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = args.outDir ? path.resolve(args.outDir) : path.join(os.tmpdir(), `inspect-diff-${stamp}`);
  await fs.mkdir(outDir, { recursive: true });

  const viewportsOut = {};
  for (const name of args.viewports) {
    const viewport = { ...VIEWPORTS[name], ...args.viewportSize };
    try {
      const shotA = await captureDiffSide(cdp, viewport, args, 'a');
      const shotB = await captureDiffSide(cdp, viewport, args, 'b');

      const aFile = path.join(outDir, `${name}-a.png`);
      const bFile = path.join(outDir, `${name}-b.png`);
      const diffFile = path.join(outDir, `${name}-diff.png`);
      await fs.writeFile(aFile, shotA.buffer);
      await fs.writeFile(bFile, shotB.buffer);

      const pa = PNG.sync.read(shotA.buffer);
      const pb = PNG.sync.read(shotB.buffer);
      const w = Math.min(pa.width, pb.width);
      const h = Math.min(pa.height, pb.height);
      const da = cropRGBA(pa, w, h);
      const db = cropRGBA(pb, w, h);
      const diff = new PNG({ width: w, height: h });
      const mismatched = pixelmatch(da, db, diff.data, w, h, {
        threshold: args.threshold,
        includeAA: false,
        alpha: 0.5,
        diffColor: [255, 0, 0],
        aaColor: [255, 255, 0],
      });
      await fs.writeFile(diffFile, PNG.sync.write(diff));

      const total = w * h;
      const pct = total ? (mismatched / total) * 100 : 0;
      const dimensionMismatch = pa.width !== pb.width || pa.height !== pb.height;
      const pass = args.maxDiffPct == null ? null : !dimensionMismatch && pct <= args.maxDiffPct;
      viewportsOut[name] = {
        dimensionsA: { width: pa.width, height: pa.height },
        dimensionsB: { width: pb.width, height: pb.height },
        compared: { width: w, height: h },
        dimensionMismatch,
        mismatchedPixels: mismatched,
        totalPixels: total,
        mismatchPercent: Math.round(pct * 1000) / 1000,
        ...(pass === null ? {} : { maxDiffPct: args.maxDiffPct, pass }),
        clip: shotA.clip || null,
        clipA: shotA.clip || null,
        clipB: shotB.clip || null,
        files: { a: aFile, b: bFile, diff: diffFile },
        sourceA: shotA.source,
        sourceB: shotB.source,
        ...(shotA.initError ? { initErrorA: shotA.initError } : {}),
        ...(shotB.initError ? { initErrorB: shotB.initError } : {}),
      };
    } catch (e) {
      viewportsOut[name] = { error: e.message };
    }
  }

  return {
    subcommand: 'diff',
    ...inspectionState(args),
    generatedAt: new Date().toISOString(),
    label: args.label,
    locator: locatorString(args.selectorA, args.textA) || (args.fullPage ? 'full page' : 'viewport'),
    locatorA: locatorString(args.selectorA, args.textA) || (args.fullPage ? 'full page' : 'viewport'),
    locatorB: locatorString(args.selectorB, args.textB) || locatorString(args.selectorA, args.textA) || (args.fullPage ? 'full page' : 'viewport'),
    threshold: args.threshold,
    sourceA: diffSourceLabel(args, 'a'),
    sourceB: diffSourceLabel(args, 'b'),
    urlA: args.urlA,
    urlB: args.urlB,
    imageA: args.imageA,
    imageB: args.imageB,
    outDir,
    viewports: viewportsOut,
  };
}

function formatDiff(report) {
  const lines = [];
  lines.push(`# diff  A: ${report.sourceA || report.urlA || report.imageA}`);
  lines.push(`#       B: ${report.sourceB || report.urlB || report.imageB}`);
  if (report.label) lines.push(`label: ${report.label}`);
  lines.push(`locator A: ${report.locatorA || report.locator}    locator B: ${report.locatorB || report.locator}    threshold: ${report.threshold}`);
  lines.push(`output:  ${report.outDir}`);
  lines.push('');
  for (const [name, v] of Object.entries(report.viewports)) {
    if (v.error) {
      lines.push(`## ${name}`);
      lines.push(`  error: ${v.error}`);
      lines.push('');
      continue;
    }
    const passStr = v.pass === undefined ? '' : (v.pass ? `  PASS (<= ${v.maxDiffPct}%)` : `  FAIL (${v.dimensionMismatch ? 'dimension mismatch' : `> ${v.maxDiffPct}%`})`);
    lines.push(`## ${name}${passStr}`);
    lines.push(`  mismatch:   ${v.mismatchedPixels} / ${v.totalPixels} px  (${v.mismatchPercent}%)`);
    lines.push(`  compared:   ${v.compared.width}x${v.compared.height} px`
      + (v.dimensionMismatch
        ? `  (A ${v.dimensionsA.width}x${v.dimensionsA.height}, B ${v.dimensionsB.width}x${v.dimensionsB.height}; cropped to common min)`
        : ''));
    if (v.clipA || v.clipB) {
      if (v.clipA) lines.push(`  clip A:     x=${v.clipA.x} y=${v.clipA.y} ${v.clipA.width}x${v.clipA.height} (css px)`);
      if (v.clipB) lines.push(`  clip B:     x=${v.clipB.x} y=${v.clipB.y} ${v.clipB.width}x${v.clipB.height} (css px)`);
    } else if (v.clip) {
      lines.push(`  clip:       x=${v.clip.x} y=${v.clip.y} ${v.clip.width}x${v.clip.height} (css px)`);
    }
    if (v.initErrorA) lines.push(`  initError A: ${v.initErrorA}`);
    if (v.initErrorB) lines.push(`  initError B: ${v.initErrorB}`);
    lines.push(`  diff image: ${v.files.diff}`);
    lines.push('');
  }
  return lines.join('\n').replace(/\n+$/, '');
}

function format(report) {
  const f = report.subcommand;
  if (f === 'distance') return formatDistance(report);
  if (f === 'typography') return formatTypography(report);
  if (f === 'box') return formatBox(report);
  if (f === 'layout') return formatLayout(report);
  if (f === 'styles') return formatStyles(report);
  if (f === 'diff') return formatDiff(report);
  return JSON.stringify(report, null, 2);
}

function formatInspectionState(report) {
  return `browser engine: ${report.browserEngine || 'none (PNG inputs)'}\npage preparation: ${JSON.stringify(report.pagePreparation)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // Fail fast on missing image-diff deps before spawning Chrome.
  if (args.subcommand === 'diff') await loadImageDiffDeps();
  if (args.subcommand === 'diff') {
    const needsChrome = Boolean(args.urlA || args.urlB);
    const session = needsChrome ? await launchChrome() : { cdp: null, close: async () => {} };
    let report;
    try {
      report = await runDiff(session.cdp, args);
    } finally {
      await session.close(args.keepBrowser);
    }
    if (Object.values(report.viewports).some(failedResult)) process.exitCode = 1;
    if (args.format === 'json') process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    else process.stdout.write(formatInspectionState(report) + '\n' + formatDiff(report) + '\n');
    return;
  }
  const { cdp, close } = await launchChrome();
  const targets = [];
  try {
    if (args.urlB) {
      targets.push({ label: 'A', url: args.urlA });
      targets.push({ label: 'B', url: args.urlB });
    } else {
      targets.push({ label: args.label || 'page', url: args.urlA });
    }
    for (const target of targets) {
      target.viewports = await runForUrl(cdp, args, target.url, args.viewports);
    }
  } finally {
    await close(args.keepBrowser);
  }
  const locatorString = (selector, text) => selector ? `selector: ${selector}` : (text ? `text: ${text}` : '');
  const report = {
    subcommand: args.subcommand,
    ...inspectionState(args),
    generatedAt: new Date().toISOString(),
    label: args.label,
    locators: {
      a: locatorString(args.selectorA, args.textA),
      b: locatorString(args.selectorB, args.textB),
    },
    targets,
  };
  if (targets.some(target => Object.values(target.viewports).some(failedResult))) process.exitCode = 1;
  if (args.format === 'json') {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(formatInspectionState(report) + '\n' + format(report) + '\n');
  }
}

export { Cdp, requireWebSocket, waitForJson, readImageInput, shutdownChrome };

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((e) => { process.stderr.write((e.stack || e.message) + '\n'); process.exit(1); });
}
