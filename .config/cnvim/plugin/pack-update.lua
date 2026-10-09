vim.api.nvim_create_user_command("PackUpdate", function()
  vim.pack.update()
end, { desc = "Update plugins (vim.pack)" })

vim.keymap.set("n", "<leader>pu", "<cmd>PackUpdate<cr>", { desc = "Update plugins (vim.pack)" })
