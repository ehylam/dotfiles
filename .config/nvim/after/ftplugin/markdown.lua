-- Neovim 0.12's markdown ftplugin starts Treesitter by default.
pcall(vim.treesitter.stop, 0)

if vim.bo.syntax == "" then
  vim.bo.syntax = "markdown"
end

vim.opt_local.foldmethod = "manual"
vim.opt_local.foldexpr = ""

for _, lhs in ipairs({ "gO", "]]", "[[" }) do
  pcall(vim.keymap.del, "n", lhs, { buffer = true })
end
