vim.pack.add({
  "https://github.com/nvim-mini/mini.nvim",
  "https://github.com/stevearc/conform.nvim",
  "https://github.com/kevinhwang91/nvim-ufo",
  "https://github.com/kevinhwang91/promise-async",
  "https://github.com/dmmulroy/ts-error-translator.nvim",
  "https://github.com/dmmulroy/tsc.nvim",
  "https://github.com/davidosomething/format-ts-errors.nvim",
  "https://github.com/folke/flash.nvim",
})

-- mini.surround + mini.pairs + mini.ai
require("mini.surround").setup()
require("mini.pairs").setup()
require("mini.ai").setup()

-- conform
require("conform").setup({
  formatters_by_ft = {
    lua = { "stylua" },
    python = { "isort", "black" },
    rust = { "rustfmt", lsp_format = "fallback" },
    javascript = {},
    typescript = {},
    javascriptreact = {},
    typescriptreact = {},
  },
  format_on_save = {
    timeout_ms = 3000,
    lsp_format = "fallback",
  },
})

-- nvim-ufo (folding)
vim.o.foldcolumn = "1"
vim.o.foldlevel = 99
vim.o.foldlevelstart = 99
vim.o.foldenable = true

vim.keymap.set("n", "zR", require("ufo").openAllFolds, { desc = "Open all folds" })
vim.keymap.set("n", "zM", require("ufo").closeAllFolds, { desc = "Close all folds" })
vim.keymap.set("n", "zK", function()
  local winid = require("ufo").peekFoldedLinesUnderCursor()
  if not winid then
    vim.lsp.buf.hover()
  end
end, { desc = "Peek Fold" })

require("ufo").setup({
  provider_selector = function(bufnr, filetype, buftype)
    return { "lsp", "indent" }
  end,
})

-- ts-error-translator
require("ts-error-translator").setup()

-- tsc
require("tsc").setup({
  auto_open_qflist = true,
  pretty_errors = false,
})

-- format-ts-errors
require("format-ts-errors").setup({
  add_markdown = true,
  start_indent_level = 0,
})

-- flash
require("flash").setup()
vim.keymap.set({ "n", "x", "o" }, "s", function() require("flash").jump() end, { desc = "Flash" })
vim.keymap.set({ "n", "x", "o" }, "S", function() require("flash").treesitter() end, { desc = "Flash Treesitter" })
vim.keymap.set("o", "r", function() require("flash").remote() end, { desc = "Remote Flash" })
vim.keymap.set({ "o", "x" }, "R", function() require("flash").treesitter_search() end, { desc = "Treesitter Search" })
vim.keymap.set("c", "<c-s>", function() require("flash").toggle() end, { desc = "Toggle Flash Search" })
