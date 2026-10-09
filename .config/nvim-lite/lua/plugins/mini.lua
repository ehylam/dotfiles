return {
  -- Mini.pairs: Auto pairs
  {
    "echasnovski/mini.pairs",
    event = "InsertEnter",
    opts = {},
  },

  -- Mini.surround: Surround actions
  {
    "echasnovski/mini.surround",
    event = "VeryLazy",
    opts = {
      mappings = {
        add = "sa",
        delete = "sd",
        find = "sf",
        find_left = "sF",
        highlight = "sh",
        replace = "sr",
        update_n_lines = "sn",
      },
    },
  },

  -- Mini.comment: Comment toggling
  {
    "echasnovski/mini.comment",
    event = "VeryLazy",
    opts = {},
  },

  -- Mini.ai: Better text objects
  {
    "echasnovski/mini.ai",
    event = "VeryLazy",
    opts = {},
  },
}
