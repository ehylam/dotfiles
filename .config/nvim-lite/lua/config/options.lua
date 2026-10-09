-- Leader keys (must be set before plugins load)
vim.g.mapleader = " "
vim.g.maplocalleader = " "

-- Disable netrw (using snacks explorer)
vim.g.loaded_netrw = 1
vim.g.loaded_netrwPlugin = 1

-- UI
vim.opt.termguicolors = true
vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.signcolumn = "yes"
vim.opt.cursorline = true
vim.opt.cursorlineopt = "number"
vim.opt.showmode = false
vim.opt.laststatus = 3
vim.opt.pumheight = 7

-- Indentation
vim.opt.expandtab = true
vim.opt.tabstop = 2
vim.opt.shiftwidth = 2
vim.opt.smartindent = true

-- Search
vim.opt.ignorecase = true
vim.opt.smartcase = true
vim.opt.inccommand = "split"

-- Files
vim.opt.undofile = true
vim.opt.swapfile = false
vim.opt.autowrite = true
vim.opt.autoread = true

-- Scrolling
vim.opt.scrolloff = 8
vim.opt.sidescrolloff = 8

-- Splits
vim.opt.splitbelow = true
vim.opt.splitright = true

-- Clipboard (scheduled for performance)
vim.schedule(function()
  vim.opt.clipboard = "unnamedplus"
end)

-- Completion (native, Neovim 0.12+ — see lua/config/lsp.lua for vim.lsp.completion)
vim.o.complete = ".,o"                       -- sources: current buffer (.) + omnifunc/LSP (o)
vim.o.completeopt = "fuzzy,menuone,noselect" -- add "popup" to show item docs inline
vim.o.autocomplete = true                    -- auto-trigger completion while typing

-- Timing
vim.opt.updatetime = 300
vim.opt.timeoutlen = 500

-- Wrapping
vim.opt.wrap = false

-- Borders
vim.g.border_style = "rounded"
vim.o.winborder = "rounded"

-- Mouse
vim.opt.mouse = "a"

-- Folding (treesitter-based)
vim.opt.foldenable = true
vim.opt.foldlevel = 99
vim.opt.foldmethod = "expr"
vim.opt.foldexpr = "v:lua.vim.treesitter.foldexpr()"

-- Fill characters
vim.opt.fillchars = {
  eob = " ",
  fold = " ",
  foldopen = "v",
  foldclose = ">",
}

-- Snacks animation (disabled for speed)
vim.g.snacks_animate = false
