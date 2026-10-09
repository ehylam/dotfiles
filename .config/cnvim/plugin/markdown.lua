vim.pack.add({
  "https://github.com/MeanderingProgrammer/render-markdown.nvim",
})

-- In-buffer markdown rendering. Note: plugin/treesitter.lua stops the built-in
-- treesitter highlighter for markdown because injection resolution crashes on
-- 0.12.3 (parse(true) hits a nil node in vim/treesitter.lua get_range).
-- render-markdown only needs the markdown tree itself, which parses fine.
require("render-markdown").setup({
  completions = { lsp = { enabled = true } },
  latex = { enabled = false },
  win_options = {
    -- Keep concealment scoped so raw markup is still editable on the cursor line.
    conceallevel = { rendered = 2 },
  },
})

vim.keymap.set("n", "<leader>um", "<cmd>RenderMarkdown toggle<cr>", { desc = "Toggle markdown rendering" })
