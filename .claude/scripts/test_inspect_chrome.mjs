#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'inspect-chrome-check-'));
const scripts = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(scripts, '../../.codex/scripts/inspect.mjs');
const fixture = path.join(artifacts, 'fixture.html');
await fs.writeFile(fixture, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main style="display:flex;gap:24px;padding:16px"><section id="target" style="height:80px">Fixture</section></main>');

function run(flags, env = {}) {
  const child = spawn(process.execPath, [cli, 'styles', '--url', `file://${fixture}`,
    '--a', '#target', '--viewports', 'desktop', '--wait-ms', '0', ...flags], {
    env: { ...process.env, TMPDIR: artifacts, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, done };
}
async function bounded(done) {
  let timer;
  try {
    return await Promise.race([done, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('inspect did not exit within 20s')), 20000);
    })]);
  } finally { clearTimeout(timer); }
}
async function profiles() { return (await fs.readdir(artifacts)).filter(name => name.startsWith('inspect-mjs-')); }

const successful = await bounded(run([]).done);
assert.equal(successful.code, 0, successful.stderr);
assert.equal(JSON.parse(successful.stdout).targets[0].viewports.desktop.a.rect.height, 80);
assert.deepEqual(await profiles(), []);
await fs.writeFile(path.join(artifacts, 'rendered.json'), successful.stdout);

const failed = await bounded(run([], { CHROME_PATH: fixture }).done);
assert.equal(failed.code, 1);
assert.match(failed.stderr, /EACCES/);
assert.deepEqual(await profiles(), [], 'startup failure must remove the owned profile');

for (const signal of ['SIGTERM', 'SIGINT']) {
  const { child, done } = run(['--init-script', 'await new Promise(() => {})']);
  let port;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && !port) {
    for (const profile of await profiles()) {
      try { port = Number((await fs.readFile(path.join(artifacts, profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await delay(50);
  }
  assert.ok(port, 'owned Chrome started');
  child.kill(signal);
  const interrupted = await bounded(done);
  assert.equal(interrupted.code, signal === 'SIGTERM' ? 143 : 130, interrupted.stderr);
  assert.deepEqual(await profiles(), [], `${signal} must remove the owned profile`);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) }), /fetch failed/);
}
console.log(`PASS: real Chrome measurement, startup failure cleanup, SIGTERM and SIGINT forwarded through Codex wrapper, owned browser endpoint closed and profiles removed\nEvidence: ${artifacts}`);
