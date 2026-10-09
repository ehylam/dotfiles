vim.pack.add({
  "https://github.com/jake-stewart/multicursor.nvim",
})

local mc = require("multicursor-nvim")
local map = vim.keymap.set

mc.setup()

-- Add/skip a cursor at the next/previous match of the word under the cursor.
-- <C-n>/<C-p> are free in this config (completion is native and insert-mode only).
map({ "n", "x" }, "<C-n>", function() mc.matchAddCursor(1) end, { desc = "Multicursor: add at next match" })
map({ "n", "x" }, "<C-p>", function() mc.matchAddCursor(-1) end, { desc = "Multicursor: add at prev match" })

-- Add a cursor on the line above/below.
map({ "n", "x" }, "<up>", function() mc.lineAddCursor(-1) end, { desc = "Multicursor: add cursor above" })
map({ "n", "x" }, "<down>", function() mc.lineAddCursor(1) end, { desc = "Multicursor: add cursor below" })

-- <leader>M prefix: <leader>m is AI, <leader>n is notifications, <leader>x is Trouble.
map({ "n", "x" }, "<leader>Ma", function() mc.matchAllAddCursors() end, { desc = "Multicursor: all matches" })
map({ "n", "x" }, "<leader>Ms", function() mc.matchSkipCursor(1) end, { desc = "Multicursor: skip next match" })
map("x", "<leader>Mv", function() mc.visualToCursors() end, { desc = "Multicursor: visual to cursors" })
map("x", "<leader>Ml", function() mc.splitCursors() end, { desc = "Multicursor: split selection into lines" })
map("n", "<leader>Mr", function() mc.restoreCursors() end, { desc = "Multicursor: restore cleared cursors" })

-- These only bind while cursors exist, so they cannot shadow normal mappings.
mc.addKeymapLayer(function(layerSet)
  layerSet({ "n", "x" }, "<left>", mc.prevCursor)
  layerSet({ "n", "x" }, "<right>", mc.nextCursor)
  layerSet({ "n", "x" }, "<leader>Md", mc.deleteCursor)
  layerSet("n", "<esc>", function()
    if not mc.cursorsEnabled() then
      mc.enableCursors()
    else
      mc.clearCursors()
    end
  end)
end)
