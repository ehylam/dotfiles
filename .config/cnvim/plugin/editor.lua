vim.pack.add({
  "https://github.com/folke/flash.nvim",
  "https://github.com/johnpmitsch/vai.nvim",
  "https://github.com/nvim-lua/plenary.nvim",
  "https://github.com/folke/trouble.nvim",
  "https://github.com/OlegGulevskyy/better-ts-errors.nvim",
  "https://github.com/MunifTanjim/nui.nvim",
  "https://github.com/MagicDuck/grug-far.nvim",
  "https://github.com/stevearc/quicker.nvim",
  "https://github.com/gbprod/yanky.nvim",
  "https://github.com/Bekaboo/dropbar.nvim",
})

local map = vim.keymap.set

-- Flash
require("flash").setup({})
map({ "n", "x", "o" }, "s", function() require("flash").jump() end, { desc = "Flash" })
map({ "n", "x", "o" }, "S", function() require("flash").treesitter() end, { desc = "Flash Treesitter" })
map("o", "r", function() require("flash").remote() end, { desc = "Remote Flash" })
map({ "o", "x" }, "R", function() require("flash").treesitter_search() end, { desc = "Treesitter Search" })
map("c", "<c-s>", function() require("flash").toggle() end, { desc = "Toggle Flash Search" })

-- Vai
require("vai").setup({})
map("n", "\\", function() require("vai").jump() end, { desc = "Vai jump" })

-- Trouble
require("trouble").setup({ focus = true })
map("n", "<leader>xx", "<cmd>Trouble diagnostics toggle<cr>", { desc = "Diagnostics (Trouble)" })
map("n", "<leader>xX", "<cmd>Trouble diagnostics toggle filter.buf=0<cr>", { desc = "Buffer Diagnostics (Trouble)" })
map("n", "<leader>cs", "<cmd>Trouble symbols toggle focus=false<cr>", { desc = "Symbols (Trouble)" })
map("n", "<leader>cl", "<cmd>Trouble lsp toggle focus=false win.position=right<cr>", { desc = "LSP (Trouble)" })
map("n", "<leader>xL", "<cmd>Trouble loclist toggle<cr>", { desc = "Location List (Trouble)" })
map("n", "<leader>xQ", "<cmd>Trouble qflist toggle<cr>", { desc = "Quickfix List (Trouble)" })

-- Better TS Errors
require("better-ts-errors").setup({
  keymaps = {
    toggle = "<leader>xd",
    go_to_definition = "<leader>xp",
  },
})

-- Dropbar (deferred to avoid assertion on empty buffers)
vim.api.nvim_create_autocmd({ "BufReadPost", "BufNewFile" }, {
  once = true,
  callback = function()
    map("n", "<Leader>;", function() require("dropbar.api").pick() end, { desc = "Pick symbols in winbar" })
    map("n", "[;", function() require("dropbar.api").goto_context_start() end, { desc = "Go to context start" })
    map("n", "];", function() require("dropbar.api").select_next_context() end, { desc = "Select next context" })
  end,
})

-- Move through editor splits first, then Herdr panes when available.
for key, cmd in pairs({ h = "Left", j = "Down", k = "Up", l = "Right" }) do
  map("n", "<C-" .. key .. ">", function()
    local herdr = require("config.herdr")
    if herdr.active() then
      return herdr.navigate(key)
    end
    vim.cmd.wincmd(key)
  end, { desc = "Navigate " .. cmd:lower() })
end

-- Grug-far
map("n", "<leader>sr", function() require("grug-far").open({ transient = true }) end, { desc = "Search and replace" })
map("n", "<leader>sR", function() require("grug-far").open({ transient = true, prefills = { paths = vim.fn.expand("%") } }) end, { desc = "Search and replace (current file)" })
map("v", "<leader>sr", function()
  require("grug-far").open({ transient = true, prefills = { search = vim.fn.getreg("v") } })
end, { desc = "Search and replace selection" })
require("grug-far").setup({
  headerHeight = 5,
  windowCreationCommand = "split",
})

-- Quicker
require("quicker").setup({
  keys = {
    { ">", function() require("quicker").expand({ before = 2, after = 2, add_to_existing = true }) end, desc = "Expand context" },
    { "<", function() require("quicker").collapse() end, desc = "Collapse context" },
  },
})
map("n", "<leader>xq", function() require("quicker").toggle() end, { desc = "Toggle quickfix" })
map("n", "<leader>xl", function() require("quicker").toggle({ loclist = true }) end, { desc = "Toggle loclist" })

-- Yanky
require("yanky").setup({
  ring = {
    history_length = 100,
    sync_with_numbered_registers = true,
  },
  highlight = {
    on_put = true,
    on_yank = true,
    timer = 200,
  },
})
map({ "n", "x" }, "y", "<Plug>(YankyYank)", { desc = "Yank text" })
map("n", "[y", "<Plug>(YankyCycleForward)", { desc = "Cycle yank forward" })
map("n", "]y", "<Plug>(YankyCycleBackward)", { desc = "Cycle yank backward" })
map("n", "<leader>sy", function() require("fzf-lua").registers() end, { desc = "Yank history" })
