#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'inspect-password-check-'));
const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), 'inspect.mjs');
let submissions = 0;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    submissions += 1;
    if (url.searchParams.has('stall')) return;
    if (url.searchParams.has('slow')) await new Promise(resolve => setTimeout(resolve, 1800));
    if (new URLSearchParams(body).get('password') !== 'fixture-password') {
      res.writeHead(303, { location: '/password?rejected' });
    } else {
      res.writeHead(303, { location: '/collection', 'set-cookie': 'unlocked=yes; Path=/' });
    }
    res.end();
    return;
  }
  res.setHeader('content-type', 'text/html');
  if (req.headers.cookie?.includes('unlocked=yes')) {
    res.setHeader('cache-control', 'public, max-age=3600');
    res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main style="display:flex;gap:24px;padding:16px"><section id="target" style="height:80px">Unlocked</section></main>');
  } else {
    res.setHeader('cache-control', 'no-store');
    const action = url.searchParams.has('stall') ? '/password?stall'
      : url.searchParams.has('slow') ? '/password?slow' : '/password';
    res.end(`<!doctype html><form action="${action}" method="post"><input name="password" type="password"><input name="submit" value="Unlock"></form>`);
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

async function run(name, flags, password = 'fixture-password') {
  const query = name === 'slow' ? '?slow' : name === 'stalled' ? '?stall' : '';
  const args = [cli, 'distance', '--url', base + '/collection' + query,
    '--a', '#target', '--b', 'main', '--storefront-password', password, '--wait-ms', '0', ...flags];
  const child = spawn(process.execPath, args, {
    env: { ...process.env, TMPDIR: artifacts }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
  try {
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
    await fs.writeFile(path.join(artifacts, `${name}.json`), JSON.stringify({ command: [process.execPath, ...args], ...result }, null, 2));
    assert.deepEqual((await fs.readdir(artifacts)).filter(p => p.startsWith('inspect-mjs-')), [], 'owned browser profiles removed');
    return result;
  } finally { clearTimeout(timer); }
}

try {
  const fast = await run('fast', ['--viewports', 'mobile,tablet,desktop']);
  assert.equal(fast.code, 0, fast.stderr || fast.stdout);
  const report = JSON.parse(fast.stdout);
  for (const viewport of ['mobile', 'tablet', 'desktop']) {
    assert.equal(report.targets[0].viewports[viewport].a.rect.height, 80);
    assert.equal(report.targets[0].viewports[viewport].b.rect.height, 112);
    assert.equal(report.targets[0].viewports[viewport].a.parent.styles.display, 'flex');
    assert.equal(report.targets[0].viewports[viewport].a.parent.styles.gap, '24px');
    assert.equal(report.targets[0].viewports[viewport].a.parent.styles.paddingTop, '16px');
  }
  const slow = await run('slow', ['--viewports', 'desktop']);
  assert.equal(slow.code, 0, slow.stderr || slow.stdout);
  const rejected = await run('rejected', ['--viewports', 'desktop'], 'wrong-fixture-password');
  assert.equal(rejected.code, 1);
  assert.match(rejected.stdout + rejected.stderr, /password.*(?:rejected|locked)|unlock.*failed/i);
  const stalled = await run('stalled', ['--viewports', 'desktop', '--timeout-ms', '600']);
  assert.equal(stalled.code, 1);
  assert.match(stalled.stdout + stalled.stderr, /password submission navigation timed out/i);
  assert.equal(submissions, 6, 'one form submission per isolated viewport, including rejection and timeout');
  console.log(`PASS: immediate/cached and delayed password redirects, shadowed submit control, rejected password, bounded stalled submission, target/parent measurements at mobile/tablet/desktop, owned Chrome cleanup\nEvidence: ${artifacts}`);
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
