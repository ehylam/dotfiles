-- Native completion (Neovim 0.12+): vim.lsp.completion + buffer/omnifunc.
-- Completion options live in lua/config/options.lua (complete/completeopt/autocomplete).
-- This file loads before lsp.lua (alphabetical), so '*' capabilities apply to the
-- lspconfig server setups there.

-- Advertise snippet support so LSP snippet items expand via vim.snippet
local capabilities = vim.lsp.protocol.make_client_capabilities()
capabilities.textDocument.completion.completionItem.snippetSupport = true
vim.lsp.config("*", { capabilities = capabilities })

-- Enable native LSP completion on attach
vim.api.nvim_create_autocmd("LspAttach", {
  group = vim.api.nvim_create_augroup("native-completion", { clear = true }),
  callback = function(args)
    local client = vim.lsp.get_client_by_id(args.data.client_id)
    if client and client:supports_method("textDocument/completion") then
      vim.lsp.completion.enable(true, client.id, args.buf, {
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
  end,
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
