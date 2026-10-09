vim.pack.add({
  "https://github.com/nvim-mini/mini.nvim",
})

-- Icons
require("mini.icons").setup()
MiniIcons.mock_nvim_web_devicons()

-- Comment
require("mini.comment").setup()

-- Pairs
require("mini.pairs").setup()

-- Surround
require("mini.surround").setup()

-- Split/Join
require("mini.splitjoin").setup({
  mappings = { toggle = "<leader>cj" },
})

-- Align
require("mini.align").setup()

-- Bracketed
require("mini.bracketed").setup()

-- AI text objects
local ai = require("mini.ai")
ai.setup({
  custom_textobjects = {
    o = ai.gen_spec.treesitter({
      a = { "@block.outer", "@conditional.outer", "@loop.outer" },
      i = { "@block.inner", "@conditional.inner", "@loop.inner" },
    }, {}),
    f = ai.gen_spec.treesitter({ a = "@function.outer", i = "@function.inner" }, {}),
    c = ai.gen_spec.treesitter({ a = "@class.outer", i = "@class.inner" }, {}),
    t = { "<([%p%w]-)%f[^<%w][^<>]->.-</%1>", "^<.->().*()</[^/]->$" },
    d = { "%f[%d]%d+" },
    e = {
      {
        "%u[%l%d]+%f[^%l%d]",
        "%f[%S][%l%d]+%f[^%l%d]",
        "%f[%P][%l%d]+%f[^%l%d]",
        "^[%l%d]+%f[^%l%d]",
      },
      "^().*()$",
    },
    u = ai.gen_spec.function_call(),
    U = ai.gen_spec.function_call({ name_pattern = "[%w_]" }),
  },
})

-- Diff
require("mini.diff").setup({
  view = {
    style = "sign",
    signs = { add = "+", change = "~", delete = "-" },
  },
})

-- Hipatterns
local hipatterns = require("mini.hipatterns")
hipatterns.setup({
  highlighters = {
    todo = { pattern = "%f[%w]()TODO()%f[%W]", group = "MiniHipatternsTodo" },
    fix = { pattern = "%f[%w]()FIX()%f[%W]", group = "MiniHipatternsFixme" },
    fixme = { pattern = "%f[%w]()FIXME()%f[%W]", group = "MiniHipatternsFixme" },
    hack = { pattern = "%f[%w]()HACK()%f[%W]", group = "MiniHipatternsHack" },
    note = { pattern = "%f[%w]()NOTE()%f[%W]", group = "MiniHipatternsNote" },
  },
})

-- Git (for statusline)
require("mini.git").setup()
