vim.pack.add({
  "https://github.com/mfussenegger/nvim-dap",
  "https://github.com/theHamsta/nvim-dap-virtual-text",
  "https://github.com/rcarriga/nvim-dap-ui",
  "https://github.com/nvim-neotest/nvim-nio",
  "https://github.com/nvim-nui/nui.nvim",
  "https://github.com/jay-babu/mason-nvim-dap.nvim",
  "https://github.com/williamboman/mason.nvim",
})

vim.cmd.packadd("nvim-nio")
vim.cmd.packadd("nui.nvim")

local dap = require("dap")
local map = vim.keymap.set

-- Virtual text
require("nvim-dap-virtual-text").setup({})

-- DAP UI
require("dapui").setup({})

-- Mason DAP
require("mason-nvim-dap").setup({
  ensure_installed = {},
  automatic_installation = false,
  handlers = {},
})

-- Signs
vim.fn.sign_define("DapBreakpoint", { text = "●", texthl = "DapBreakpoint" })
vim.fn.sign_define("DapBreakpointCondition", { text = "●", texthl = "DapBreakpointCondition" })
vim.fn.sign_define("DapLogPoint", { text = "◆", texthl = "DapLogPoint" })
vim.fn.sign_define("DapStopped", { text = "→", texthl = "DapStopped", linehl = "DapStoppedLine" })
vim.fn.sign_define("DapBreakpointRejected", { text = "●", texthl = "DapBreakpointRejected" })

-- Node.js / JavaScript / TypeScript debugging
for _, adapter in ipairs({ "pwa-node", "pwa-chrome" }) do
  dap.adapters[adapter] = {
    type = "server",
    host = "localhost",
    port = "${port}",
    executable = {
      command = "node",
      args = {
        vim.fn.stdpath("data") .. "/mason/packages/js-debug-adapter/js-debug/src/dapDebugServer.js",
        "${port}",
      },
    },
  }
end

for _, lang in ipairs({ "javascript", "typescript", "javascriptreact", "typescriptreact" }) do
  dap.configurations[lang] = {
    {
      type = "pwa-node",
      request = "launch",
      name = "Launch file",
      program = "${file}",
      cwd = "${workspaceFolder}",
    },
    {
      type = "pwa-node",
      request = "attach",
      name = "Attach to process",
      processId = require("dap.utils").pick_process,
      cwd = "${workspaceFolder}",
    },
    {
      type = "pwa-chrome",
      request = "launch",
      name = "Launch Chrome",
      url = "http://localhost:3000",
      webRoot = "${workspaceFolder}",
    },
  }
end

-- Keymaps
map("n", "<leader>db", function() dap.toggle_breakpoint() end, { desc = "Toggle breakpoint" })
map("n", "<leader>dB", function() dap.set_breakpoint(vim.fn.input("Condition: ")) end, { desc = "Conditional breakpoint" })
map("n", "<leader>dc", function() dap.continue() end, { desc = "Continue" })
map("n", "<leader>dC", function() dap.run_to_cursor() end, { desc = "Run to cursor" })
map("n", "<leader>di", function() dap.step_into() end, { desc = "Step into" })
map("n", "<leader>do", function() dap.step_over() end, { desc = "Step over" })
map("n", "<leader>dO", function() dap.step_out() end, { desc = "Step out" })
map("n", "<leader>dr", function() dap.repl.toggle() end, { desc = "Toggle REPL" })
map("n", "<leader>dl", function() dap.run_last() end, { desc = "Run last" })
map("n", "<leader>dt", function() dap.terminate() end, { desc = "Terminate" })
map("n", "<leader>du", function() require("dapui").toggle() end, { desc = "DAP UI toggle" })
map({ "n", "v" }, "<leader>de", function() require("dapui").eval() end, { desc = "DAP eval" })
map("n", "<F5>", function() dap.continue() end, { desc = "Debug: Continue" })
map("n", "<F10>", function() dap.step_over() end, { desc = "Debug: Step over" })
map("n", "<F11>", function() dap.step_into() end, { desc = "Debug: Step into" })
map("n", "<F12>", function() dap.step_out() end, { desc = "Debug: Step out" })
