vim.pack.add({
  "https://github.com/williamboman/mason.nvim",
  "https://github.com/folke/lazydev.nvim",
  "https://github.com/kosayoda/nvim-lightbulb",
  "https://github.com/antosha417/nvim-lsp-file-operations",
  "https://github.com/nvim-lua/plenary.nvim",
  "https://github.com/pmizio/typescript-tools.nvim",
})

-- Mason
local mason_opts = {
  ui = {
    border = "rounded",
    icons = {
      package_installed = "✓",
      package_pending = "➜",
      package_uninstalled = "✗",
    },
  },
  ensure_installed = {
    "typescript-language-server",
    "tailwindcss-language-server",
    "css-lsp",
    "eslint-lsp",
    "emmet-language-server",
    "html-lsp",
    "json-lsp",
    "lua-language-server",
    "bash-language-server",
    "prettier",
    "stylua",
    "shfmt",
    "stylelint-lsp",
  },
}
require("mason").setup(mason_opts)

local mr = require("mason-registry")
local function install_configured_mason_tools()
  for _, tool in ipairs(mason_opts.ensure_installed or {}) do
    local p = mr.get_package(tool)
    if not p:is_installed() then
      p:install()
    end
  end
end

vim.api.nvim_create_user_command("MasonInstallConfigured", function()
  mr.refresh(install_configured_mason_tools)
end, { desc = "Install configured Mason tools" })

vim.keymap.set("n", "<leader>cm", "<cmd>Mason<cr>", { desc = "Mason" })
vim.keymap.set("n", "<leader>cI", "<cmd>MasonInstallConfigured<cr>", { desc = "Install configured Mason tools" })

-- Lazydev (Lua development)
require("lazydev").setup({
  library = {
    { path = "${3rd}/luv/library", words = { "vim%.uv" } },
  },
})

-- Lightbulb
require("nvim-lightbulb").setup({
  autocmd = { enabled = true },
  sign = {
    enabled = true,
    text = "",
    hl = "DiagnosticSignHint",
  },
  virtual_text = { enabled = false },
  float = { enabled = false },
  status_text = { enabled = false },
})

-- LSP File Operations
require("lsp-file-operations").setup()

-- TypeScript Tools (only if tsgo is not available)
if vim.fn.executable("tsgo") == 0 then
  require("typescript-tools").setup({
    settings = {
      separate_diagnostic_server = true,
      publish_diagnostic_on = "insert_leave",
      expose_as_code_action = { "fix_all", "add_missing_imports", "remove_unused" },
      tsserver_file_preferences = {
        includeInlayParameterNameHints = "all",
        includeInlayParameterNameHintsWhenArgumentMatchesName = false,
        includeInlayFunctionParameterTypeHints = true,
        includeInlayVariableTypeHints = true,
        includeInlayVariableTypeHintsWhenTypeMatchesName = false,
        includeInlayPropertyDeclarationTypeHints = true,
        includeInlayFunctionLikeReturnTypeHints = true,
        includeInlayEnumMemberValueHints = true,
      },
      tsserver_format_options = {
        allowIncompleteCompletions = false,
        allowRenameOfImportPath = false,
      },
    },
  })
  vim.keymap.set("n", "<leader>co", "<cmd>TSToolsOrganizeImports<cr>", { desc = "Organize imports" })
  vim.keymap.set("n", "<leader>cR", "<cmd>TSToolsRemoveUnusedImports<cr>", { desc = "Remove unused imports" })
  vim.keymap.set("n", "<leader>cM", "<cmd>TSToolsAddMissingImports<cr>", { desc = "Add missing imports" })
  vim.keymap.set("n", "<leader>cD", "<cmd>TSToolsGoToSourceDefinition<cr>", { desc = "Go to source definition" })
  vim.keymap.set("n", "<leader>cr", "<cmd>TSToolsRenameFile<cr>", { desc = "Rename file" })
  vim.keymap.set("n", "<leader>cf", "<cmd>TSToolsFixAll<cr>", { desc = "Fix all" })
end
