return {
  cmd = { "vscode-eslint-language-server", "--stdio" },
  filetypes = { "javascript", "javascriptreact", "javascript.jsx", "typescript", "typescriptreact", "typescript.tsx" },
  root_markers = { ".eslintrc", ".eslintrc.js", ".eslintrc.json", ".eslintrc.cjs", "eslint.config.js", "eslint.config.mjs", "package.json" },
  settings = {
    validate = "on",
    packageManager = "npm",
    useESLintClass = false,
    experimental = { useFlatConfig = false },
    codeActionOnSave = { enable = false, mode = "all" },
    format = false,
    quiet = false,
    onIgnoredFiles = "off",
    rulesCustomizations = {},
    run = "onSave",
    problems = { shortenToSingleLine = false },
    nodePath = "",
    workingDirectory = { mode = "location" },
    codeAction = {
      disableRuleComment = { enable = true, location = "separateLine" },
      showDocumentation = { enable = true },
    },
  },
}
