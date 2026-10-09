vim.loader.enable()

-- Ensure cwd is accessible for git operations (macOS permission fix)
-- vim.pack.add() runs git clone which inherits cwd — if it's restricted, all clones fail
local cwd_ok, _ = pcall(vim.uv.cwd)
if not cwd_ok then
  vim.cmd.cd(vim.env.HOME)
end

-- Disable unused providers for faster startup
vim.g.loaded_python3_provider = 0
vim.g.loaded_ruby_provider = 0
vim.g.loaded_perl_provider = 0
vim.g.loaded_node_provider = 0

-- PackChanged hooks (must be created BEFORE vim.pack.add calls)
vim.api.nvim_create_autocmd("PackChanged", {
  callback = function(ev)
    local name, kind = ev.data.spec.name, ev.data.kind
    if name == "nvim-treesitter" and kind == "update" then
      if not ev.data.active then
        vim.cmd.packadd("nvim-treesitter")
      end
      vim.cmd("TSUpdate")
    end
    if name == "mason.nvim" and (kind == "install" or kind == "update") then
      if not ev.data.active then
        vim.cmd.packadd("mason.nvim")
      end
      vim.cmd("MasonUpdate")
    end
    if name == "markdown-preview.nvim" and (kind == "install" or kind == "update") then
      if not ev.data.active then
        vim.cmd.packadd("markdown-preview.nvim")
      end
      vim.fn["mkdp#util#install"]()
    end
  end,
})

-- Load config modules in order
require("config.options")
require("config.lsp")
require("config.autocmds")
require("config.keymaps")
