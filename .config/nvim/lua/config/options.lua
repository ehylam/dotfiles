-- Core Neovim options (previously provided by LazyVim defaults + custom overrides)

vim.opt.autowrite = true
vim.opt.clipboard = vim.env.SSH_TTY and "" or "unnamedplus"
-- Native completion (Neovim 0.12+); see plugin/completion.lua for vim.lsp.completion
vim.o.complete = ".,o" -- sources: current buffer (.) + omnifunc/LSP (o)
vim.o.completeopt = "fuzzy,menuone,noselect" -- add "popup" to show item docs inline
vim.o.autocomplete = true -- auto-trigger completion while typing
vim.o.pumheight = 7 -- max visible completion items
vim.opt.conceallevel = 0 -- don't hide my json strings
vim.opt.confirm = true
vim.opt.cursorline = true
vim.opt.expandtab = true
vim.opt.fillchars = {
  foldopen = " ",
  foldclose = " ",
  fold = " ",
  foldsep = " ",
  diff = "╱",
  eob = " ",
}
vim.opt.foldlevel = 99
vim.opt.grepformat = "%f:%l:%c:%m"
vim.opt.grepprg = "rg --vimgrep"
vim.opt.ignorecase = true
vim.opt.inccommand = "nosplit"
vim.opt.jumpoptions = "view"
vim.opt.laststatus = 3
vim.opt.linebreak = true
vim.opt.list = true
vim.opt.mouse = "a"
vim.opt.number = true
vim.opt.pumblend = 10
vim.opt.relativenumber = true
vim.opt.ruler = false
vim.opt.scrolloff = 15
vim.opt.sessionoptions = { "buffers", "curdir", "tabpages", "winsize", "help", "globals", "skiprtp", "folds" }
vim.opt.shiftround = true
vim.opt.shiftwidth = 2
vim.opt.shortmess:append({ W = true, I = true, c = true, C = true })
vim.opt.showmode = false
vim.opt.sidescrolloff = 8
vim.opt.signcolumn = "yes"
vim.opt.smartcase = true
vim.opt.smartindent = true
vim.opt.smoothscroll = true
vim.opt.splitbelow = true
vim.opt.splitkeep = "screen"
vim.opt.splitright = true
vim.opt.tabstop = 2
vim.opt.termguicolors = true
vim.opt.undofile = true
vim.opt.undolevels = 10000
vim.opt.updatetime = 200
vim.opt.virtualedit = "block"
vim.opt.wildmode = "longest:full,full"
vim.opt.winminwidth = 5
vim.opt.wrap = false
