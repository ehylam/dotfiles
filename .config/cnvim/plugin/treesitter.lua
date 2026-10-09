vim.pack.add({
  { src = "https://github.com/nvim-treesitter/nvim-treesitter", version = "main" },
  "https://github.com/windwp/nvim-ts-autotag",
})

-- In Neovim 0.12, highlighting and indent are built-in.
-- nvim-treesitter is used only for parser management + incremental selection.
local treesitter = require("nvim-treesitter")

-- Fix markdown code-fence injections on Neovim 0.12.3.
--
-- nvim-treesitter (main) ships queries/markdown/injections.scm that resolves the
-- fence language via `(language) @_lang` + `#set-lang-from-info-string!` instead of
-- capturing `@injection.language` directly. On 0.12.3 that path yields a nil node in
-- vim/treesitter.lua get_range(), so `parser:parse(true)` throws for ANY fenced code
-- block. Neovim keeps the FIRST non-`; extends` query file it finds on the rtp as the
-- base, and nvim-treesitter comes before $VIMRUNTIME, so the working built-in query is
-- discarded. `after/queries/` cannot win for the same reason; query.set() is the only
-- override that takes precedence over file resolution.
--
-- Rebuild the query from the runtime version, keeping any `; extends` additions from
-- other plugins (snacks.nvim adds a ```math -> latex injection).
local function fix_markdown_injections()
  local base = vim.env.VIMRUNTIME .. "/queries/markdown/injections.scm"
  local fd = io.open(base, "r")
  if not fd then
    return
  end
  local parts = { fd:read("*a") }
  fd:close()

  for _, file in ipairs(vim.api.nvim_get_runtime_file("queries/markdown/injections.scm", true)) do
    if file ~= base and not file:find("/nvim%-treesitter/") then
      local ext = io.open(file, "r")
      if ext then
        local text = ext:read("*a")
        ext:close()
        -- Only pull in files that opt into extending, never another base query.
        if text:match("^;+%s*extends%s*\n") then
          table.insert(parts, (text:gsub("^;+%s*extends%s*\n", "")))
        end
      end
    end
  end

  pcall(vim.treesitter.query.set, "markdown", "injections", table.concat(parts, "\n"))
end

fix_markdown_injections()
local parser_languages = {
  "typescript", "tsx", "javascript", "html", "css", "scss",
  "json", "latex", "lua", "vim", "vimdoc", "bash", "yaml", "toml",
  "markdown", "markdown_inline", "regex", "query", "diff", "liquid",
  "gitcommit", "git_rebase",
}

treesitter.setup()

vim.api.nvim_create_user_command("TSInstallConfigured", function()
  treesitter.install(parser_languages):wait(300000)
end, { desc = "Install configured Treesitter parsers" })

vim.api.nvim_create_user_command("TSUpdateConfigured", function()
  treesitter.update(parser_languages):wait(300000)
end, { desc = "Update configured Treesitter parsers" })

-- Autotag
require("nvim-ts-autotag").setup({
  opts = {
    enable_close = true,
    enable_rename = true,
    enable_close_on_slash = true,
  },
  per_filetype = {
    ["html"] = { enable_close = true },
    ["liquid"] = { enable_close = true },
  },
})

-- There used to be an autocmd here stopping the built-in TS highlighter for
-- markdown, liquid, yaml, sshconfig and sshdconfig ("injections crash on 0.12").
-- Removed 2026-08-14 after re-testing all five on 0.12.3:
--   markdown  fixed by fix_markdown_injections() above
--   liquid    parses + highlights clean, incl. {% schema %} json and html/js
--             injections, verified against 7 real theme files up to 128KB
--   yaml      clean (real workflow file)
--   sshconfig clean; sshdconfig has no parser, so start() no-ops via pcall
-- To restore for one filetype, re-add the autocmd with just that pattern.
