return {
  {
    "ibhagwan/fzf-lua",
    dependencies = { "nvim-tree/nvim-web-devicons" },
    cmd = "FzfLua",
    keys = {
      -- Core
      { "<leader><space>", "<cmd>FzfLua files<cr>", desc = "Find files" },
      { "<leader>,", "<cmd>FzfLua buffers<cr>", desc = "Buffers" },
      { "<leader>/", "<cmd>FzfLua live_grep<cr>", desc = "Grep" },
      { "<leader>:", "<cmd>FzfLua command_history<cr>", desc = "Command history" },

      -- Find
      { "<leader>ff", "<cmd>FzfLua files<cr>", desc = "Find files" },
      { "<leader>fb", "<cmd>FzfLua buffers<cr>", desc = "Buffers" },
      { "<leader>fr", "<cmd>FzfLua oldfiles<cr>", desc = "Recent files" },
      { "<leader>fg", "<cmd>FzfLua git_files<cr>", desc = "Git files" },
      { "<leader>fc", function() require("fzf-lua").files({ cwd = vim.fn.stdpath("config") }) end, desc = "Config files" },

      -- Search
      { "<leader>sg", "<cmd>FzfLua live_grep<cr>", desc = "Grep" },
      { "<leader>sw", "<cmd>FzfLua grep_cword<cr>", desc = "Word under cursor" },
      { "<leader>sb", "<cmd>FzfLua lgrep_curbuf<cr>", desc = "Buffer lines" },
      { "<leader>sh", "<cmd>FzfLua help_tags<cr>", desc = "Help" },
      { "<leader>sk", "<cmd>FzfLua keymaps<cr>", desc = "Keymaps" },
      { "<leader>sd", "<cmd>FzfLua diagnostics_workspace<cr>", desc = "Diagnostics" },

      -- Git
      { "<leader>gl", "<cmd>FzfLua git_commits<cr>", desc = "Git log" },
      { "<leader>gst", "<cmd>FzfLua git_status<cr>", desc = "Git status" },
      { "<leader>gb", "<cmd>FzfLua git_branches<cr>", desc = "Git branches" },

      -- LSP
      { "gd", "<cmd>FzfLua lsp_definitions<cr>", desc = "Go to definition" },
      { "gr", "<cmd>FzfLua lsp_references<cr>", desc = "References" },
      { "gI", "<cmd>FzfLua lsp_implementations<cr>", desc = "Implementations" },
      { "gy", "<cmd>FzfLua lsp_typedefs<cr>", desc = "Type definition" },
      { "<leader>ss", "<cmd>FzfLua lsp_document_symbols<cr>", desc = "Document symbols" },
      { "<leader>sS", "<cmd>FzfLua lsp_workspace_symbols<cr>", desc = "Workspace symbols" },

      -- Resume
      { "<leader>sR", "<cmd>FzfLua resume<cr>", desc = "Resume" },
    },
    opts = {
      "default-title",
      fzf_colors = true,
      winopts = {
        width = 0.85,
        height = 0.80,
        preview = {
          layout = "vertical",
          vertical = "down:45%",
        },
      },
      files = {
        cwd_prompt = false,
      },
    },
  },
}
