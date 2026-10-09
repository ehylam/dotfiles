vim.pack.add({
  "https://github.com/neovim/nvim-lspconfig",
  "https://github.com/mason-org/mason.nvim",
  "https://github.com/mason-org/mason-lspconfig.nvim",
  "https://github.com/WhoIsSethDaniel/mason-tool-installer.nvim",
  "https://github.com/mfussenegger/nvim-lint",
})

-- Mason
require("mason").setup({})
vim.keymap.set("n", "<leader>cm", "<cmd>Mason<cr>", { desc = "Mason" })

local mason_tools = {
  "rust_analyzer",
  "ts_ls",
  "tailwindcss",
  "cssls",
  "html",
  "jsonls",
  "eslint",
  "stylelint_lsp",
  "shopify_theme_ls",
  "eslint_d",
  "stylelint",
}

-- Mason tool installer
require("mason-tool-installer").setup({
  ensure_installed = mason_tools,
  auto_update = false,
  run_on_start = false,
})
vim.keymap.set("n", "<leader>cI", "<cmd>MasonToolsInstall<cr>", { desc = "Install configured Mason tools" })
vim.keymap.set("n", "<leader>cU", "<cmd>MasonToolsUpdate<cr>", { desc = "Update configured Mason tools" })

-- Mason LSP config
require("mason-lspconfig").setup({
  automatic_enable = false,
})

-- LSP server configs
local lsp_servers = {
  "rust_analyzer",
  "ts_ls",
  "tailwindcss",
  "html",
  "cssls",
  "jsonls",
  "eslint",
  "stylelint_lsp",
}

vim.lsp.config("rust_analyzer", {
  settings = {
    ["rust-analyzer"] = {
      checkOnSave = { command = "clippy" },
      cargo = { allFeatures = true },
      procMacro = { enable = true },
    },
  },
})

vim.lsp.config("ts_ls", {
  settings = {
    typescript = {
      inlayHints = {
        includeInlayParameterNameHints = "all",
        includeInlayParameterNameHintsWhenArgumentMatchesName = false,
        includeInlayFunctionParameterTypeHints = true,
        includeInlayVariableTypeHints = true,
        includeInlayPropertyDeclarationTypeHints = true,
        includeInlayFunctionLikeReturnTypeHints = true,
        includeInlayEnumMemberValueHints = true,
      },
    },
    javascript = {
      inlayHints = {
        includeInlayParameterNameHints = "all",
        includeInlayParameterNameHintsWhenArgumentMatchesName = false,
        includeInlayFunctionParameterTypeHints = true,
        includeInlayVariableTypeHints = true,
        includeInlayPropertyDeclarationTypeHints = true,
        includeInlayFunctionLikeReturnTypeHints = true,
        includeInlayEnumMemberValueHints = true,
      },
    },
  },
})

vim.lsp.config("tailwindcss", {
  settings = {
    tailwindCSS = {
      experimental = {
        classRegex = {
          "`([^`]*)",
          '"([^"]*)',
          "'([^']*)",
          'className="([^"]*)',
          'className={"([^"}]*)',
          "className={'([^'}]*)",
          "className={`([^`]*)",
          'class="([^"]*)',
        },
      },
      validate = true,
    },
  },
})

vim.lsp.config("html", {
  filetypes = { "html", "liquid" },
  settings = {
    html = {
      format = {
        indentInnerHtml = true,
        wrapLineLength = 120,
        wrapAttributes = "auto",
      },
    },
  },
})

vim.lsp.config("cssls", {
  settings = {
    css = {
      validate = true,
      lint = { unknownAtRules = "ignore" },
    },
    scss = {
      validate = true,
      lint = { unknownAtRules = "ignore" },
    },
  },
})

vim.lsp.config("jsonls", {})

-- Shopify Liquid filetype detection
vim.filetype.add({
  extension = {
    liquid = "liquid",
  },
})

-- Shopify Liquid language server
if vim.fn.executable("shopify") == 1 then
  table.insert(lsp_servers, "shopify_theme_ls")
elseif vim.fn.executable("theme-check-language-server") == 1 then
  vim.lsp.config("theme_check", {
    cmd = { "theme-check-language-server", "--stdio" },
    filetypes = { "liquid" },
    root_markers = { ".theme-check.yml", ".theme-check.yaml" },
    settings = {},
  })
  table.insert(lsp_servers, "theme_check")
end

vim.lsp.enable(lsp_servers)

-- nvim-lint
local lint = require("lint")

lint.linters_by_ft = {
  javascript = { "eslint_d" },
  typescript = { "eslint_d" },
  javascriptreact = { "eslint_d" },
  typescriptreact = { "eslint_d" },
  css = { "stylelint" },
  scss = { "stylelint" },
}

vim.api.nvim_create_autocmd("BufWritePost", {
  callback = function()
    lint.try_lint()
  end,
})
