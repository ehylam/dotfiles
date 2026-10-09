#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const shared = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'inspect');
const fixtureRequire = [process.cwd(), shared, scripts]
  .map(root => createRequire(path.join(root, 'noop.js')))
  .find(req => {
    try { req.resolve('pngjs'); req.resolve('pixelmatch'); return true; }
    catch { return false; }
  });
assert.ok(fixtureRequire, 'Run bash ~/.claude/scripts/setup-inspect-diff.sh first');
const { PNG } = fixtureRequire('pngjs');
const artifacts = mkdtempSync(path.join(os.tmpdir(), 'inspect-diff-check-'));
const base = new PNG({ width: 16, height: 16 });
base.data.fill(255);
const changed = new PNG({ width: 16, height: 16 });
changed.data.fill(255);
for (let y = 0; y < 8; y++) {
  for (let x = 0; x < 8; x++) {
    const offset = (y * 16 + x) * 4;
    changed.data.fill(0, offset, offset + 3);
  }
}
const wider = new PNG({ width: 17, height: 16 });
wider.data.fill(255);
for (const [name, png] of [['reference', base], ['changed', changed], ['wider', wider]]) {
  writeFileSync(path.join(artifacts, `${name}.png`), PNG.sync.write(png));
}
writeFileSync(path.join(artifacts, 'invalid.png'), 'not a PNG');

function run(name, image, gate, { cli = path.join(scripts, 'inspect.mjs'), env = process.env } = {}) {
  const result = spawnSync(process.execPath, [cli, 'diff',
    '--image-a', path.join(artifacts, 'reference.png'),
    '--image-b', path.join(artifacts, `${image}.png`),
    '--viewports', 'desktop', '--threshold', '0', '--max-diff-pct', String(gate),
    '--out', path.join(artifacts, name), '--format', 'json'],
  { cwd: artifacts, env, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.error, undefined);
  writeFileSync(path.join(artifacts, `${name}.json`), result.stdout || '{}');
  writeFileSync(path.join(artifacts, `${name}.stderr`), result.stderr);
  return { status: result.status, stderr: result.stderr,
    report: result.stdout ? JSON.parse(result.stdout) : null };
}

const identical = run('identical', 'reference', 0);
assert.equal(identical.status, 0, identical.stderr);
assert.equal(identical.report.browserEngine, null);
assert.equal(identical.report.viewports.desktop.pass, true);
assert.equal(identical.report.viewports.desktop.mismatchedPixels, 0);
const mismatch = run('mismatch', 'changed', 0);
assert.equal(mismatch.status, 1, mismatch.stderr);
assert.equal(mismatch.report.viewports.desktop.pass, false);
assert.equal(mismatch.report.viewports.desktop.mismatchPercent, 25);
const dimensions = run('dimensions', 'wider', 100);
assert.equal(dimensions.status, 1, dimensions.stderr);
assert.equal(dimensions.report.viewports.desktop.dimensionMismatch, true);
assert.equal(dimensions.report.viewports.desktop.pass, false);
const invalid = run('invalid', 'invalid', 100);
assert.equal(invalid.status, 1, invalid.stderr);
assert.ok(invalid.report.viewports.desktop.error);
const codex = run('codex-wrapper', 'reference', 0, {
  cli: path.resolve(scripts, '../../.codex/scripts/inspect.mjs'),
});
assert.equal(codex.status, 0, codex.stderr);
assert.equal(codex.report.viewports.desktop.pass, true);
const preload = path.join(artifacts, 'no-websocket.mjs');
writeFileSync(preload, 'globalThis.WebSocket = undefined;\n');
const withoutWebSocket = run('no-websocket-local', 'reference', 0, {
  env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${preload}` },
});
assert.equal(withoutWebSocket.status, 0, withoutWebSocket.stderr);
assert.equal(withoutWebSocket.report.viewports.desktop.pass, true);
const withoutShared = { ...process.env, XDG_DATA_HOME: path.join(artifacts, 'empty-data'), NODE_PATH: '' };
const ambientFallback = [artifacts, path.join(withoutShared.XDG_DATA_HOME, 'inspect'), scripts].some(root => {
  const req = createRequire(path.join(root, 'noop.js'));
  try { req.resolve('pixelmatch'); req.resolve('pngjs'); return true; }
  catch { return false; }
});
if (ambientFallback) {
  console.log('SKIP: missing-dependency case; ambient fallback packages are present');
} else {
  const missing = run('missing-dependencies', 'reference', 0, { env: withoutShared });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /setup-inspect-diff\.sh/);
  assert.equal(missing.report, null);
}

cpSync(path.dirname(path.dirname(fixtureRequire.resolve('pngjs'))),
  path.join(artifacts, 'node_modules/pngjs'), { recursive: true });
cpSync(path.dirname(fixtureRequire.resolve('pixelmatch')),
  path.join(artifacts, 'node_modules/pixelmatch'), { recursive: true });
const projectOnly = run('project-only', 'changed', 0, { env: withoutShared });
assert.equal(projectOnly.status, 1, projectOnly.stderr);
assert.equal(projectOnly.report.viewports.desktop.mismatchPercent, 25);

// A stub makes project precedence observable without changing shared packages.
const project = path.join(artifacts, 'node_modules/pixelmatch');
mkdirSync(project, { recursive: true });
writeFileSync(path.join(project, 'package.json'), JSON.stringify({ type: 'module', main: 'index.js' }));
writeFileSync(path.join(project, 'index.js'), 'export default (_a, _b, _out, width, height) => width * height;\n');
const projectPriority = run('project-priority', 'reference', 0);
assert.equal(projectPriority.status, 1, projectPriority.stderr);
assert.equal(projectPriority.report.viewports.desktop.mismatchPercent, 100);
console.log(`PASS: identical, pixel mismatch, dimensions, malformed PNG, Codex wrapper, local PNG without WebSocket, project-only and project precedence; missing-dependency case checked when isolated\nEvidence: ${artifacts}`);
