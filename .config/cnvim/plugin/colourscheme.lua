local themes = {
  { name = "catppuccin-mocha", plugin = "catppuccin" },
  { name = "everforest", plugin = "everforest" },
  { name = "kanagawa", plugin = "kanagawa" },
  { name = "rose-pine", plugin = "rose-pine" },
  { name = "tokyodark", plugin = "tokyodark" },
  { name = "onedark", plugin = "onedark" },
}

local selected = themes[1]

vim.pack.add({
  { src = "https://github.com/catppuccin/nvim", name = "catppuccin" },
  { src = "https://github.com/rose-pine/neovim", name = "rose-pine" },
  "https://github.com/sainnhe/everforest",
  "https://github.com/tiagovla/tokyodark.nvim",
  "https://github.com/rebelot/kanagawa.nvim",
  "https://github.com/navarasu/onedark.nvim",
})

-- Configure catppuccin
require("catppuccin").setup({
  flavour = "mocha",
  integrations = {
    flash = true,
    fzf = true,
    gitsigns = true,
    indent_blankline = { enabled = true },
    lsp_trouble = true,
    mason = true,
    mini = { enabled = true },
    native_lsp = {
      enabled = true,
      underlines = {
        errors = { "undercurl" },
        hints = { "undercurl" },
        warnings = { "undercurl" },
        information = { "undercurl" },
      },
    },
    notify = true,
    treesitter = true,
    which_key = true,
  },
})

-- Configure everforest
vim.g.everforest_background = "medium"
vim.g.everforest_better_performance = 1

-- Configure onedark
require("onedark").setup({ style = "deep" })

-- Apply selected colorscheme
vim.schedule(function()
  if selected.plugin == "onedark" then
    require("onedark").load()
  else
    pcall(vim.cmd.colorscheme, selected.name)
  end
  vim.notify("Colorscheme: " .. selected.name, vim.log.levels.INFO)
end)

vim.api.nvim_create_user_command("RandomTheme", function()
  math.randomseed(os.time())
  selected = themes[math.random(#themes)]
  if selected.plugin == "onedark" then
    require("onedark").load()
  else
    pcall(vim.cmd.colorscheme, selected.name)
  end
  vim.notify("Colorscheme: " .. selected.name, vim.log.levels.INFO)
end, {})
