#!/usr/bin/env node

// Thin alias: `measure-distance.mjs ...args` ==> `inspect.mjs distance ...args`.
// Preserved for backwards compatibility. New work should call `inspect.mjs`
// directly so other subcommands (typography, layout, box, styles) are
// discoverable from the same tool.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, 'inspect.mjs');
const child = spawn(process.execPath, [target, 'distance', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
