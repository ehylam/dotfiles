-- LSP Configuration

-- Native completion capabilities (advertise snippet support so LSP snippet items expand)
local capabilities = vim.lsp.protocol.make_client_capabilities()
capabilities.textDocument.completion.completionItem.snippetSupport = true
vim.lsp.config("*", { capabilities = capabilities })

local servers = {
  lua_ls = {
    cmd = { "lua-language-server" },
    filetypes = { "lua" },
    root_markers = { ".luarc.json", ".luarc.jsonc", ".git" },
    settings = { Lua = { diagnostics = { globals = { "vim" } }, workspace = { checkThirdParty = false } } },
  },
  ts_ls = {
    cmd = { "typescript-language-server", "--stdio" },
    filetypes = { "javascript", "javascriptreact", "typescript", "typescriptreact" },
    root_markers = { "tsconfig.json", "jsconfig.json", "package.json", ".git" },
  },
  jsonls = {
    cmd = { "vscode-json-language-server", "--stdio" },
    filetypes = { "json", "jsonc" },
    root_markers = { "package.json", ".git" },
  },
  html = {
    cmd = { "vscode-html-language-server", "--stdio" },
    filetypes = { "html" },
    root_markers = { "package.json", ".git" },
  },
  cssls = {
    cmd = { "vscode-css-language-server", "--stdio" },
    filetypes = { "css", "scss", "less" },
    root_markers = { "package.json", ".git" },
  },
}
for name, config in pairs(servers) do
  vim.lsp.config(name, config)
end
vim.lsp.enable(vim.tbl_keys(servers))

vim.api.nvim_create_autocmd("LspAttach", {
  group = vim.api.nvim_create_augroup("lsp-attach", { clear = true }),
  callback = function(event)
    local map = function(keys, func, desc, mode)
      mode = mode or "n"
      vim.keymap.set(mode, keys, func, { buffer = event.buf, desc = desc })
    end

    -- Native LSP completion (Neovim 0.12+; auto-triggered by vim.o.autocomplete)
    local client = vim.lsp.get_client_by_id(event.data.client_id)
    if client and client:supports_method("textDocument/completion") then
      vim.lsp.completion.enable(true, client.id, event.buf, {
        convert = function(item)
          -- Show only the abbr name: strip (args)/{...}, drop leading misc chars, cap to 15
          local abbr = item.label
          abbr = abbr:gsub("%b()", ""):gsub("%b{}", "")
          abbr = abbr:match("[%w_.]+.*") or abbr
          abbr = #abbr > 15 and abbr:sub(1, 14) .. "…" or abbr
          -- Cap the detail (menu) field to 15 chars
          local menu = item.detail or ""
          menu = #menu > 15 and menu:sub(1, 14) .. "…" or menu
          return { abbr = abbr, menu = menu }
        end,
      })
    end

    -- Navigation (fzf-lua handles gd, gr, etc. in picker.lua)
    map("gD", vim.lsp.buf.declaration, "Go to declaration")

    -- Actions
    map("<leader>ca", vim.lsp.buf.code_action, "Code action", { "n", "v" })
    map("<leader>cr", vim.lsp.buf.rename, "Rename")
    map("<leader>cf", function()
      vim.lsp.buf.format({ async = true })
    end, "Format")

    -- Signature help in insert mode
    map("<C-k>", vim.lsp.buf.signature_help, "Signature help", "i")
  end,
})

-- Diagnostic configuration
vim.diagnostic.config({
  underline = true,
  update_in_insert = false,
  virtual_text = {
    spacing = 4,
    prefix = "●",
  },
  severity_sort = true,
  float = {
    border = vim.g.border_style,
    source = true,
  },
  signs = {
    text = {
      [vim.diagnostic.severity.ERROR] = " ",
      [vim.diagnostic.severity.WARN] = " ",
      [vim.diagnostic.severity.HINT] = " ",
      [vim.diagnostic.severity.INFO] = " ",
    },
  },
})

-- Snippet navigation for native completion (insert/select mode only)
vim.keymap.set({ "i", "s" }, "<Tab>", function()
  if vim.snippet.active({ direction = 1 }) then
    return "<cmd>lua vim.snippet.jump(1)<cr>"
  end
  return "<Tab>"
end, { expr = true, silent = true, desc = "Snippet jump forward / Tab" })

vim.keymap.set({ "i", "s" }, "<S-Tab>", function()
  if vim.snippet.active({ direction = -1 }) then
    return "<cmd>lua vim.snippet.jump(-1)<cr>"
  end
  return "<S-Tab>"
end, { expr = true, silent = true, desc = "Snippet jump backward / S-Tab" })
