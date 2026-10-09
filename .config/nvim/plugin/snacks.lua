vim.pack.add({
  "https://github.com/folke/snacks.nvim",
})

Snacks.setup({
  indent = { enabled = true },
  input = { enabled = true },
  notifier = { enabled = true },
  scope = { enabled = true },
  scroll = { enabled = true },
  statuscolumn = { enabled = false },
  toggle = {},
  words = { enabled = true },
  explorer = { enabled = true },
  picker = { enabled = true },
  lazygit = { enabled = true },
})

Snacks.input.enable()
vim.ui.select = Snacks.picker.select

-- stylua: ignore start
local keymap = vim.keymap.set

-- Smart find
keymap("n", "<leader><space>", function() Snacks.picker.smart() end, { desc = "Smart Find Files" })
keymap("n", "<leader>,", function() Snacks.picker.buffers() end, { desc = "Buffers" })
keymap("n", "<leader>/", function() Snacks.picker.grep() end, { desc = "Grep" })
keymap("n", "<leader>:", function() Snacks.picker.command_history() end, { desc = "Command History" })
keymap("n", "<leader>e", function() Snacks.explorer() end, { desc = "File Explorer" })

-- Find
keymap("n", "<leader>fb", function() Snacks.picker.buffers() end, { desc = "Buffers" })
keymap("n", "<leader>fc", function() Snacks.picker.files({ cwd = vim.fn.stdpath("config") }) end, { desc = "Find Config File" })
keymap("n", "<leader>ff", function() Snacks.picker.files() end, { desc = "Find Files" })
keymap("n", "<leader>fg", function() Snacks.picker.git_files() end, { desc = "Find Git Files" })
keymap("n", "<leader>fp", function() Snacks.picker.projects() end, { desc = "Projects" })
keymap("n", "<leader>fr", function() Snacks.picker.recent() end, { desc = "Recent" })

-- Git
keymap("n", "<leader>gb", function() Snacks.picker.git_branches() end, { desc = "Git Branches" })
keymap("n", "<leader>gl", function() Snacks.picker.git_log() end, { desc = "Git Log" })
keymap("n", "<leader>gL", function() Snacks.picker.git_log_line() end, { desc = "Git Log Line" })
keymap("n", "<leader>gs", function() Snacks.picker.git_status() end, { desc = "Git Status" })
keymap("n", "<leader>gS", function() Snacks.picker.git_stash() end, { desc = "Git Stash" })
keymap("n", "<leader>gd", function() Snacks.picker.git_diff() end, { desc = "Git Diff (Hunks)" })
keymap("n", "<leader>gf", function() Snacks.picker.git_log_file() end, { desc = "Git Log File" })

-- Grep/Search
keymap("n", "<leader>sb", function() Snacks.picker.lines() end, { desc = "Buffer Lines" })
keymap("n", "<leader>sB", function() Snacks.picker.grep_buffers() end, { desc = "Grep Open Buffers" })
keymap("n", "<leader>sg", function() Snacks.picker.grep() end, { desc = "Grep" })
keymap({ "n", "x" }, "<leader>sw", function() Snacks.picker.grep_word() end, { desc = "Visual selection or word" })

-- Search
keymap("n", '<leader>s"', function() Snacks.picker.registers() end, { desc = "Registers" })
keymap("n", "<leader>s/", function() Snacks.picker.search_history() end, { desc = "Search History" })
keymap("n", "<leader>sa", function() Snacks.picker.autocmds() end, { desc = "Autocmds" })
keymap("n", "<leader>sc", function() Snacks.picker.command_history() end, { desc = "Command History" })
keymap("n", "<leader>sC", function() Snacks.picker.commands() end, { desc = "Commands" })
keymap("n", "<leader>sd", function() Snacks.picker.diagnostics() end, { desc = "Diagnostics" })
keymap("n", "<leader>sD", function() Snacks.picker.diagnostics_buffer() end, { desc = "Buffer Diagnostics" })
keymap("n", "<leader>sh", function() Snacks.picker.help() end, { desc = "Help Pages" })
keymap("n", "<leader>sH", function() Snacks.picker.highlights() end, { desc = "Highlights" })
keymap("n", "<leader>si", function() Snacks.picker.icons() end, { desc = "Icons" })
keymap("n", "<leader>sj", function() Snacks.picker.jumps() end, { desc = "Jumps" })
keymap("n", "<leader>sk", function() Snacks.picker.keymaps() end, { desc = "Keymaps" })
keymap("n", "<leader>sl", function() Snacks.picker.loclist() end, { desc = "Location List" })
keymap("n", "<leader>sm", function() Snacks.picker.marks() end, { desc = "Marks" })
keymap("n", "<leader>sM", function() Snacks.picker.man() end, { desc = "Man Pages" })
keymap("n", "<leader>sq", function() Snacks.picker.qflist() end, { desc = "Quickfix List" })
keymap("n", "<leader>sR", function() Snacks.picker.resume() end, { desc = "Resume" })
keymap("n", "<leader>su", function() Snacks.picker.undo() end, { desc = "Undo History" })
keymap("n", "<leader>uC", function() Snacks.picker.colorschemes() end, { desc = "Colorschemes" })

-- LSP
keymap("n", "gd", function() Snacks.picker.lsp_definitions() end, { desc = "Goto Definition" })
keymap("n", "gD", function() Snacks.picker.lsp_declarations() end, { desc = "Goto Declaration" })
keymap("n", "gr", function() Snacks.picker.lsp_references() end, { nowait = true, desc = "References" })
keymap("n", "gI", function() Snacks.picker.lsp_implementations() end, { desc = "Goto Implementation" })
keymap("n", "gy", function() Snacks.picker.lsp_type_definitions() end, { desc = "Goto T[y]pe Definition" })
keymap("n", "<leader>ss", function() Snacks.picker.lsp_symbols() end, { desc = "LSP Symbols" })
keymap("n", "<leader>sS", function() Snacks.picker.lsp_workspace_symbols() end, { desc = "LSP Workspace Symbols" })

-- Notifications
keymap("n", "<leader>n", function()
  if Snacks.config.picker and Snacks.config.picker.enabled then
    Snacks.picker.notifications()
  else
    Snacks.notifier.show_history()
  end
end, { desc = "Notification History" })
keymap("n", "<leader>un", function() Snacks.notifier.hide() end, { desc = "Dismiss All Notifications" })
-- stylua: ignore end
