// Isolated hook calls only: no shell command or GitHub write is executed.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {ProtectedBranchGuard} from '../../.config/opencode/plugins/guard-push.js';

const directory = await mkdtemp(join(tmpdir(), 'opencode-guard-'));
const path = process.env.PATH;
try {
  execFileSync('git', ['init', '-q', '-b', 'main', directory]);
  const hook = (await ProtectedBranchGuard({directory}))['tool.execute.before'];
  const run = (tool, args) => hook({tool}, {args});
  await run('bash', {command: 'git status'});
  await run('bash', {command: 'git push origin feature/test'});
  await assert.rejects(run('bash', {command: 'git push origin main'}), /protected/);
  await assert.rejects(run('bash', {command: 'git push origin HEAD'}), /protected/);
  await assert.rejects(run('bash', {command: 'git push --force origin feature/test'}), /force push/);
  for (const prefix of ['github-mcp_', 'github_mcp_']) {
    for (const action of ['push_files', 'create_or_update_file', 'delete_file']) {
      await run(prefix + action, {branch: 'feature/test'});
      await assert.rejects(run(prefix + action, {branch: 'master'}), /protected/);
      await assert.rejects(run(prefix + action, {}), /no branch/);
    }
  }
  const branch = join(directory, 'working');
  execFileSync('git', ['init', '-q', '-b', 'feature/test', branch]);
  await run('bash', {command: 'git push origin HEAD', workdir: branch});
  process.env.PATH = '';
  await run('read', {filePath: 'README.md'});
  await run('bash', {command: 'printf ready'});
  await assert.rejects(run('bash', {command: 'git push origin main'}));
  console.log('PASS: shared OpenCode guard blocks protected/force writes, honours cwd and fails closed');
} finally {
  process.env.PATH = path;
  await rm(directory, {recursive: true, force: true});
}
