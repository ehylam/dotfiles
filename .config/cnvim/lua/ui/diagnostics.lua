-- Fancy Diagnostics Float
-- Inspired by OXY2DEV's diagnostics.lua
-- Displays diagnostics in a styled floating window

local M = {}

-- Configuration
local config = {
  keymap = "D",
  max_width = 60,
  max_height = 15,
  border = "rounded",
  padding = { 1, 2 }, -- vertical, horizontal
}

-- Severity styling
local severity_config = {
  [vim.diagnostic.severity.ERROR] = {
    icon = " ",
    hl = "DiagnosticError",
    title = "Error",
    border_hl = "DiagnosticError",
  },
  [vim.diagnostic.severity.WARN] = {
    icon = " ",
    hl = "DiagnosticWarn",
    title = "Warning",
    border_hl = "DiagnosticWarn",
  },
  [vim.diagnostic.severity.INFO] = {
    icon = " ",
    hl = "DiagnosticInfo",
    title = "Info",
    border_hl = "DiagnosticInfo",
  },
  [vim.diagnostic.severity.HINT] = {
    icon = "󰌵 ",
    hl = "DiagnosticHint",
    title = "Hint",
    border_hl = "DiagnosticHint",
  },
}

-- State
local state = {
  win = nil,
  buf = nil,
  diagnostics = {},
}

-- Close the float window
local function close_float()
  if state.win and vim.api.nvim_win_is_valid(state.win) then
    vim.api.nvim_win_close(state.win, true)
  end
  if state.buf and vim.api.nvim_buf_is_valid(state.buf) then
    vim.api.nvim_buf_delete(state.buf, { force = true })
  end
  state.win = nil
  state.buf = nil
  state.diagnostics = {}
end

-- Calculate optimal window position
local function get_window_position(width, height)
  local cursor = vim.api.nvim_win_get_cursor(0)
  local cursor_row = cursor[1]
  local cursor_col = cursor[2]

  local win_row = vim.fn.winline()
  local win_height = vim.api.nvim_win_get_height(0)
  local win_width = vim.api.nvim_win_get_width(0)

  -- Determine vertical position (above or below cursor)
  local row
  if win_row + height + 2 <= win_height then
    row = 1 -- Below cursor
  else
    row = -height - 2 -- Above cursor
  end

  -- Determine horizontal position
  local col = 0
  if cursor_col + width > win_width then
    col = win_width - width - 2
  end

  return row, col
end

-- Wrap text to fit width
local function wrap_text(text, width)
  local lines = {}
  local current_line = ""

  for word in text:gmatch("%S+") do
    if #current_line + #word + 1 <= width then
      current_line = current_line == "" and word or current_line .. " " .. word
    else
      if current_line ~= "" then
        table.insert(lines, current_line)
      end
      current_line = word
    end
  end

  if current_line ~= "" then
    table.insert(lines, current_line)
  end

  return lines
end

-- Build the float content
local function build_content(diagnostics)
  local lines = {}
  local highlights = {}
  local content_width = config.max_width - config.padding[2] * 2

  for i, diag in ipairs(diagnostics) do
    local sev = severity_config[diag.severity] or severity_config[vim.diagnostic.severity.INFO]

    -- Header line: icon + title + source
    local source = diag.source and (" (" .. diag.source .. ")") or ""
    local header = sev.icon .. sev.title .. source
    table.insert(lines, header)
    table.insert(highlights, {
      line = #lines - 1,
      col_start = 0,
      col_end = #header,
      hl = sev.hl,
    })

    -- Message lines (wrapped)
    local message_lines = wrap_text(diag.message, content_width - 2)
    for _, msg_line in ipairs(message_lines) do
      table.insert(lines, "  " .. msg_line)
    end

    -- Code if present
    if diag.code then
      local code_line = "  Code: " .. tostring(diag.code)
      table.insert(lines, code_line)
      table.insert(highlights, {
        line = #lines - 1,
        col_start = 2,
        col_end = 7,
        hl = "Comment",
      })
    end

    -- Add separator between diagnostics
    if i < #diagnostics then
      table.insert(lines, "")
      table.insert(lines, string.rep("─", content_width))
      table.insert(highlights, {
        line = #lines - 1,
        col_start = 0,
        col_end = -1,
        hl = "Comment",
      })
      table.insert(lines, "")
    end
  end

  return lines, highlights
end

-- Show diagnostics float
function M.show()
  -- Close existing float
  close_float()

  -- Get diagnostics for current line
  local cursor = vim.api.nvim_win_get_cursor(0)
  local line = cursor[1] - 1
  local diagnostics = vim.diagnostic.get(0, { lnum = line })

  if #diagnostics == 0 then
    vim.notify("No diagnostics on this line", vim.log.levels.INFO)
    return
  end

  -- Sort by severity (errors first)
  table.sort(diagnostics, function(a, b)
    return a.severity < b.severity
  end)

  state.diagnostics = diagnostics

  -- Build content
  local lines, highlights = build_content(diagnostics)

  -- Calculate dimensions
  local width = 0
  for _, line_text in ipairs(lines) do
    width = math.max(width, vim.fn.strdisplaywidth(line_text))
  end
  width = math.min(width + config.padding[2] * 2, config.max_width)
  local height = math.min(#lines, config.max_height)

  -- Create buffer
  state.buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(state.buf, 0, -1, false, lines)
  vim.bo[state.buf].modifiable = false
  vim.bo[state.buf].bufhidden = "wipe"
  vim.bo[state.buf].filetype = "diagnostics"

  -- Apply highlights (reuse cached namespace)
  local ns = M._ns or vim.api.nvim_create_namespace("fancy_diagnostics")
  M._ns = ns
  for _, hl in ipairs(highlights) do
    vim.api.nvim_buf_add_highlight(state.buf, ns, hl.hl, hl.line, hl.col_start, hl.col_end)
  end

  -- Calculate position
  local row, col = get_window_position(width, height)

  -- Get border highlight from most severe diagnostic
  local most_severe = diagnostics[1]
  local border_hl = severity_config[most_severe.severity].border_hl

  -- Create window
  state.win = vim.api.nvim_open_win(state.buf, false, {
    relative = "cursor",
    row = row,
    col = col,
    width = width,
    height = height,
    style = "minimal",
    border = config.border,
    title = " Diagnostics ",
    title_pos = "center",
  })

  -- Window options
  vim.wo[state.win].winblend = 0
  vim.wo[state.win].wrap = true
  vim.wo[state.win].linebreak = true

  -- Set border highlight
  vim.api.nvim_set_hl(0, "FloatBorder", { link = border_hl })

  -- Keymaps in float
  local opts = { buffer = state.buf, silent = true }

  -- Close on escape or q
  vim.keymap.set("n", "<Esc>", close_float, opts)
  vim.keymap.set("n", "q", close_float, opts)

  -- Jump to diagnostic location on enter
  vim.keymap.set("n", "<CR>", function()
    if #state.diagnostics > 0 then
      local diag = state.diagnostics[1]
      close_float()
      vim.api.nvim_win_set_cursor(0, { diag.lnum + 1, diag.col })
    end
  end, opts)

  -- Close when cursor moves
  vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI", "InsertEnter", "BufLeave" }, {
    buffer = vim.api.nvim_get_current_buf(),
    once = true,
    callback = close_float,
  })
end

-- Toggle diagnostics float
function M.toggle()
  if state.win and vim.api.nvim_win_is_valid(state.win) then
    close_float()
  else
    M.show()
  end
end

-- Setup function
function M.setup(opts)
  config = vim.tbl_deep_extend("force", config, opts or {})

  -- Set up keymap
  vim.keymap.set("n", config.keymap, M.show, { desc = "Show diagnostics float" })

  -- Define custom highlight groups
  vim.api.nvim_set_hl(0, "DiagnosticFloatBorder", { link = "FloatBorder" })
end

return M
