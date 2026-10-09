-- Diagnostic config

local signs = {
  Error = "",
  Warn = "",
  Hint = "󰌵",
  Info = "",
}

local codes = {
  -- Lua
  no_matching_function = {
    message = " Can't find a matching function",
    "redundant-parameter",
    "ovl_no_viable_function_in_call",
  },
  empty_block = {
    message = " That shouldn't be empty here",
    "empty-block",
  },
  missing_symbol = {
    message = " Here should be a symbol",
    "miss-symbol",
  },
  expected_semi_colon = {
    message = " Please put the `;` or `,`",
    "expected_semi_declaration",
    "miss-sep-in-table",
    "invalid_token_after_toplevel_declarator",
  },
  redefinition = {
    message = " That variable was defined before",
    icon = " ",
    "redefinition",
    "redefined-local",
    "no-duplicate-imports",
    "@typescript-eslint/no-redeclare",
    "import/no-duplicates",
  },
  no_matching_variable = {
    message = " Can't find that variable",
    "undefined-global",
    "reportUndefinedVariable",
  },
  trailing_whitespace = {
    message = "  Whitespaces are useless",
    "trailing-whitespace",
    "trailing-space",
  },
  unused_variable = {
    message = "󰂭  Don't define variables you don't use",
    icon = "󰂭  ",
    "unused-local",
    "@typescript-eslint/no-unused-vars",
    "no-unused-vars",
  },
  unused_function = {
    message = "  Don't define functions you don't use",
    "unused-function",
  },
  useless_symbols = {
    message = " Remove that useless symbols",
    "unknown-symbol",
  },
  wrong_type = {
    message = " Try to use the correct types",
    "init_conversion_failed",
  },
  undeclared_variable = {
    message = " Have you delcared that variable somewhere?",
    "undeclared_var_use",
  },
  lowercase_global = {
    message = " Should that be a global? (if so make it uppercase)",
    "lowercase-global",
  },
  -- TypeScript
  no_console = {
    icon = "  ",
    "no-console",
  },
  -- Prettier
  prettier = {
    icon = "  ",
    "prettier/prettier",
  },
}

vim.diagnostic.config({
  float = {
    source = false,
    format = function(diagnostic)
      local code = diagnostic and diagnostic.user_data and diagnostic.user_data.lsp.code

      if not diagnostic.source or not code then
        return string.format("%s", diagnostic.message)
      end

      if diagnostic.source == "eslint" then
        for _, table in pairs(codes) do
          if vim.tbl_contains(table, code) then
            return string.format("%s [%s]", table.icon .. diagnostic.message, code)
          end
        end

        return string.format("%s [%s]", diagnostic.message, code)
      end

      for _, table in pairs(codes) do
        if vim.tbl_contains(table, code) then
          return table.message
        end
      end

      return string.format("%s [%s]", diagnostic.message, diagnostic.source)
    end,
  },
  signs = {
    text = {
      [vim.diagnostic.severity.ERROR] = signs["Error"], -- or other icon of your choice here, this is just what my config has:
      [vim.diagnostic.severity.WARN] = signs["Warn"],
      [vim.diagnostic.severity.HINT] = signs["Hint"],
      [vim.diagnostic.severity.INFO] = signs["Info"],
    },
  },
  underline = true, -- Underline errors
  update_in_insert = false, -- Don't update diagnostics in insert mode
  severity_sort = true, -- Sort diagnostics by severity
  -- virtual_text = {
  --   prefix = function(diagnostic)
  --     if diagnostic.severity == vim.diagnostic.severity.ERROR then
  --       return signs["Error"]
  --     elseif diagnostic.severity == vim.diagnostic.severity.WARN then
  --       return signs["Warning"]
  --     elseif diagnostic.severity == vim.diagnostic.severity.INFO then
  --       return signs["Hint"]
  --     else
  --       return signs["Info"]
  --     end
  --   end,
  -- },
})

-- UI

local function with_border(handler)
  return function(err, result, ctx, config)
    config = vim.tbl_deep_extend("force", config or {}, { border = "rounded" })
    return handler(err, result, ctx, config)
  end
end

vim.lsp.handlers["textDocument/hover"] = with_border(vim.lsp.handlers.hover)
vim.lsp.handlers["textDocument/signatureHelp"] = with_border(vim.lsp.handlers.signature_help)
