vim.pack.add({
  "https://github.com/stevearc/conform.nvim",
})

require("conform").setup({
  formatters_by_ft = {
    javascript = { "prettier" },
    javascriptreact = { "prettier" },
    typescript = { "prettier" },
    typescriptreact = { "prettier" },
    css = { "prettier" },
    scss = { "prettier" },
    html = { "prettier" },
    json = { "prettier" },
    jsonc = { "prettier" },
    yaml = { "prettier" },
    markdown = { "prettier" },
    liquid = { "prettier" },
    lua = { "stylua" },
    sh = { "shfmt" },
  },
  format_on_save = function(bufnr)
    if not vim.g.autoformat then
      return
    end
    return { timeout_ms = 500, lsp_fallback = true }
  end,
  formatters = {
    prettier = {
      prepend_args = { "--single-quote", "--jsx-single-quote" },
    },
  },
})

vim.o.formatexpr = "v:lua.require'conform'.formatexpr()"

vim.keymap.set({ "n", "v" }, "<leader>cf", function()
  require("conform").format({ async = true, lsp_fallback = true })
end, { desc = "Format buffer" })

vim.keymap.set({ "n", "v" }, "gQ", function()
  require("conform").format({ async = true, lsp_fallback = true })
end, { desc = "Format buffer" })

vim.api.nvim_create_user_command("ToggleFormat", function()
  vim.g.autoformat = not vim.g.autoformat
  if vim.g.autoformat then
    Snacks.notify.info("Format on save enabled")
  else
    Snacks.notify.info("Format on save disabled")
  end
end, { desc = "Toggle format on save" })
