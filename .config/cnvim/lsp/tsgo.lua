-- tsgo: Native Go port of TypeScript (experimental, faster)
-- Install: npm install -g @typescript/native-preview
-- This will be used instead of typescript-tools.nvim when available

return {
  cmd = { "tsgo", "--lsp", "--stdio" },
  filetypes = {
    "javascript",
    "javascriptreact",
    "javascript.jsx",
    "typescript",
    "typescriptreact",
    "typescript.tsx",
  },
  root_markers = {
    "tsconfig.json",
    "jsconfig.json",
    "package.json",
    ".git",
  },
  -- Exclude Deno projects (they have their own LSP)
  on_attach = function(client, bufnr)
    local root = client.config.root_dir
    if root then
      local deno_markers = { "deno.json", "deno.jsonc", "deno.lock" }
      for _, marker in ipairs(deno_markers) do
        if vim.uv.fs_stat(root .. "/" .. marker) then
          vim.lsp.stop_client(client.id)
          return
        end
      end
    end
  end,
}
