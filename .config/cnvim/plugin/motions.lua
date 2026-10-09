vim.pack.add({
  "https://github.com/chrisgrieser/nvim-spider",
})

-- Subword-aware w/e/b: stops at camelCase and snake_case boundaries.
-- Mapped in operator-pending and visual too, so dw/cw respect subwords.
-- To keep the stock behaviour for operators, drop "o" and "x" from the mode lists.
require("spider").setup({
  skipInsignificantPunctuation = true,
})

local map = vim.keymap.set
for _, motion in ipairs({ "w", "e", "b", "ge" }) do
  map({ "n", "o", "x" }, motion, function()
    require("spider").motion(motion)
  end, { desc = "Spider " .. motion })
end
