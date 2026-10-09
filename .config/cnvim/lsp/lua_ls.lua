return {
  cmd = { "lua-language-server" },
  filetypes = { "lua" },
  root_markers = { ".luarc.json", ".luarc.jsonc", ".luacheckrc", "stylua.toml", ".stylua.toml", ".git" },
  settings = {
    Lua = {
      workspace = { checkThirdParty = false },
      completion = { callSnippet = "Replace" },
      diagnostics = { globals = { "vim" } },
      hint = { enable = true },
    },
  },
}
