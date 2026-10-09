-- Native Neovim 0.11+ LSP Configuration
-- Server configs are in ~/.config/cnvim/lsp/*.lua

-- schemastore is required by lsp/jsonls.lua — must be available before vim.lsp.enable()
vim.pack.add({ "https://github.com/b0o/schemastore.nvim" })

-- Native completion capabilities (advertise snippet support so LSP snippet items expand)
local capabilities = vim.lsp.protocol.make_client_capabilities()
capabilities.textDocument.completion.completionItem.snippetSupport = true

vim.lsp.config("*", {
  root_markers = { ".git" },
  capabilities = capabilities,
})

-- Enable all configured servers (configs in lsp/ directory)
-- Note: TypeScript is handled by typescript-tools.nvim plugin (faster than ts_ls)
--       or tsgo if installed (experimental, faster native Go port)
local servers = {
  "eslint",
  "cssls",
  "html",
  "jsonls",
  "lua_ls",
  "emmet_language_server",
  "bashls",
}

-- Use tsgo if available, otherwise typescript-tools handles TS
if vim.fn.executable("tsgo") == 1 then
  table.insert(servers, "tsgo")
end

vim.lsp.enable(servers)

-- In-process LSPs (no external binary required)
require("lsp.spell").setup()
require("lsp.todo").setup()
require("lsp.snippets").setup()

-- Diagnostic configuration
vim.diagnostic.config({
  severity_sort = true,
  float = {
    source = true,
    border = vim.g.border_style,
  },
  signs = {
    text = {
      [vim.diagnostic.severity.ERROR] = " ",
      [vim.diagnostic.severity.WARN] = " ",
      [vim.diagnostic.severity.INFO] = " ",
      [vim.diagnostic.severity.HINT] = "󰌵 ",
    },
    numhl = {
      [vim.diagnostic.severity.ERROR] = "DiagnosticSignError",
      [vim.diagnostic.severity.WARN] = "DiagnosticSignWarn",
      [vim.diagnostic.severity.INFO] = "DiagnosticSignInfo",
      [vim.diagnostic.severity.HINT] = "DiagnosticSignHint",
    },
  },
  virtual_text = false, -- Using tiny-inline-diagnostic + fancy float (D)
  underline = true,
})

-- In-process LSP servers (render-markdown, lsp/{spell,todo,snippets}) answer
-- requests synchronously. 'autocomplete' drives completion through omnifunc,
-- which runs under textlock, so a synchronous reply lands vim.fn.complete()
-- there: E5108 ... E565, and no items. Defer the reply one tick.
local deferred = {} ---@type table<integer, true>
local function defer_inprocess_completion(client)
  if deferred[client.id] or type(client.config.cmd) ~= "function" then
    return
  end
  deferred[client.id] = true
  local request = client.rpc.request
  client.rpc.request = function(method, params, callback, ...)
    if method == "textDocument/completion" and callback then
      local reply = callback
      callback = function(...)
        local packed = vim.F.pack_len(...)
        vim.schedule(function()
          reply(vim.F.unpack_len(packed))
        end)
      end
    end
    return request(method, params, callback, ...)
  end
end

-- LspAttach autocmd
vim.api.nvim_create_autocmd("LspAttach", {
  group = vim.api.nvim_create_augroup("lsp-attach", { clear = true }),
  callback = function(args)
    local client = vim.lsp.get_client_by_id(args.data.client_id)
    local buf = args.buf

    local map = function(keys, func, desc, mode)
      vim.keymap.set(mode or "n", keys, func, { buffer = buf, desc = "LSP: " .. desc })
    end

    -- Native LSP completion (Neovim 0.12+; auto-triggered by vim.o.autocomplete)
    if client and client:supports_method("textDocument/completion") then
      defer_inprocess_completion(client)
      vim.lsp.completion.enable(true, client.id, buf, {
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

    -- Basic keymaps (only set K if client supports hover)
    if client and client.supports_method("textDocument/hover") then
      map("K", vim.lsp.buf.hover, "Hover")
    end
    map("grn", vim.lsp.buf.rename, "Rename")
    map("gra", vim.lsp.buf.code_action, "Code action", { "n", "x" })
    map("grs", "<cmd>LspRestart<cr>", "Restart LSP")
    map("<C-k>", vim.lsp.buf.signature_help, "Signature help", "i")

    -- Diagnostic navigation
    map("[d", vim.diagnostic.goto_prev, "Previous diagnostic")
    map("]d", vim.diagnostic.goto_next, "Next diagnostic")
    map("[e", function() vim.diagnostic.goto_prev({ severity = vim.diagnostic.severity.ERROR }) end, "Previous error")
    map("]e", function() vim.diagnostic.goto_next({ severity = vim.diagnostic.severity.ERROR }) end, "Next error")

    -- Document highlighting (CursorHold only for performance)
    if client and client:supports_method("textDocument/documentHighlight") then
      local highlight_group = vim.api.nvim_create_augroup("lsp-highlight-" .. buf, { clear = true })
      vim.api.nvim_create_autocmd({ "CursorHold", "CursorHoldI" }, {
        buffer = buf,
        group = highlight_group,
        callback = vim.lsp.buf.document_highlight,
      })
      vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI" }, {
        buffer = buf,
        group = highlight_group,
        callback = vim.lsp.buf.clear_references,
      })
      vim.api.nvim_create_autocmd("LspDetach", {
        buffer = buf,
        group = highlight_group,
        callback = function(event)
          vim.lsp.util.buf_clear_references(buf)
          for _, remaining in ipairs(vim.lsp.get_clients({ bufnr = buf, method = "textDocument/documentHighlight" })) do
            if remaining.id ~= event.data.client_id then
              return
            end
          end
          vim.api.nvim_clear_autocmds({ group = highlight_group, buffer = buf })
        end,
      })
    end

    -- Inlay hints (off by default)
    if client and client.supports_method("textDocument/inlayHint") then
      if vim.g.inlay_hints then
        vim.lsp.inlay_hint.enable(true, { bufnr = buf })
      end
    end

    -- ESLint fix all
    if client and client.name == "eslint" then
      map("<leader>cF", function()
        vim.cmd("EslintFixAll")
      end, "Fix all ESLint")
    end

    -- Format command
    vim.api.nvim_buf_create_user_command(buf, "Format", function()
      vim.lsp.buf.format()
    end, { desc = "Format with LSP" })
  end,
})

-- Snippet navigation for native completion (LSP snippets expanded by vim.snippet).
-- Normal-mode <Tab> (sidekick NES) is unaffected; these are insert/select mode only.
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
