vim.pack.add({
  "https://github.com/folke/tokyonight.nvim",
  "https://github.com/EdenEast/nightfox.nvim",
  { src = "https://github.com/catppuccin/nvim", name = "catppuccin" },
  "https://github.com/rebelot/kanagawa.nvim",
  { src = "https://github.com/embark-theme/vim", name = "embark" },
  "https://github.com/AlexvZyl/nordic.nvim",
  "https://github.com/dgox16/oldworld.nvim",
  "https://github.com/sainnhe/everforest",
  "https://github.com/maxmx03/fluoromachine.nvim",
  "https://github.com/tiagovla/tokyodark.nvim",
})

-- Theme rotation system
local themes = {
  "tokyonight",
  "nightfox",
  "catppuccin-frappe",
  "everforest",
  "kanagawa",
  "embark",
  "nordic",
  "oldworld",
  "fluoromachine",
  "tokyodark",
}

local transparent = true
local idx = 1
local theme_name = themes[idx]
local theme_base = theme_name:gsub("%-.*$", "")

if theme_name == "catppuccin-frappe" then
  theme_base = "catppuccin"
end

-- Theme-specific setup
if theme_base == "tokyonight" then
  require("tokyonight").setup({
    style = (idx % 2 == 1) and "moon" or "night",
    transparent = transparent,
    styles = transparent and {
      sidebars = "transparent",
      floats = "transparent",
    } or {},
  })
elseif theme_base == "nightfox" then
  require("nightfox").setup({
    options = {
      transparent = transparent,
      styles = transparent and {
        comments = "italic",
        keywords = "bold",
        types = "italic,bold",
      } or {},
    },
  })
elseif theme_base == "catppuccin" then
  require("catppuccin").setup({
    transparent_background = transparent,
    flavour = "frappe",
  })
elseif theme_base == "kanagawa" then
  require("kanagawa").setup({
    theme = (idx % 2 == 1) and "wave" or "dragon",
  })
elseif theme_base == "everforest" then
  vim.g.everforest_background = "medium"
  vim.g.everforest_transparent_background = transparent and 1 or 0
  vim.g.everforest_better_performance = 1
  vim.g.everforest_enable_italic = 1
elseif theme_base == "fluoromachine" then
  require("fluoromachine").setup({
    glow = true,
    theme = (idx % 2 == 1) and "retrowave" or "fluoromachine",
    transparent = transparent,
  })
elseif theme_base == "tokyodark" then
  require("tokyodark").setup({})
elseif theme_base == "nordic" then
  require("nordic").load({})
end

vim.cmd.colorscheme(theme_base)

-- User commands
vim.api.nvim_create_user_command("RandomTheme", function()
  math.randomseed(os.time())
  local new_idx = math.random(#themes)
  local new_theme = themes[new_idx]
  local new_base = new_theme:gsub("%-.*$", "")
  if new_theme == "catppuccin-frappe" then
    new_base = "catppuccin"
  end
  vim.cmd.colorscheme(new_base)
  vim.notify("Theme switched to: " .. new_theme, vim.log.levels.INFO)
end, {})

vim.api.nvim_create_user_command("ListThemes", function()
  vim.notify("Available themes: " .. table.concat(themes, ", "), vim.log.levels.INFO)
end, {})
