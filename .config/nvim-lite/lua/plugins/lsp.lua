return {
  -- Mason: LSP installer
  {
    "williamboman/mason.nvim",
    lazy = false,
    cmd = { "Mason", "MasonInstallConfigured" },
    build = ":MasonUpdate",
    opts = {
      ui = { border = "rounded" },
      ensure_installed = {
        "lua-language-server",
        "typescript-language-server",
        "json-lsp",
        "html-lsp",
        "css-lsp",
        "prettier",
        "stylua",
      },
    },
    config = function(_, opts)
      require("mason").setup(opts)
      local mr = require("mason-registry")
      local function install_configured_mason_tools()
        for _, tool in ipairs(opts.ensure_installed or {}) do
          local p = mr.get_package(tool)
          if not p:is_installed() then
            p:install()
          end
        end
      end
      vim.api.nvim_create_user_command("MasonInstallConfigured", function()
        mr.refresh(install_configured_mason_tools)
      end, { desc = "Install configured Mason tools" })
    end,
  },

  -- Lazydev: Lua LSP helper
  {
    "folke/lazydev.nvim",
    ft = "lua",
    opts = {
      library = {
        { path = "${3rd}/luv/library", words = { "vim%.uv" } },
      },
    },
  },
}
