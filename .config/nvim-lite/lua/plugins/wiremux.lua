return {
  "MSmaili/wiremux.nvim",
  opts = {
    picker = { adapter = "fzf-lua" },

  },
  keys = (function()
    -- Wiremux supplies context expansion; pane actions use Herdr.
    local herd = function(action, ...) return require("config.herdr").route(action, ...) end
    return {
      { "<leader>mt", herd("toggle"), desc = "Toggle target" },
      { "<leader>mc", herd("create"), desc = "Create target" },
      { "<leader>mf", herd("send", "{file}", { focus = true }), desc = "Send file" },
      { "<leader>ms", herd("send", "{this}", { focus = true }), mode = { "x", "n" }, desc = "Send this" },
      { "<leader>mv", herd("send", "{selection}", { focus = true }), mode = { "x" }, desc = "Send selection" },
      { "<leader>md", herd("send", "{diagnostics}", { focus = true }), desc = "Send diagnostics" },
      { "<leader>mD", herd("send", "{diagnostics_all}", { focus = true }), desc = "Send all diagnostics" },
      { "gm", herd("send_motion"), mode = { "x", "n" }, expr = true, desc = "Send motion" },
      { "<leader>mp", herd("send", {
        { label = "Review", value = "Review {selection} for correctness and readability" },
        { label = "Explain", value = "Explain {selection} and its context" },
        { label = "Fix diagnostics", value = "Fix these {diagnostics}" },
        { label = "Add tests", value = "Add tests for {selection}" },
        { label = "Optimize", value = "Optimize {selection} for performance" },
      }), mode = { "n", "x" }, desc = "AI prompts" },
    }
  end)(),
}
