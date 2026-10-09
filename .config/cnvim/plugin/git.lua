vim.pack.add({
  "https://github.com/lewis6991/gitsigns.nvim",
  "https://github.com/ruifm/gitlinker.nvim",
  "https://github.com/nvim-lua/plenary.nvim",
  "https://github.com/spacedentist/resolve.nvim",
  "https://github.com/esmuellert/codediff.nvim",
  "https://github.com/MunifTanjim/nui.nvim",
})

-- Gitsigns
require("gitsigns").setup({
  signs = {
    add = { text = "│" },
    change = { text = "│" },
    delete = { text = "_" },
    topdelete = { text = "‾" },
    changedelete = { text = "~" },
    untracked = { text = "┆" },
  },
  signs_staged_enable = true,
  on_attach = function(bufnr)
    local gs = package.loaded.gitsigns

    local function map(mode, l, r, opts)
      opts = opts or {}
      opts.buffer = bufnr
      vim.keymap.set(mode, l, r, opts)
    end

    -- Navigation
    map("n", "]g", function()
      if vim.wo.diff then return "]c" end
      vim.schedule(function() gs.next_hunk() end)
      return "<Ignore>"
    end, { expr = true, desc = "Next hunk" })

    map("n", "[g", function()
      if vim.wo.diff then return "[c" end
      vim.schedule(function() gs.prev_hunk() end)
      return "<Ignore>"
    end, { expr = true, desc = "Previous hunk" })

    -- Actions
    map("n", "<leader>gs", gs.stage_hunk, { desc = "Stage hunk" })
    map("n", "<leader>gr", gs.reset_hunk, { desc = "Reset hunk" })
    map("v", "<leader>gs", function() gs.stage_hunk({ vim.fn.line("."), vim.fn.line("v") }) end, { desc = "Stage hunk" })
    map("v", "<leader>gr", function() gs.reset_hunk({ vim.fn.line("."), vim.fn.line("v") }) end, { desc = "Reset hunk" })
    map("n", "<leader>gS", gs.stage_buffer, { desc = "Stage buffer" })
    map("n", "<leader>gu", gs.undo_stage_hunk, { desc = "Undo stage hunk" })
    map("n", "<leader>gR", gs.reset_buffer, { desc = "Reset buffer" })
    map("n", "<leader>gp", gs.preview_hunk, { desc = "Preview hunk" })
    map("n", "<leader>gb", function() gs.blame_line({ full = true }) end, { desc = "Blame line" })
    map("n", "<leader>gtb", gs.toggle_current_line_blame, { desc = "Toggle line blame" })
    map("n", "<leader>gtd", gs.toggle_deleted, { desc = "Toggle deleted" })

    -- Text object
    map({ "o", "x" }, "ih", ":<C-U>Gitsigns select_hunk<CR>", { desc = "Select hunk" })
  end,
})

-- GitLinker
require("gitlinker").setup({ mappings = nil })
vim.keymap.set("n", "<leader>gy", function() require("gitlinker").get_buf_range_url("n") end, { desc = "Copy git link" })
vim.keymap.set("v", "<leader>gy", function() require("gitlinker").get_buf_range_url("v") end, { desc = "Copy git link (selection)" })
vim.keymap.set("n", "<leader>gY", function() require("gitlinker").get_buf_range_url("n", { action_callback = require("gitlinker.actions").open_in_browser }) end, { desc = "Open git link in browser" })

-- Resolve
require("resolve").setup({
  markers = {
    ours = "^<<<<<<<+",
    theirs = "^>>>>>>>+",
    ancestor = "^|||||||+",
    separator = "^=======+$",
  },
  default_keymaps = true,
})

-- CodeDiff
require("codediff").setup({
  diff = {
    disable_inlay_hints = true,
    original_position = "left",
  },
  explorer = {
    position = "left",
    width = 35,
    icons = {
      folder_closed = "",
      folder_open = "",
    },
  },
  keymaps = {
    view = {
      quit = "q",
      toggle_explorer = "<tab>",
      next_hunk = "]c",
      prev_hunk = "[c",
      next_file = "]f",
      prev_file = "[f",
    },
    conflict = {
      accept_incoming = "<leader>Gt",
      accept_current = "<leader>Go",
      accept_both = "<leader>Ga",
      discard = "<leader>Gd",
      next_conflict = "]x",
      prev_conflict = "[x",
    },
  },
})
vim.keymap.set("n", "<leader>gd", "<cmd>CodeDiff<cr>", { desc = "Git status diff" })
vim.keymap.set("n", "<leader>gf", "<cmd>CodeDiff file HEAD<cr>", { desc = "File diff vs HEAD" })
vim.keymap.set("n", "<leader>gF", "<cmd>CodeDiff HEAD~10<cr>", { desc = "Recent commits diff" })
