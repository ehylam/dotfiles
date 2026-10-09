#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, '../../.claude/scripts/inspect.mjs');
const child = spawn(process.execPath, [target, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

const forwardInterrupt = () => child.kill('SIGINT');
const forwardTerminate = () => child.kill('SIGTERM');
process.on('SIGINT', forwardInterrupt);
process.on('SIGTERM', forwardTerminate);
child.on('error', error => {
  process.stderr.write(`Could not start inspect: ${error.message}\n`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  process.removeListener('SIGINT', forwardInterrupt);
  process.removeListener('SIGTERM', forwardTerminate);
  if (signal) { process.kill(process.pid, signal); return; }
  process.exit(code ?? 1);
});
