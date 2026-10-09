-- Move through editor splits first, then Herdr panes when available.
for _, key in ipairs({ "h", "j", "k", "l" }) do
  vim.keymap.set("n", "<c-" .. key .. ">", function()
    local herdr = require("config.herdr")
    if herdr.active() then
      return herdr.navigate(key)
    end
    vim.cmd.wincmd(key)
  end, { silent = true })
end
vim.keymap.set("n", "<c-\\>", "<cmd>wincmd p<cr>", { silent = true })
