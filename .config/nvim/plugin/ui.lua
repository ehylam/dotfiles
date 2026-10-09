vim.pack.add({
  "https://github.com/folke/which-key.nvim",
  "https://github.com/folke/noice.nvim",
  "https://github.com/MunifTanjim/nui.nvim",
  "https://github.com/NvChad/nvim-colorizer.lua",
  "https://github.com/folke/todo-comments.nvim",
  "https://github.com/nvim-lua/plenary.nvim",
  "https://github.com/rachartier/tiny-inline-diagnostic.nvim",
  "https://github.com/nvim-lualine/lualine.nvim",
  "https://github.com/folke/ts-comments.nvim",
  "https://github.com/FabijanZulj/blame.nvim",
  "https://github.com/Bekaboo/dropbar.nvim",
  { src = "https://github.com/nvim-telescope/telescope-fzf-native.nvim", name = "telescope-fzf-native.nvim" },
  "https://github.com/onsails/lspkind-nvim",
  "https://github.com/nvim-mini/mini.icons",
})

-- which-key
require("which-key").setup({
  preset = "helix",
  win = {},
  spec = {
    { "<leader>a", group = "ai" },
  },
})

-- noice
require("noice").setup({
  lsp = {
    override = {
      ["vim.lsp.util.convert_input_to_markdown_lines"] = true,
      ["vim.lsp.util.stylize_markdown"] = true,
      ["cmp.entry.get_documentation"] = true,
    },
  },
  presets = {
    bottom_search = true,
    command_palette = true,
    long_message_to_split = true,
    inc_rename = false,
    lsp_doc_border = false,
  },
  routes = {
    {
      filter = {
        event = "notify",
        find = "No information available",
      },
      opts = { skip = true },
    },
  },
})

-- Focus tracking for noice
local focused = true
vim.api.nvim_create_autocmd("FocusGained", {
  callback = function()
    focused = true
  end,
})
vim.api.nvim_create_autocmd("FocusLost", {
  callback = function()
    focused = false
  end,
})
vim.api.nvim_create_autocmd("FileType", {
  pattern = "markdown",
  callback = function(event)
    vim.schedule(function()
      require("noice.text.markdown").keys(event.buf)
    end)
  end,
})

-- colorizer
require("colorizer").setup({})

-- todo-comments
require("todo-comments").setup({})

-- tiny-inline-diagnostic
require("tiny-inline-diagnostic").setup({
  multilines = {
    enabled = true,
  },
})
vim.diagnostic.config({ virtual_text = false })

-- ts-comments
require("ts-comments").setup({})

-- blame
require("blame").setup()

-- dropbar (deferred to avoid assertion on empty buffers)
vim.api.nvim_create_autocmd({ "BufReadPost", "BufNewFile" }, {
  once = true,
  callback = function()
    local dropbar_api = require("dropbar.api")
    vim.keymap.set("n", "<Leader>;", dropbar_api.pick, { desc = "Pick symbols in winbar" })
    vim.keymap.set("n", "[;", dropbar_api.goto_context_start, { desc = "Go to start of current context" })
    vim.keymap.set("n", "];", dropbar_api.select_next_context, { desc = "Select next context" })
  end,
})

-- mini.icons
require("mini.icons").setup({
  file = {
    [".eslintrc.js"] = { glyph = "󰱺", hl = "MiniIconsYellow" },
    [".node-version"] = { glyph = "", hl = "MiniIconsGreen" },
    [".prettierrc"] = { glyph = "", hl = "MiniIconsPurple" },
    [".yarnrc.yml"] = { glyph = "", hl = "MiniIconsBlue" },
    ["eslint.config.js"] = { glyph = "󰱺", hl = "MiniIconsYellow" },
    ["package.json"] = { glyph = "", hl = "MiniIconsGreen" },
    ["tsconfig.json"] = { glyph = "", hl = "MiniIconsAzure" },
    ["tsconfig.build.json"] = { glyph = "", hl = "MiniIconsAzure" },
    ["yarn.lock"] = { glyph = "", hl = "MiniIconsBlue" },
  },
})

-- Lualine (eviline config)
local lualine = require("lualine")

-- Cache LSP name per buffer
vim.api.nvim_create_autocmd({ "LspAttach", "LspDetach", "BufEnter" }, {
  callback = function(args)
    local bufnr = args.buf
    local buf_ft = vim.api.nvim_get_option_value("filetype", { buf = bufnr })
    for _, client in ipairs(vim.lsp.get_clients({ bufnr = bufnr })) do
      local filetypes = client.config.filetypes
      if filetypes and vim.tbl_contains(filetypes, buf_ft) then
        vim.b[bufnr].lsp_name_cached = client.name
        return
      end
    end
    vim.b[bufnr].lsp_name_cached = nil
  end,
})

-- stylua: ignore
local colors = {
  bg       = '#202328',
  fg       = '#bbc2cf',
  yellow   = '#ECBE7B',
  cyan     = '#008080',
  darkblue = '#081633',
  green    = '#98be65',
  orange   = '#FF8800',
  violet   = '#a9a1e1',
  magenta  = '#c678dd',
  blue     = '#51afef',
  red      = '#ec5f67',
}

local conditions = {
  buffer_not_empty = function()
    return vim.fn.empty(vim.fn.expand("%:t")) ~= 1
  end,
  hide_in_width = function()
    return vim.fn.winwidth(0) > 80
  end,
  check_git_workspace = function()
    local filepath = vim.fn.expand("%:p:h")
    local gitdir = vim.fn.finddir(".git", filepath .. ";")
    return gitdir and #gitdir > 0 and #gitdir < #filepath
  end,
}

local config = {
  options = {
    component_separators = "",
    section_separators = "",
    theme = {
      normal = { c = { fg = colors.fg, bg = colors.bg } },
      inactive = { c = { fg = colors.fg, bg = colors.bg } },
    },
  },
  sections = {
    lualine_a = {},
    lualine_b = {},
    lualine_y = {},
    lualine_z = {},
    lualine_c = {},
    lualine_x = {},
  },
  inactive_sections = {
    lualine_a = {},
    lualine_b = {},
    lualine_y = {},
    lualine_z = {},
    lualine_c = {},
    lualine_x = {},
  },
}

local function ins_left(component)
  table.insert(config.sections.lualine_c, component)
end

local function ins_right(component)
  table.insert(config.sections.lualine_x, component)
end

ins_left({
  function() return "▊" end,
  color = { fg = colors.blue },
  padding = { left = 0, right = 1 },
})

ins_left({
  function() return "" end,
  color = function()
    local mode_color = {
      n = colors.red, i = colors.green, v = colors.blue,
      [""] = colors.blue, V = colors.blue, c = colors.magenta,
      no = colors.red, s = colors.orange, S = colors.orange,
      [""] = colors.orange, ic = colors.yellow, R = colors.violet,
      Rv = colors.violet, cv = colors.red, ce = colors.red,
      r = colors.cyan, rm = colors.cyan, ["r?"] = colors.cyan,
      ["!"] = colors.red, t = colors.red,
    }
    return { fg = mode_color[vim.fn.mode()] }
  end,
  padding = { right = 1 },
})

ins_left({ "filesize", cond = conditions.buffer_not_empty })
ins_left({ "filename", cond = conditions.buffer_not_empty, color = { fg = colors.magenta, gui = "bold" } })
ins_left({ "location" })
ins_left({ "progress", color = { fg = colors.fg, gui = "bold" } })
ins_left({
  "diagnostics",
  sources = { "nvim_diagnostic" },
  symbols = { error = " ", warn = " ", info = " " },
  diagnostics_color = {
    error = { fg = colors.red },
    warn = { fg = colors.yellow },
    info = { fg = colors.cyan },
  },
})
ins_left({ function() return "%=" end })
ins_left({
  function() return vim.b.lsp_name_cached or "No Active Lsp" end,
  icon = " LSP:",
  color = { fg = "#ffffff", gui = "bold" },
})

ins_right({ "o:encoding", fmt = string.upper, cond = conditions.hide_in_width, color = { fg = colors.green, gui = "bold" } })
ins_right({ "fileformat", fmt = string.upper, icons_enabled = false, color = { fg = colors.green, gui = "bold" } })
ins_right({ "branch", icon = "", color = { fg = colors.violet, gui = "bold" } })
ins_right({
  "diff",
  symbols = { added = " ", modified = "󰝤 ", removed = " " },
  diff_color = {
    added = { fg = colors.green },
    modified = { fg = colors.orange },
    removed = { fg = colors.red },
  },
  cond = conditions.hide_in_width,
})
ins_right({ function() return "▊" end, color = { fg = colors.blue }, padding = { left = 1 } })

lualine.setup(config)
