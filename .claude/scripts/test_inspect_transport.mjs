#!/usr/bin/env node

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Cdp, requireWebSocket, waitForJson, readImageInput, shutdownChrome } from './inspect.mjs';

class Socket extends EventTarget {
  static last;
  constructor() { super(); Socket.last = this; this.sent = []; this.closed = false; }
  send(text) { this.sent.push(JSON.parse(text)); }
  close() { this.closed = true; this.dispatchEvent(new Event('close')); }
  reply(message) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })); }
}

assert.throws(() => requireWebSocket(null), /Use Node 22\+/);
await assert.rejects(Cdp.connect('ws://fixture', 20, Socket), /connection timed out/);
assert.equal(Socket.last.closed, true);
for (const event of ['error', 'close']) {
  const connecting = Cdp.connect('ws://fixture', 100, Socket);
  Socket.last.dispatchEvent(new Event(event));
  await assert.rejects(connecting, /failed|closed before/);
}
const connecting = Cdp.connect('ws://fixture', 100, Socket);
Socket.last.dispatchEvent(new Event('open'));
const connected = await connecting;
connected.close();

let socket = new Socket();
let cdp = new Cdp(socket, 20);
await assert.rejects(cdp.send('Page.enable'), /CDP Page.enable timed out/);
assert.equal(cdp.pending.size, 0);
socket.reply({ id: 1, result: { late: true } });
const reply = cdp.send('Runtime.enable');
socket.reply({ id: 2, result: { enabled: true } });
assert.deepEqual(await reply, { enabled: true });
const protocolError = cdp.send('Unknown.command');
socket.reply({ id: 3, error: { message: 'Unknown command' } });
await assert.rejects(protocolError, /Unknown command/);
for (const event of ['error', 'close']) {
  socket = new Socket();
  cdp = new Cdp(socket, 100);
  const pending = [cdp.send('Page.enable'), cdp.send('Runtime.enable')];
  socket.dispatchEvent(new Event(event));
  await Promise.all(pending.map(p => assert.rejects(p, /CDP socket/)));
  assert.equal(cdp.pending.size, 0);
  await assert.rejects(cdp.send('Page.enable'), /CDP socket/);
}
socket = new Socket();
socket.send = () => { throw new Error('send failed'); };
cdp = new Cdp(socket, 100);
await assert.rejects(cdp.send('Page.enable'), /send failed/);
assert.equal(cdp.pending.size, 0);

class OwnedProcess extends EventEmitter {
  exitCode = null;
  signalCode = null;
  signals = [];
  kill(signal) {
    this.signals.push(signal);
    if (signal === 'SIGKILL') { this.signalCode = signal; this.emit('exit'); }
  }
}
const proc = new OwnedProcess();
socket = new Socket();
cdp = new Cdp(socket, 100);
const began = Date.now();
await shutdownChrome(cdp, proc, 20);
assert.ok(Date.now() - began < 1000, 'hung Browser.close must not hang shutdown');
assert.deepEqual(proc.signals, ['SIGTERM', 'SIGKILL']);
assert.equal(socket.closed, true);
assert.equal(cdp.pending.size, 0);
assert.equal(proc.listenerCount('exit'), 0);

const server = createServer((req, res) => {
  if (req.url === '/headers') return; // A server that never sends headers.
  if (req.url === '/json') { res.writeHead(200); res.write('{'); return; }
  res.writeHead(200, { 'content-type': 'image/png' });
  res.write(Buffer.from([137, 80, 78, 71])); // A body that never completes.
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  for (const endpoint of ['/headers', '/json']) {
    const start = Date.now();
    await assert.rejects(waitForJson(base + endpoint, 40), /Timed out waiting/);
    assert.ok(Date.now() - start < 1500);
  }
  for (const endpoint of ['/headers', '/image']) {
    await assert.rejects(readImageInput(base + endpoint, 40), /timeout|aborted/i);
  }
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

const artifacts = mkdtempSync(path.join(os.tmpdir(), 'inspect-transport-check-'));
const scripts = path.dirname(fileURLToPath(import.meta.url));
const preload = path.join(artifacts, 'no-websocket.mjs');
writeFileSync(preload, 'globalThis.WebSocket = undefined;\n');
for (const cli of [path.join(scripts, 'inspect.mjs'), path.resolve(scripts, '../../.codex/scripts/inspect.mjs')]) {
  const result = spawnSync(process.execPath, [cli, 'styles',
    '--url', 'http://127.0.0.1:1', '--a', 'main'], {
    encoding: 'utf8', timeout: 5000, env: { ...process.env, CHROME_PATH: '/missing/chrome',
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${preload}` },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Use Node 22\+/);
  assert.doesNotMatch(result.stderr, /No Chrome/);
}
const alias = path.join(artifacts, 'inspect.mjs');
symlinkSync(path.join(scripts, 'inspect.mjs'), alias);
const help = spawnSync(process.execPath, [alias, '--help'], { encoding: 'utf8', timeout: 5000 });
assert.equal(help.status, 0);
assert.match(help.stdout, /Usage:/);
console.log('PASS: WebSocket capability and handshake failures, command timeout/replies, socket closure, send errors, bounded owned shutdown, stalled fetch headers/bodies, Codex wrapper and symlink entry point');
