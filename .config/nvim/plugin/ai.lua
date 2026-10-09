vim.pack.add({
  "https://github.com/Cannon07/claude-preview.nvim",
  "https://github.com/zbirenbaum/copilot.lua",
  "https://github.com/MSmaili/wiremux.nvim",
  "https://github.com/NickvanDyke/opencode.nvim",
})

-- Claude preview
local code_preview_ok, code_preview = pcall(require, "code-preview")
if code_preview_ok then
  code_preview.setup()
end

-- Copilot
require("copilot").setup({
  copilot_node_command = vim.fn.exepath("node") ~= "" and vim.fn.exepath("node") or "node",
  suggestion = {
    enabled = false,
    auto_trigger = false,
  },
  panel = { enabled = true },
})

-- Wiremux supplies context expansion; pane actions use Herdr.
require("wiremux").setup({})

local herd = function(action, ...) return require("config.herdr").route(action, ...) end

vim.keymap.set("n", "<leader>mt", herd("toggle"), { desc = "Toggle target" })
vim.keymap.set("n", "<leader>mc", herd("create"), { desc = "Create target" })
vim.keymap.set("n", "<leader>mf", herd("send", "{file}", { focus = true }), { desc = "Send file" })
vim.keymap.set({ "x", "n" }, "<leader>ms", herd("send", "{this}", { focus = true }), { desc = "Send this" })
vim.keymap.set("x", "<leader>mv", herd("send", "{selection}", { focus = true }), { desc = "Send selection" })
vim.keymap.set("n", "<leader>md", herd("send", "{diagnostics}", { focus = true }), { desc = "Send diagnostics" })
vim.keymap.set("n", "<leader>mD", herd("send", "{diagnostics_all}", { focus = true }), { desc = "Send all diagnostics" })
vim.keymap.set({ "x", "n" }, "gm", herd("send_motion"), { expr = true, desc = "Send motion" })
vim.keymap.set({ "n", "x" }, "<leader>mp", herd("send", {
  { label = "Review", value = "Review {selection} for correctness and readability" },
  { label = "Explain", value = "Explain {selection} and its context" },
  { label = "Fix diagnostics", value = "Fix these {diagnostics}" },
  { label = "Add tests", value = "Add tests for {selection}" },
  { label = "Optimize", value = "Optimize {selection} for performance" },
}), { desc = "AI prompts" })

-- Opencode
local opencode_ok, opencode = pcall(require, "opencode")
if opencode_ok and type(opencode.setup) == "function" then
  opencode.setup({})
end

-- stylua: ignore start
vim.keymap.set("n", "<leader>ot", function() require("opencode").toggle() end, { desc = "Toggle opencode" })
vim.keymap.set({ "n", "v" }, "<leader>oa", function() require("opencode").ask() end, { desc = "Ask opencode" })
vim.keymap.set({ "n", "v" }, "<leader>oA", function() require("opencode").ask("@file ") end, { desc = "Ask opencode about current file" })
vim.keymap.set("n", "<leader>on", function() require("opencode").command("/new") end, { desc = "New session" })
vim.keymap.set("n", "<leader>oe", function() require("opencode").prompt("Explain @cursor and its context") end, { desc = "Explain code near cursor" })
vim.keymap.set("n", "<leader>or", function() require("opencode").prompt("Review @file for correctness and readability") end, { desc = "Review file" })
vim.keymap.set("n", "<leader>of", function() require("opencode").prompt("Fix these @diagnostics") end, { desc = "Fix errors" })
vim.keymap.set("v", "<leader>oo", function() require("opencode").prompt("Optimize @selection for performance and readability") end, { desc = "Optimize selection" })
vim.keymap.set("v", "<leader>od", function() require("opencode").prompt("Add documentation comments for @selection") end, { desc = "Document selection" })
vim.keymap.set("v", "<leader>ot", function() require("opencode").prompt("Add tests for @selection") end, { desc = "Test selection" })
-- stylua: ignore end
