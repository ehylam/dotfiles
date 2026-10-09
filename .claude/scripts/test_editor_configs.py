#!/usr/bin/env python3
"""Offline editor regressions using isolated Neovim and Helix configurations."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import tomllib
import unittest

ROOT = Path(__file__).resolve().parents[2]


def lsp_fixture():
    while True:
        length = None
        while True:
            line = sys.stdin.buffer.readline()
            if not line:
                return
            if line in (b'\r\n', b'\n'):
                break
            if line.lower().startswith(b'content-length:'):
                length = int(line.split(b':', 1)[1])
        if length is None:
            return
        message = json.loads(sys.stdin.buffer.read(length))
        if message.get('method') == 'exit':
            return
        if 'id' not in message:
            continue
        result = {'capabilities': {'textDocumentSync': 1, 'completionProvider': {}}} if message.get('method') == 'initialize' else None
        body = json.dumps({'jsonrpc': '2.0', 'id': message['id'], 'result': result}).encode()
        sys.stdout.buffer.write(f'Content-Length: {len(body)}\r\n\r\n'.encode() + body)
        sys.stdout.buffer.flush()


class EditorConfigTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='editor-configs-')
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.env = dict(os.environ, HOME=str(self.folder), XDG_CONFIG_HOME=str(self.folder / 'config'),
                        XDG_DATA_HOME=str(self.folder / 'data'), XDG_STATE_HOME=str(self.folder / 'state'),
                        XDG_CACHE_HOME=str(self.folder / 'cache'), EDITOR_SOURCE=str(ROOT),
                        EDITOR_FIXTURE=str(self.folder), EDITOR_PYTHON=sys.executable,
                        EDITOR_TEST=str(Path(__file__).resolve()))

    def nvim(self, source):
        binary = shutil.which('nvim')
        self.assertIsNotNone(binary, 'nvim is required')
        script = self.folder / 'check.lua'
        script.write_text(source)
        result = subprocess.run([binary, '--headless', '-u', 'NONE', '-n', '-i', 'NONE', '-l', str(script)],
                                cwd=self.folder, env=self.env, text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_helix_loads_language_overrides_and_semantic_servers(self):
        binary = shutil.which('hx')
        self.assertIsNotNone(binary, 'hx is required')
        source = ROOT / '.config/helix/languages.toml'
        self.assertTrue(source.is_file())
        self.assertFalse((source.parent / 'language.toml').exists())
        data = tomllib.loads(source.read_text())
        languages = {entry['name']: entry for entry in data['language']}
        for language in ('javascript', 'typescript', 'jsx', 'tsx'):
            names = [server if isinstance(server, str) else server['name']
                     for server in languages[language]['language-servers']]
            self.assertIn('typescript-language-server', names)
            self.assertIn('eslint', names)
            self.assertNotIn('vscode-eslint-language-server', names)
        self.assertEqual(languages['rust']['language-servers'], ['rust-analyzer'])
        config = self.folder / 'config/helix'
        config.mkdir(parents=True)
        shutil.copyfile(source, config / 'languages.toml')
        for language in ('javascript', 'typescript', 'jsx', 'tsx', 'rust', 'markdown'):
            result = subprocess.run([binary, '--health', language], cwd=self.folder,
                                    env=self.env, text=True, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertNotIn('Failed to parse', result.stdout + result.stderr)
            if language in ('javascript', 'typescript', 'jsx', 'tsx'):
                self.assertIn('typescript-language-server', result.stdout)
                self.assertIn('vscode-eslint-language-server', result.stdout)
            if language in ('jsx', 'tsx'):
                self.assertIn('tailwindcss-language-server', result.stdout)
            if language == 'rust':
                self.assertNotIn('tailwind', result.stdout)

    def test_nvim_lite_native_server_enablement_and_attachment(self):
        (self.folder / 'package.json').write_text('{}\n')
        self.nvim('''
local root = vim.env.EDITOR_SOURCE
dofile(root .. '/.config/nvim-lite/lua/config/lsp.lua')
local tools = dofile(root .. '/.config/nvim-lite/lua/plugins/lsp.lua')[1]
assert(tools.lazy == false, 'Mason must set PATH before servers activate')
local cases = {
  lua_ls = { 'lua-language-server', 'lua', 'main.lua' },
  ts_ls = { 'typescript-language-server', 'typescript', 'main.ts' },
  jsonls = { 'vscode-json-language-server', 'json', 'theme.json' },
  html = { 'vscode-html-language-server', 'html', 'index.html' },
  cssls = { 'vscode-css-language-server', 'scss', 'style.scss' },
}
for name, item in pairs(cases) do
  assert(vim.lsp.is_enabled(name), name .. ' is disabled')
  local config = vim.lsp.config[name]
  assert(config.cmd[1] == item[1], name .. ' has wrong executable')
  assert(vim.tbl_contains(config.filetypes, item[2]), name .. ' has wrong filetypes')
  assert(config.capabilities.textDocument.completion.completionItem.snippetSupport)
  vim.lsp.config(name, { cmd = { vim.env.EDITOR_PYTHON, vim.env.EDITOR_TEST, '--lsp-fixture' } })
  vim.cmd.edit(vim.env.EDITOR_FIXTURE .. '/' .. item[3])
  local buf = vim.api.nvim_get_current_buf()
  vim.bo[buf].filetype = item[2]
  assert(vim.wait(3000, function()
    return #vim.lsp.get_clients({ bufnr = buf, name = name }) == 1
  end), name .. ' did not attach')
  local client = vim.lsp.get_clients({ bufnr = buf, name = name })[1]
  assert(client.initialized, name .. ' did not initialise')
  assert(vim.fn.maparg('gD', 'n', false, true).buffer == 1, 'attach keymaps missing')
  client:stop()
end
''')

    def test_cnvim_highlights_clear_on_movement_and_last_detach(self):
        self.nvim('''
vim.pack.add = function() end
vim.lsp.enable = function() end
for _, name in ipairs({ 'spell', 'todo', 'snippets' }) do
  package.preload['lsp.' .. name] = function() return { setup = function() end } end
end
local clients = {}
local function client(id)
  return { id = id, supports_method = function(self, method)
    return (method or self) == 'textDocument/documentHighlight'
  end }
end
clients[1], clients[2] = client(1), client(2)
vim.lsp.get_client_by_id = function(id) return clients[id] end
vim.lsp.get_clients = function() return vim.tbl_values(clients) end
local highlights, clears = 0, 0
vim.lsp.buf.document_highlight = function() highlights = highlights + 1 end
vim.lsp.buf.clear_references = function() clears = clears + 1 end
vim.lsp.util.buf_clear_references = function() clears = clears + 1 end
dofile(vim.env.EDITOR_SOURCE .. '/.config/cnvim/lua/config/lsp.lua')
local buf = vim.api.nvim_get_current_buf()
local function event(name, id)
  vim.api.nvim_exec_autocmds(name, { buffer = buf, data = { client_id = id } })
end
event('LspAttach', 1)
event('LspAttach', 2)
event('CursorHold')
assert(highlights == 1 and clears == 0, 'hold erased or duplicated highlights')
event('CursorHoldI')
assert(highlights == 2 and clears == 0, 'insert hold erased highlights')
event('CursorMoved')
event('CursorMovedI')
assert(clears == 2, 'movement did not clear highlights')
event('LspDetach', 1)
clients[1] = nil
event('CursorHold')
assert(highlights == 3, 'one detach removed another client highlight hooks')
event('LspDetach', 2)
clients[2] = nil
assert(#vim.api.nvim_get_autocmds({ group = 'lsp-highlight-' .. buf }) == 0, 'last detach left hooks')
event('CursorHold')
assert(highlights == 3, 'detached buffer still requests highlights')
''')


if __name__ == '__main__':
    if '--lsp-fixture' in sys.argv:
        lsp_fixture()
    else:
        unittest.main()
