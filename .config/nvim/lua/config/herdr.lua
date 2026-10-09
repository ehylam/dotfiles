-- Herdr actions for the <leader>m target maps.
-- Wiremux supplies backend-independent context placeholders such as {file},
-- {selection} and {diagnostics}. Agent routing and pane control use Herdr only.

local M = {}

-- Set by herdr in every managed pane, alongside HERDR_WORKSPACE_ID / _TAB_ID / _PANE_ID.
function M.active()
  return vim.env.HERDR_ENV == "1"
end

-- Split right off a wide editor, down for a short-lived shell, per herdr's own
-- geometry guidance. Avoids the unusably narrow columns that repeated
-- same-direction splits produce.
local targets = {
  -- fnm exec --using=default pins the agent to the default Node (v22) regardless of
  -- the repo Node version inherited by the workspace. Node 18 kills the MCP servers:
  -- chrome-devtools and playwright reject it outright, and undici throws
  -- "ReferenceError: File is not defined" (File became a global in Node 20).
  -- Scoped to the agent command, so dev-server panes keep the repo Node.
  claude = { cmd = "fnm exec --using=default claude", direction = "right" },
  codex = { cmd = "fnm exec --using=default codex", direction = "right" },
  opencode = { cmd = "fnm exec --using=default opencode", direction = "right" },
  shell = { cmd = nil, direction = "down" },
}

local function herdr(args)
  local out = vim.fn.system(vim.list_extend({ "herdr" }, args))
  if vim.v.shell_error ~= 0 then
    vim.notify("herdr: " .. out, vim.log.levels.ERROR)
    return nil
  end
  -- Fire-and-forget commands such as pane run exit 0 with no output.
  if vim.trim(out) == "" then
    return { result = {} }
  end
  local ok, decoded = pcall(vim.json.decode, out)
  if not ok or type(decoded) ~= "table" or not decoded.result then
    vim.notify("herdr: invalid CLI response", vim.log.levels.ERROR)
    return nil
  end
  return decoded
end

---Live agents in this nvim's own workspace. Agents elsewhere belong to another
---task, and sending this buffer to them is never what <leader>ms meant.
---@return table[]
local function agents()
  local res = herdr({ "agent", "list" })
  local all = vim.tbl_get(res or {}, "result", "agents") or {}
  local ws = vim.env.HERDR_WORKSPACE_ID
  if not ws or ws == "" then
    vim.notify("herdr: current workspace is unavailable", vim.log.levels.ERROR)
    return {}
  end
  return vim.tbl_filter(function(a)
    return a.workspace_id == ws
  end, all)
end

---@param cb fun(agent: table)
local function with_target(cb)
  local live = agents()
  if #live == 0 then
    vim.notify("herdr: no agent in this workspace, <leader>mc first", vim.log.levels.WARN)
    return
  end
  if #live == 1 then
    return cb(live[1])
  end
  local labels = vim.tbl_map(function(a)
    return ("%s  %s  %s"):format(a.pane_id, a.agent, a.agent_status)
  end, live)
  vim.ui.select(labels, { prompt = "herdr agent" }, function(_, idx)
    if idx then
      cb(live[idx])
    end
  end)
end

function M.create()
  local names = vim.tbl_keys(targets)
  table.sort(names)
  vim.ui.select(names, { prompt = "herdr target" }, function(choice)
    if not choice then
      return
    end
    local def = targets[choice]
    -- --current targets the pane nvim itself is running in, rather than whichever
    -- pane some other herdr client happens to have focused.
    local res = herdr({
      "pane", "split", "--current",
      "--direction", def.direction,
      "--cwd", vim.fn.getcwd(),
      "--focus",
    })
    local pane = vim.tbl_get(res or {}, "result", "pane", "pane_id")
    if not pane then
      vim.notify("herdr: split returned no pane id", vim.log.levels.ERROR)
      return
    end
    if def.cmd then
      -- Keep shell quoting intact; pane run accepts the complete command text.
      if not herdr({ "pane", "run", pane, def.cmd }) then
        return
      end
    end
    vim.notify("herdr: " .. choice .. " in " .. pane)
  end)
end

---@param text string may contain wiremux placeholders
---@param opts? table { focus = boolean }
function M.send(text, opts)
  opts = opts or {}
  -- <leader>mp passes a list of { label, value } prompts rather than one string.
  if type(text) == "table" then
    local labels = vim.tbl_map(function(item)
      return item.label or item.value
    end, text)
    vim.ui.select(labels, { prompt = "herdr prompt" }, function(_, idx)
      if idx then
        M.send(text[idx].value, opts)
      end
    end)
    return
  end
  local ok, ctx = pcall(require, "wiremux.context")
  if ok then
    text = ctx.expand(text, ctx.snapshot(text))
  end
  if not text or text == "" then
    return
  end
  with_target(function(agent)
    -- agent prompt honours the pane's live bracketed-paste mode and sends the
    -- encoded Enter itself, so quotes, $VAR and backticks arrive literal.
    -- No --wait: nvim must not block while the agent thinks.
    if not herdr({ "agent", "prompt", agent.pane_id, text }) then
      return
    end
    if opts.focus then
      herdr({ "agent", "focus", agent.pane_id })
    end
  end)
end

function M.focus()
  with_target(function(agent)
    herdr({ "agent", "focus", agent.pane_id })
  end)
end

-- ponytail: toggle is focus-or-create; return to the editor with native pane navigation.
function M.toggle()
  if #agents() == 0 then
    return M.create()
  end
  return M.focus()
end

-- Standard operatorfunc plumbing. wiremux's own send_motion ends in a call to its
-- backend, so it cannot be reused without patching the plugin; this is the same
-- 25 lines pointed at M.send instead.
local motion_opts = nil

function M.operator(motion_type)
  local start_mark, end_mark
  if motion_type == "v" or motion_type == "V" or motion_type == "\22" then
    start_mark, end_mark = "<", ">"
  else
    start_mark, end_mark = "[", "]"
  end

  local start = vim.api.nvim_buf_get_mark(0, start_mark)
  local finish = vim.api.nvim_buf_get_mark(0, end_mark)
  local lines = vim.api.nvim_buf_get_lines(0, start[1] - 1, finish[1], false)
  if #lines == 0 then
    motion_opts = nil
    return
  end

  if #lines == 1 then
    lines[1] = lines[1]:sub(start[2] + 1, finish[2] + 1)
  else
    lines[1] = lines[1]:sub(start[2] + 1)
    lines[#lines] = lines[#lines]:sub(1, finish[2] + 1)
  end

  local text = table.concat(lines, "\n")
  if text ~= "" then
    M.send(text, motion_opts)
  end
  motion_opts = nil
end

function M.send_motion(opts)
  motion_opts = opts
  vim.opt.operatorfunc = "v:lua.require'config.herdr'.operator"
  return "g@"
end

-- Move inside Neovim when a split exists, otherwise focus the adjacent Herdr pane.
local dirs = { h = "left", j = "down", k = "up", l = "right" }

function M.navigate(key)
  local from = vim.api.nvim_get_current_win()
  vim.cmd.wincmd(key)
  if vim.api.nvim_get_current_win() ~= from then
    return -- moved within nvim, nothing for herdr to do
  end
  herdr({ "pane", "focus", "--current", "--direction", dirs[key] })
end

---Run AI pane actions in Herdr; never launch a different multiplexer.
---@param action string name on both this module and wiremux
---@return function
function M.route(action, ...)
  local args = { ... }
  return function()
    if M.active() then
      return M[action](unpack(args))
    end
    vim.notify("Open this editor inside Herdr to use AI pane actions", vim.log.levels.WARN)
  end
end

return M
