// Reuse the shared branch guard for OpenCode shell and GitHub MCP writes.
import {spawn} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';

export const ProtectedBranchGuard = async ({directory}) => ({
  'tool.execute.before': async (input, output) => {
    const args = output.args || {};
    const github = /^(?:github[-_]mcp_)(push_files|create_or_update_file|delete_file)$/.exec(input.tool);
    const shell = input.tool === 'bash' && /git|push/.test(args.command || '');
    if (!shell && !github) return;
    const payload = {
      tool_name: github ? 'mcp__github__' + github[1] : 'Bash',
      tool_input: args,
      cwd: args.workdir || directory || process.cwd(),
    };
    await new Promise((resolve, reject) => {
      const child = spawn('python3', [join(homedir(), '.dotfiles/.claude/scripts/guard-push.py')],
        {stdio: ['pipe', 'ignore', 'pipe'], timeout: 10000});
      let error = '';
      child.stderr.on('data', chunk => { error = (error + chunk).slice(0, 2048); });
      child.on('error', reject);
      child.stdin.on('error', reject);
      child.on('close', code => code === 0 ? resolve() :
        reject(new Error(error.trim() || 'Protected-branch guard could not run')));
      child.stdin.end(JSON.stringify(payload));
    });
  },
});
