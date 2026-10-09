-- In-process TODO/FIXME/HACK LSP
-- Provides diagnostics for TODO comments and code actions to manage them

local ms = vim.lsp.protocol.Methods

local M = {}

-- TODO patterns with their diagnostic severity
local todo_patterns = {
  { pattern = "TODO", severity = vim.diagnostic.severity.INFO, icon = "󰄱" },
  { pattern = "FIXME", severity = vim.diagnostic.severity.WARN, icon = "" },
  { pattern = "HACK", severity = vim.diagnostic.severity.WARN, icon = "" },
  { pattern = "BUG", severity = vim.diagnostic.severity.ERROR, icon = "" },
  { pattern = "XXX", severity = vim.diagnostic.severity.WARN, icon = "󰀨" },
  { pattern = "NOTE", severity = vim.diagnostic.severity.HINT, icon = "󰍨" },
  { pattern = "PERF", severity = vim.diagnostic.severity.HINT, icon = "󰅒" },
  { pattern = "OPTIM", severity = vim.diagnostic.severity.HINT, icon = "󰅒" },
  { pattern = "WARN", severity = vim.diagnostic.severity.WARN, icon = "" },
}

-- State
local state = {
  diagnostics = {}, -- bufnr -> diagnostics
}

local namespace = vim.api.nvim_create_namespace("todo-lsp")

-- Scan buffer for TODO comments
local function scan_buffer(bufnr)
  local diagnostics = {}
  local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)

  for lnum, line in ipairs(lines) do
    for _, todo in ipairs(todo_patterns) do
      -- Match pattern with optional colon and message
      local start_col, end_col, message = line:find(todo.pattern .. ":?%s*(.*)")
      if not start_col then
        -- Try uppercase pattern in comment
        start_col, end_col, message = line:find("%-%-%s*" .. todo.pattern .. ":?%s*(.*)")
      end
      if not start_col then
        start_col, end_col, message = line:find("//.-" .. todo.pattern .. ":?%s*(.*)")
      end
      if not start_col then
        start_col, end_col, message = line:find("#.-" .. todo.pattern .. ":?%s*(.*)")
      end

      if start_col then
        local display_msg = todo.pattern
        if message and #message > 0 then
          display_msg = todo.pattern .. ": " .. message
        end

        table.insert(diagnostics, {
          lnum = lnum - 1, -- 0-indexed
          col = start_col - 1,
          end_col = end_col,
          severity = todo.severity,
          message = display_msg,
          source = "todo-lsp",
          code = todo.pattern,
        })
        break -- Only one match per line
      end
    end
  end

  return diagnostics
end

-- Publish diagnostics for a buffer
local function publish_diagnostics(bufnr)
  local diagnostics = scan_buffer(bufnr)
  state.diagnostics[bufnr] = diagnostics
  vim.diagnostic.set(namespace, bufnr, diagnostics)
end

function M.create_client()
  local handlers = {}
  local attached_buffers = {}

  -- Initialize
  handlers[ms.initialize] = function(_, callback)
    callback(nil, {
      capabilities = {
        textDocumentSync = {
          openClose = true,
          change = 1, -- Full sync
        },
        codeActionProvider = true,
        executeCommandProvider = {
          commands = {
            "todo.resolve",
            "todo.convert",
            "todo.delete",
          },
        },
      },
    })
  end

  -- Document opened
  handlers[ms.textDocument_didOpen] = function(params, _)
    local uri = params.textDocument.uri
    local bufnr = vim.uri_to_bufnr(uri)
    attached_buffers[bufnr] = true
    publish_diagnostics(bufnr)

    -- Set up autocmd for changes
    vim.api.nvim_create_autocmd({ "TextChanged", "TextChangedI" }, {
      buffer = bufnr,
      callback = function()
        if attached_buffers[bufnr] then
          publish_diagnostics(bufnr)
        end
      end,
    })
  end

  -- Document changed
  handlers[ms.textDocument_didChange] = function(params, _)
    local uri = params.textDocument.uri
    local bufnr = vim.uri_to_bufnr(uri)
    publish_diagnostics(bufnr)
  end

  -- Document closed
  handlers[ms.textDocument_didClose] = function(params, _)
    local uri = params.textDocument.uri
    local bufnr = vim.uri_to_bufnr(uri)
    attached_buffers[bufnr] = nil
    vim.diagnostic.reset(namespace, bufnr)
  end

  -- Code Actions
  handlers[ms.textDocument_codeAction] = function(params, callback)
    local uri = params.textDocument.uri
    local bufnr = vim.uri_to_bufnr(uri)
    local range = params.range
    local line = range.start.line

    local actions = {}
    local diagnostics = state.diagnostics[bufnr] or {}

    -- Find TODOs on the current line
    for _, diag in ipairs(diagnostics) do
      if diag.lnum == line then
        -- Mark as done (convert to DONE)
        table.insert(actions, {
          title = "Mark as DONE: " .. diag.code,
          kind = "quickfix",
          command = {
            title = "Mark as done",
            command = "todo.resolve",
            arguments = { bufnr, diag.lnum, diag.code },
          },
        })

        -- Convert to different type
        for _, todo in ipairs(todo_patterns) do
          if todo.pattern ~= diag.code then
            table.insert(actions, {
              title = "Convert to " .. todo.pattern,
              kind = "refactor",
              command = {
                title = "Convert",
                command = "todo.convert",
                arguments = { bufnr, diag.lnum, diag.code, todo.pattern },
              },
            })
          end
        end

        -- Delete the comment line
        table.insert(actions, {
          title = "Delete comment line",
          kind = "quickfix",
          command = {
            title = "Delete",
            command = "todo.delete",
            arguments = { bufnr, diag.lnum },
          },
        })
      end
    end

    callback(nil, actions)
  end

  -- Execute commands
  handlers[ms.workspace_executeCommand] = function(params, callback)
    local cmd = params.command
    local args = params.arguments or {}

    if cmd == "todo.resolve" then
      local bufnr, lnum, pattern = args[1], args[2], args[3]
      local line = vim.api.nvim_buf_get_lines(bufnr, lnum, lnum + 1, false)[1]
      if line then
        local new_line = line:gsub(pattern, "DONE")
        vim.api.nvim_buf_set_lines(bufnr, lnum, lnum + 1, false, { new_line })
        vim.notify("Marked as DONE", vim.log.levels.INFO)
      end
    elseif cmd == "todo.convert" then
      local bufnr, lnum, old_pattern, new_pattern = args[1], args[2], args[3], args[4]
      local line = vim.api.nvim_buf_get_lines(bufnr, lnum, lnum + 1, false)[1]
      if line then
        local new_line = line:gsub(old_pattern, new_pattern)
        vim.api.nvim_buf_set_lines(bufnr, lnum, lnum + 1, false, { new_line })
        vim.notify("Converted to " .. new_pattern, vim.log.levels.INFO)
      end
    elseif cmd == "todo.delete" then
      local bufnr, lnum = args[1], args[2]
      vim.api.nvim_buf_set_lines(bufnr, lnum, lnum + 1, false, {})
      vim.notify("Deleted comment line", vim.log.levels.INFO)
    end

    callback(nil, {})
  end

  -- Shutdown
  handlers[ms.shutdown] = function(_, callback)
    callback(nil, nil)
  end

  return {
    request = function(method, params, callback)
      local handler = handlers[method]
      if handler then
        handler(params, callback)
      else
        callback(nil, nil)
      end
    end,
    notify = function(method, params)
      local handler = handlers[method]
      if handler then
        handler(params, function() end)
      end
    end,
    is_closing = function()
      return false
    end,
    terminate = function() end,
  }
end

function M.setup()
  vim.api.nvim_create_autocmd("FileType", {
    pattern = {
      "lua",
      "javascript",
      "typescript",
      "javascriptreact",
      "typescriptreact",
      "python",
      "go",
      "rust",
      "c",
      "cpp",
      "java",
      "sh",
      "bash",
      "zsh",
      "vim",
    },
    callback = function(args)
      vim.lsp.start({
        name = "todo-lsp",
        cmd = M.create_client,
        root_dir = vim.fn.getcwd(),
      }, {
        bufnr = args.buf,
      })
    end,
  })
end

return M
