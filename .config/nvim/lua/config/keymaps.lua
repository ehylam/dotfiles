local keymap = vim.keymap.set
local opts = { silent = true }

-- Better paste (don't overwrite clipboard)
keymap("v", "p", '"_dP', opts)

-- Don't yank on delete char
keymap("n", "x", '"_x', opts)
keymap("n", "X", '"_X', opts)
keymap("v", "x", '"_x', opts)
keymap("v", "X", '"_X', opts)

-- Copy whole file content to clipboard with C-c
keymap("n", "<C-c>", ":%y+<CR>", opts)

-- Stay in indent mode
keymap("v", "<", "<gv", opts)
keymap("v", ">", ">gv", opts)

-- Move lines up or down
keymap("n", "<A-Down>", ":m .+1<CR>", opts)
keymap("n", "<A-Up>", ":m .-2<CR>", opts)
keymap("i", "<A-Down>", "<Esc>:m .+1<CR>==gi", opts)
keymap("i", "<A-Up>", "<Esc>:m .-2<CR>==gi", opts)
keymap("v", "<A-Down>", ":m '>+1<CR>gv=gv", opts)
keymap("v", "<A-Up>", ":m '<-2<CR>gv=gv", opts)

-- Resize window using <ctrl> arrow keys
keymap("n", "<C-Up>", "<cmd>resize +10<cr>", { desc = "Increase Window Height" })
keymap("n", "<C-Down>", "<cmd>resize -10<cr>", { desc = "Decrease Window Height" })
keymap("n", "<C-Right>", "<cmd>vertical resize +10<cr>", { desc = "Increase Window Width" })
keymap("n", "<C-Left>", "<cmd>vertical resize -10<cr>", { desc = "Decrease Window Width" })
keymap("n", "<leader>wj", "<C-W>s", { desc = "Split window below" })
keymap("n", "<leader>wl", "<C-W>v", { desc = "Split window right" })

-- Buffer navigation
keymap("n", "[b", "<cmd>bprevious<cr>", { desc = "Prev Buffer" })
keymap("n", "]b", "<cmd>bnext<cr>", { desc = "Next Buffer" })

-- Clear search highlight
keymap({ "i", "n" }, "<esc>", "<cmd>noh<cr><esc>", { desc = "Escape and Clear hlsearch" })

-- Better up/down (respects wrapping)
keymap({ "n", "x" }, "j", "v:count == 0 ? 'gj' : 'j'", { desc = "Down", expr = true, silent = true })
keymap({ "n", "x" }, "k", "v:count == 0 ? 'gk' : 'k'", { desc = "Up", expr = true, silent = true })

-- Undotree
keymap("n", "<leader><F5>", vim.cmd.UndotreeToggle)

-- Diffview toggle
keymap("n", "<leader><leader>gx", function()
  local lib = require("diffview.lib")
  if next(lib.views) == nil then
    vim.cmd("DiffviewOpen")
  else
    vim.cmd("DiffviewClose")
  end
end)

-- TODO list
keymap(
  "n",
  "<leader>tl",
  function() Snacks.picker.todo_comments() end,
  { noremap = true, silent = true, desc = "Toggle TODO list" }
)
keymap("n", "<leader>tt", ":Pendulum<CR>", { desc = "Show Time Table" })

-- Toggle inlay hints
keymap("n", "<leader>ih", function()
  vim.lsp.inlay_hint.enable(not vim.lsp.inlay_hint.is_enabled())
end, { desc = "Toggle inlay hints" })

-- LazyGit with reminder
function _G.open_lazygit_with_message()
  Snacks.lazygit.open()

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

  vim.notify(
    ascii_art
      .. "\n「□ Remember to do a local build」\n「□ test on different browsers! 」\n「□ Triple check your code!」\n「□ Check all TODOs/FIX (<leader> tl & ]t & [t)」\n「□ Remove console.logs」",
    vim.log.levels.INFO,
    {
      title = "Before you send it",
      timeout = 7000,
      max_width = 200,
    }
  )
end

keymap(
  "n",
  "<leader>gg",
  ":lua open_lazygit_with_message()<CR>",
  { desc = "Lazygit (root dir)", noremap = true, silent = true }
)
