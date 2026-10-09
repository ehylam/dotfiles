vim.pack.add({
  "https://github.com/nvim-lua/plenary.nvim",
  "https://github.com/NeogitOrg/neogit",
  "https://github.com/sindrets/diffview.nvim",
  "https://github.com/akinsho/git-conflict.nvim",
  "https://github.com/lewis6991/gitsigns.nvim",
})

-- Neogit
require("neogit").setup({
  graph_style = "kitty",
  commit_editor = {
    staged_diff_split_kind = "vsplit",
  },
})
vim.keymap.set("n", "<leader>g", ":Neogit<CR>", { desc = "Neogit" })

-- Diffview
require("diffview").setup({})
vim.keymap.set("n", "<Leader>gd", function() require("lib.diffview").toggle_file_history() end, { desc = "diff file" })
vim.keymap.set("n", "<Leader>gS", function() require("lib.diffview").toggle_status() end, { desc = "status" })

-- Git conflict
vim.api.nvim_create_autocmd("User", {
  pattern = "GitConflictDetected",
  callback = function()
    vim.notify("Conflict detected in " .. vim.fn.expand("<afile>"))
  end,
})

require("git-conflict").setup({
  default_mappings = true,
  default_commands = true,
  disable_diagnostics = true,
  list_opener = "copen",
  highlights = {
    incoming = "DiffText",
    current = "DiffAdd",
  },
})

vim.api.nvim_set_hl(0, "GitConflictIncoming", { bg = "#293919" })
vim.api.nvim_set_hl(0, "GitConflictIncomingLabel", { bold = true, bg = "#698F3F" })

vim.keymap.set("n", "<Leader>gcb", "<cmd>GitConflictChooseBoth<CR>", { desc = "choose both" })
vim.keymap.set("n", "<Leader>gcn", "<cmd>GitConflictNextConflict<CR>", { desc = "move to next conflict" })
vim.keymap.set("n", "<Leader>gcc", "<cmd>GitConflictChooseOurs<CR>", { desc = "choose current" })
vim.keymap.set("n", "<Leader>gcp", "<cmd>GitConflictPrevConflict<CR>", { desc = "move to prev conflict" })
vim.keymap.set("n", "<Leader>gci", "<cmd>GitConflictChooseTheirs<CR>", { desc = "choose incoming" })

-- Gitsigns
require("gitsigns").setup({
  signs = {
    add = { text = "┃" },
    change = { text = "┃" },
    delete = { text = "_" },
    topdelete = { text = "‾" },
    changedelete = { text = "~" },
    untracked = { text = "┆" },
  },
  signs_staged = {
    add = { text = "┃" },
    change = { text = "┃" },
    delete = { text = "_" },
    topdelete = { text = "‾" },
    changedelete = { text = "~" },
    untracked = { text = "┆" },
  },
  signs_staged_enable = true,
  signcolumn = true,
  numhl = false,
  linehl = false,
  word_diff = false,
  watch_gitdir = { follow_files = true },
  on_attach = function(bufnr)
    local gitsigns = require("gitsigns")

    local function map(mode, l, r, opts)
      opts = opts or {}
      opts.buffer = bufnr
      vim.keymap.set(mode, l, r, opts)
    end

    -- Navigation
    map("n", "]c", function()
      if vim.wo.diff then
        vim.cmd.normal({ "]c", bang = true })
      else
        gitsigns.nav_hunk("next")
      end
    end)

    map("n", "[c", function()
      if vim.wo.diff then
        vim.cmd.normal({ "[c", bang = true })
      else
        gitsigns.nav_hunk("prev")
      end
    end)

    -- Actions
    map("n", "<leader>hs", gitsigns.stage_hunk)
    map("n", "<leader>hr", gitsigns.reset_hunk)
    map("v", "<leader>hs", function()
      gitsigns.stage_hunk({ vim.fn.line("."), vim.fn.line("v") })
    end)
    map("v", "<leader>hr", function()
      gitsigns.reset_hunk({ vim.fn.line("."), vim.fn.line("v") })
    end)
    map("n", "<leader>hS", gitsigns.stage_buffer)
    map("n", "<leader>hR", gitsigns.reset_buffer)
    map("n", "<leader>hp", gitsigns.preview_hunk)
    map("n", "<leader>hi", gitsigns.preview_hunk_inline)
    map("n", "<leader>hb", function()
      gitsigns.blame_line({ full = true })
    end)
    map("n", "<leader>hd", gitsigns.diffthis)
    map("n", "<leader>hD", function()
      gitsigns.diffthis("~")
    end)
    map("n", "<leader>hQ", function()
      gitsigns.setqflist("all")
    end)
    map("n", "<leader>hq", gitsigns.setqflist)

    -- Toggles
    map("n", "<leader>tb", gitsigns.toggle_current_line_blame)
    map("n", "<leader>tw", gitsigns.toggle_word_diff)

    -- Text object
    map({ "o", "x" }, "ih", gitsigns.select_hunk)
  end,
  attach_to_untracked = false,
  current_line_blame = true,
  current_line_blame_opts = {
    virt_text = true,
    virt_text_pos = "eol",
    delay = 1000,
    ignore_whitespace = false,
    virt_text_priority = 100,
    use_focus = true,
  },
  current_line_blame_formatter = "<author>, <author_time:%R> - <summary>",
  sign_priority = 6,
  update_debounce = 100,
  status_formatter = nil,
  max_file_length = 40000,
  preview_config = {
    border = "single",
    style = "minimal",
    relative = "cursor",
    row = 0,
    col = 1,
  },
})
