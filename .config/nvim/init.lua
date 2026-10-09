vim.loader.enable()

-- Ensure cwd is accessible for git operations (macOS permission fix)
local cwd_ok, _ = pcall(vim.uv.cwd)
if not cwd_ok then
  vim.cmd.cd(vim.env.HOME)
end

-- Leaders must be set before any plugins load
vim.g.mapleader = " "
vim.g.maplocalleader = "\\"

-- PackChanged hooks (must be created BEFORE vim.pack.add calls)
vim.api.nvim_create_autocmd("PackChanged", {
  callback = function(ev)
    local name, kind = ev.data.spec.name, ev.data.kind
    -- Update treesitter parsers
    if name == "nvim-treesitter" and kind == "update" then
      if not ev.data.active then
        vim.cmd.packadd("nvim-treesitter")
      end
      vim.cmd("TSUpdate")
    end
    -- Update Mason registry
    if name == "mason.nvim" and (kind == "install" or kind == "update") then
      if not ev.data.active then
        vim.cmd.packadd("mason.nvim")
      end
      vim.cmd("MasonUpdate")
    end
    -- Build telescope-fzf-native
    if name == "telescope-fzf-native.nvim" and (kind == "install" or kind == "update") then
      local dir = vim.fn.stdpath("data") .. "/site/pack/core/opt/telescope-fzf-native.nvim"
      vim.fn.system({ "make", "-C", dir })
    end
  end,
})

-- Core settings
require("config.options")
require("config.keymaps")
require("config.autocmds")
require("config.diagnostics")

-- Startup notification
local ascii_art = [[

                                          _.oo.
                  _.u[[/;:,.         .odMMMMMM'
               .o888UU[[[/;:-.  .o@P^    MMM^
              oN88888UU[[[/;::-.        dP^
             dNMMNN888UU[[[/;:--.   .o@P^
            ,MMMMMMN888UU[[/;::-. o@^
            NNMMMNN888UU[[[/~.o@P^
            888888888UU[[[/o@^-..
           oI8888UU[[[/o@P^:--..
        .@^  YUU[[[/o@^;::---..
      oMP     ^/o@P^;:::---..
   .dMMM    .o@^ ^;::---...
  dMMMMMMM@^`       `^^^^
 YMMMUP^
  ^^
]]

vim.schedule(function()
  vim.notify(
    ascii_art .. "\n Remember to create/checkout to the correct branch!\n Pull in the latest changes/content!",
    vim.log.levels.INFO,
    {
      title = "Remember",
      timeout = 5000,
      max_width = 150,
    }
  )
end)
