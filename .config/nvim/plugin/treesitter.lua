vim.pack.add({
  { src = "https://github.com/nvim-treesitter/nvim-treesitter", version = "main" },
  "https://github.com/windwp/nvim-ts-autotag",
})

local treesitter = require("nvim-treesitter")

local parser_languages = {
  "bash",
  "css",
  "html",
  "javascript",
  "json",
  "latex",
  "lua",
  "luadoc",
  "markdown",
  "markdown_inline",
  "query",
  "regex",
  "rust",
  "toml",
  "tsx",
  "typescript",
  "vim",
  "vimdoc",
  "yaml",
}

treesitter.setup()

local treesitter_disabled_filetypes = {
  markdown = true,
}

-- Start treesitter highlighting per buffer. On the `main` branch, setup() does
-- NOT enable highlighting; vim.treesitter.start() must be called per buffer.
vim.api.nvim_create_autocmd("FileType", {
  group = vim.api.nvim_create_augroup("treesitter-highlight", { clear = true }),
  callback = function(ev)
    if treesitter_disabled_filetypes[vim.bo[ev.buf].filetype] then
      return
    end

    if pcall(vim.treesitter.start, ev.buf) then
      vim.bo[ev.buf].indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
    end
  end,
})

vim.api.nvim_create_user_command("TSInstallConfigured", function()
  treesitter.install(parser_languages):wait(300000)
end, { desc = "Install configured Treesitter parsers" })

vim.api.nvim_create_user_command("TSUpdateConfigured", function()
  treesitter.update(parser_languages):wait(300000)
end, { desc = "Update configured Treesitter parsers" })

require("nvim-ts-autotag").setup({})
