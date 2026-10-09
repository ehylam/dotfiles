return {
  {
    "nvim-treesitter/nvim-treesitter",
    build = ":TSUpdate",
    event = { "BufReadPre", "BufNewFile" },
    cmd = { "TSInstall", "TSUpdate", "TSUpdateSync" },
    config = function()
      local ok, treesitter = pcall(require, "nvim-treesitter")
      if not ok then
        vim.notify("Treesitter not ready - run :Lazy sync", vim.log.levels.WARN)
        return
      end

      local parser_languages = {
        "lua", "vim", "vimdoc",
        "javascript", "typescript", "tsx",
        "html", "css", "json", "latex",
        "bash", "yaml", "toml",
        "markdown", "markdown_inline",
        "diff", "gitcommit",
      }

      treesitter.setup()

      vim.api.nvim_create_user_command("TSInstallConfigured", function()
        treesitter.install(parser_languages):wait(300000)
      end, { desc = "Install configured Treesitter parsers" })

      vim.api.nvim_create_user_command("TSUpdateConfigured", function()
        treesitter.update(parser_languages):wait(300000)
      end, { desc = "Update configured Treesitter parsers" })
    end,
  },
}
