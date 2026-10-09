-- Leader keys (must be set before plugins load)
vim.g.mapleader = " "
vim.g.maplocalleader = " "

-- Disable netrw: snacks.explorer (<leader>e) and yazi.nvim (<leader>-) replace it
vim.g.loaded_netrw = 1
vim.g.loaded_netrwPlugin = 1

-- UI
vim.opt.termguicolors = true
vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.signcolumn = "yes"
vim.opt.statuscolumn = "%s%=%{v:virtnum < 1 ? (v:relnum ? v:relnum : v:lnum < 10 ? v:lnum . '  ' : v:lnum) : ''}%="
vim.opt.cursorline = true
vim.opt.cursorlineopt = "number"
vim.opt.showmode = false
vim.opt.laststatus = 3 -- Global statusline
vim.opt.cmdheight = 1
vim.opt.pumheight = 7
vim.opt.pumblend = 0
vim.opt.conceallevel = 0
vim.opt.showtabline = 2

-- Indentation
vim.opt.expandtab = true
vim.opt.tabstop = 2
vim.opt.shiftwidth = 2
vim.opt.softtabstop = 2
vim.opt.smartindent = true
vim.opt.breakindent = true

-- Wrapping
vim.opt.wrap = false
vim.opt.linebreak = true -- Wrap at word boundaries when wrap is on

-- Search
vim.opt.ignorecase = true
vim.opt.smartcase = true
vim.opt.inccommand = "split"

-- Files
vim.opt.undofile = true
vim.opt.swapfile = false
vim.opt.autowrite = true
vim.opt.autoread = true
vim.opt.confirm = true

-- Scrolling
vim.opt.scrolloff = 8
vim.opt.sidescrolloff = 8

-- Splits
vim.opt.splitbelow = true
vim.opt.splitright = true
vim.opt.splitkeep = "screen"

-- Clipboard (scheduled for performance)
vim.schedule(function()
	vim.opt.clipboard = "unnamedplus"
end)

-- Completion (native, Neovim 0.12+ — see lua/config/lsp.lua for vim.lsp.completion)
vim.o.complete = ".,o" -- sources: current buffer (.) + omnifunc/LSP (o)
vim.o.completeopt = "fuzzy,menuone,noselect" -- add "popup" to show item docs inline
vim.o.autocomplete = true -- auto-trigger completion while typing

-- Timing
vim.opt.updatetime = 300
vim.opt.timeoutlen = 500
vim.opt.ttimeoutlen = 10

-- Performance
vim.opt.lazyredraw = false -- Don't set true - breaks with noice/notifications
vim.opt.synmaxcol = 300 -- Only highlight first 300 columns (long lines)
vim.opt.redrawtime = 1500 -- Time for syntax highlighting (ms) before giving up

-- Misc
vim.opt.shortmess:append({ W = true, I = true, c = true, C = true })
vim.opt.jumpoptions = "stack,view"
vim.opt.mouse = "a"

-- List characters (prettier whitespace display)
vim.opt.list = true
vim.opt.listchars = {
	tab = "  ↦", -- Spaced tab with arrow
	trail = "⋅", -- Dot for trailing spaces
	extends = "›",
	precedes = "‹",
	nbsp = "␣",
	space = " ", -- Normal spaces not shown (set to "⋅" to show all)
}

-- Wildmenu
vim.opt.wildmode = "longest:full,full"
vim.opt.wildignore:append({ ".DS_Store" })

-- Folding. Treesitter folding is enabled per filetype in config/autocmds.lua.
vim.opt.foldenable = true
vim.opt.foldlevel = 99
vim.opt.foldmethod = "manual"
vim.opt.foldexpr = ""
vim.opt.foldtext = ""
vim.opt.foldcolumn = "0"

-- Fill characters (cleaner)
vim.opt.fillchars = {
	foldopen = "▾",
	foldclose = "▸",
	fold = " ",
	foldsep = " ",
	diff = "╱",
	eob = " ",
	msgsep = "─", -- Horizontal line between messages
}

-- Borders
vim.g.border_style = "rounded"
vim.o.winborder = "rounded"
vim.o.pumblend = 0 -- No transparency for popup menu

-- pumborder (Neovim 0.11+ feature, may not be in all builds)
pcall(function()
	vim.o.pumborder = "rounded"
end)

-- Diff mode
vim.opt.diffopt:append({ "vertical", "context:99" })

-- Snacks
vim.g.snacks_animate = false

-- TMUX navigator
vim.g.tmux_navigator_no_mappings = 1

-- Cursor shapes per mode
vim.opt.guicursor = {
	"n-v-c:block", -- Block in normal, visual, command
	"i-ci-ve:ver25", -- Thin vertical bar in insert
	"r-cr:hor20", -- Horizontal bar in replace
	"o:hor50", -- Half-height bar in operator-pending
	"a:blinkwait700-blinkoff400-blinkon250", -- Blinking settings
	"sm:block-blinkwait175-blinkoff150-blinkon175", -- Showmatch
}

-- Global flags
vim.g.ai_cmp = false
vim.g.inlay_hints = false -- Toggle with keybind
