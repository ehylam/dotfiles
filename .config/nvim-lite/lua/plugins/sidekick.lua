return {
  {
    "Cannon07/claude-preview.nvim",
    config = function()
      local ok, code_preview = pcall(require, "code-preview")
      if ok then
        code_preview.setup()
      end
    end,
  },
  {
    "folke/sidekick.nvim",
    event = "VeryLazy",
    opts = {
      -- Default to Claude CLI
      cli = {
        default = "claude",
      },
    },
    keys = {
      -- NES (Next Edit Suggestions)
      { "<Tab>", function() require("sidekick").nes_jump_or_apply() end, desc = "NES: Jump or Apply", mode = { "n", "i" } },
      { "<leader>an", "<cmd>Sidekick nes apply<cr>", desc = "NES: Apply all" },
      { "<leader>ac", "<cmd>Sidekick nes clear<cr>", desc = "NES: Clear" },

      -- CLI toggle/select
      { "<leader>aa", function() require("sidekick.cli").toggle() end, desc = "Toggle AI CLI" },
      { "<leader>as", function() require("sidekick.cli").select() end, desc = "Select AI CLI" },
      { "<leader>ap", function() require("sidekick.cli").prompt() end, desc = "AI Prompt" },

      -- Send context (Claude Code @ syntax)
      { "<leader>at", function() require("sidekick.cli").send({ msg = "{this}" }) end, desc = "Send context (smart)" },

      { "<leader>av", function()
        -- Send file reference with line range
        local start_line = vim.fn.line("v")
        local end_line = vim.fn.line(".")
        if start_line > end_line then start_line, end_line = end_line, start_line end
        local file = vim.fn.expand("%:.")
        require("sidekick.cli").send({ msg = string.format("@%s:%d-%d", file, start_line, end_line) })
      end, desc = "Send selection ref", mode = { "v", "x" } },

      { "<leader>al", function()
        -- Send current line with position
        require("sidekick.cli").send({ msg = "@{file} line {position}:\n{line}" })
      end, desc = "Send current line" },

      { "<leader>af", function()
        -- Reference file (Claude Code will auto-fetch content)
        require("sidekick.cli").send({ msg = "@{file}" })
      end, desc = "Reference file" },

      { "<leader>aF", function()
        -- Send function at cursor
        require("sidekick.cli").send({ msg = "@{file} - function at cursor:\n{function}" })
      end, desc = "Send function" },

      { "<leader>ad", function()
        -- Send diagnostics with file context
        require("sidekick.cli").send({ msg = "@{file} diagnostics:\n{diagnostics}" })
      end, desc = "Send diagnostics" },

      { "<leader>aq", function()
        -- Send quickfix list
        require("sidekick.cli").send({ msg = "{quickfix}" })
      end, desc = "Send quickfix" },
    },
    dependencies = {
      "nvim-lua/plenary.nvim",
    },
  },

  -- Copilot (for NES - Next Edit Suggestions)
  {
    "zbirenbaum/copilot.lua",
    cmd = "Copilot",
    event = "InsertEnter",
    opts = {
      suggestion = { enabled = false }, -- Handled by sidekick NES
      panel = { enabled = false },
    },
  },
}
