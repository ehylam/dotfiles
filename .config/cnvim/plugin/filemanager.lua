vim.pack.add({
  "https://github.com/mikavilpas/yazi.nvim",
})

-- Uses the yazi binary from Homebrew (tracked in the Brewfile).
-- snacks.explorer stays on <leader>e; this is the full file-manager view.
require("yazi").setup({
  open_for_directories = false,
  keymaps = { show_help = "<f1>" },
})

local map = vim.keymap.set
map("n", "<leader>-", "<cmd>Yazi<cr>", { desc = "Yazi at current file" })
map("n", "<leader>_", "<cmd>Yazi cwd<cr>", { desc = "Yazi at cwd" })
map("n", "<c-up>", "<cmd>Yazi toggle<cr>", { desc = "Resume last Yazi session" })
