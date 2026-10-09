-- Completion is native (Neovim 0.12+): see lua/config/options.lua (complete/completeopt/
-- autocomplete) and lua/config/lsp.lua (vim.lsp.completion.enable + snippet jumps).
-- This file now only owns indent guides.

vim.pack.add({
  "https://github.com/lukas-reineke/indent-blankline.nvim",
})

-- Indent blankline
require("ibl").setup({
  indent = {
    char = "│",
    tab_char = "│",
  },
  scope = {
    enabled = true,
    show_start = false,
    show_end = false,
  },
  exclude = {
    filetypes = {
      "help", "dashboard", "snacks_dashboard", "lazy", "mason", "notify", "toggleterm",
    },
  },
})
