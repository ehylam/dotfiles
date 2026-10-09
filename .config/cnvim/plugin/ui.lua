vim.pack.add({
  "https://github.com/nvim-lualine/lualine.nvim",
  "https://github.com/nvim-tree/nvim-web-devicons",
  "https://github.com/akinsho/bufferline.nvim",
  "https://github.com/brenoprata10/nvim-highlight-colors",
  "https://github.com/folke/which-key.nvim",
  "https://github.com/itchyny/vim-highlighturl",
  "https://github.com/iamcco/markdown-preview.nvim",
  "https://github.com/vuki656/package-info.nvim",
  "https://github.com/MunifTanjim/nui.nvim",
})

-- Lualine
require("lualine").setup({
  options = {
    icons_enabled = true,
    theme = "auto",
    component_separators = { left = "", right = "" },
    section_separators = { left = "", right = "" },
    disabled_filetypes = {
      statusline = { "dashboard", "snacks_dashboard" },
      winbar = {},
    },
    always_divide_middle = true,
    globalstatus = true,
  },
  sections = {
    lualine_a = { "mode" },
    lualine_b = { "branch", "diff", "diagnostics" },
    lualine_c = { { "filename", path = 1 } },
    lualine_x = { "encoding", "fileformat", "filetype" },
    lualine_y = { "progress" },
    lualine_z = { "location" },
  },
  inactive_sections = {
    lualine_a = {},
    lualine_b = {},
    lualine_c = { "filename" },
    lualine_x = { "location" },
    lualine_y = {},
    lualine_z = {},
  },
})

-- Bufferline
require("bufferline").setup({
  options = {
    diagnostics = "nvim_lsp",
    diagnostics_indicator = function(count, level)
      local icon = level:match("error") and " " or " "
      return " " .. icon .. count
    end,
    separator_style = "slant",
    show_buffer_close_icons = false,
    show_close_icon = false,
    enforce_regular_tabs = true,
    always_show_bufferline = true,
    offsets = {
      {
        filetype = "snacks_layout_box",
        text = "Internet Explorer 11",
        highlight = "Directory",
        text_align = "left",
      },
    },
  },
})

local map = vim.keymap.set
map("n", "<leader>bp", "<cmd>BufferLineTogglePin<cr>", { desc = "Toggle pin" })
map("n", "<leader>bP", "<cmd>BufferLineGroupClose ungrouped<cr>", { desc = "Delete non-pinned buffers" })
map("n", "<leader>bo", "<cmd>BufferLineCloseOthers<cr>", { desc = "Delete other buffers" })
map("n", "<leader>br", "<cmd>BufferLineCloseRight<cr>", { desc = "Delete buffers to right" })
map("n", "<leader>bl", "<cmd>BufferLineCloseLeft<cr>", { desc = "Delete buffers to left" })
map("n", "<S-h>", "<cmd>BufferLineCyclePrev<cr>", { desc = "Previous buffer" })
map("n", "<S-l>", "<cmd>BufferLineCycleNext<cr>", { desc = "Next buffer" })
map("n", "[b", "<cmd>BufferLineCyclePrev<cr>", { desc = "Previous buffer" })
map("n", "]b", "<cmd>BufferLineCycleNext<cr>", { desc = "Next buffer" })
map("n", "[B", "<cmd>BufferLineMovePrev<cr>", { desc = "Move buffer prev" })
map("n", "]B", "<cmd>BufferLineMoveNext<cr>", { desc = "Move buffer next" })

-- Highlight Colors
require("nvim-highlight-colors").setup({
  render = "virtual",
  virtual_symbol = "●",
  enable_named_colors = false,
  enable_tailwind = true,
})

-- Which-key
require("which-key").setup({
  preset = "helix",
  delay = 300,
  icons = {
    breadcrumb = "»",
    separator = "➜",
    group = "+",
  },
  spec = {
    { "<leader>a", group = "ai" },
    { "<leader>b", group = "buffer" },
    { "<leader>c", group = "code" },
    { "<leader>d", group = "debug" },
    { "<leader>f", group = "file/find" },
    { "<leader>g", group = "git" },
    { "<leader>gc", group = "conflict" },
    { "<leader>h", group = "hints" },
    { "<leader>n", group = "npm" },
    { "<leader>s", group = "search" },
    { "<leader>t", group = "todo" },
    { "<leader>u", group = "ui/toggle" },
    { "<leader>w", group = "window" },
    { "<leader>x", group = "diagnostics" },
    { "g", group = "goto" },
    { "[", group = "prev" },
    { "]", group = "next" },
  },
})

-- Markdown Preview
map("n", "<leader>cp", "<cmd>MarkdownPreviewToggle<cr>", { desc = "Markdown preview" })

-- Package Info
require("package-info").setup({
  highlights = {
    up_to_date = { fg = "#3C4048" },
    outdated = { fg = "#d19a66" },
  },
  hide_up_to_date = true,
  hide_unstable_versions = true,
})
map("n", "<leader>ns", function() require("package-info").show() end, { desc = "Show package versions" })
map("n", "<leader>nh", function() require("package-info").hide() end, { desc = "Hide package versions" })
map("n", "<leader>nu", function() require("package-info").update() end, { desc = "Update package" })
map("n", "<leader>nd", function() require("package-info").delete() end, { desc = "Delete package" })
map("n", "<leader>ni", function() require("package-info").install() end, { desc = "Install package" })
map("n", "<leader>nc", function() require("package-info").change_version() end, { desc = "Change version" })
