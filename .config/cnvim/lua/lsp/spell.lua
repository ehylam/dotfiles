-- In-process Spell/Dictionary LSP
-- Provides hover definitions, diagnostics for misspelled words,
-- and code actions to add words to dictionary

local ms = vim.lsp.protocol.Methods

local M = {}

-- State per buffer
local state = {}
local definition_cache = {}

local function get_buf_state(bufnr)
  if not state[bufnr] then
    state[bufnr] = {
      local_spellfile = vim.fn.stdpath("config") .. "/spell/local.utf-8.add",
    }
    -- Ensure spell directory exists
    vim.fn.mkdir(vim.fn.stdpath("config") .. "/spell", "p")
  end
  return state[bufnr]
end

local function parse_definition(stdout)
  local lines = {}
  for line in stdout:gmatch("[^\r\n]+") do
    if not line:match("^%d%d%d ") and #line > 0 then
      table.insert(lines, line)
      if #lines >= 20 then
        break
      end
    end
  end
  return #lines > 0 and table.concat(lines, "\n") or nil
end

-- Fetch word definitions only when explicitly enabled. This keeps hover local
-- by default and avoids blocking Neovim on remote dictionary lookups.
local function get_definition(word, callback)
  if vim.g.cnvim_spell_remote_definitions ~= true then
    return callback(nil)
  end

  if definition_cache[word] ~= nil then
    return callback(definition_cache[word] or nil)
  end

  vim.system({ "curl", "--max-time", "2", "-sS", "dict://dict.org/d:" .. word }, { text = true, timeout = 2500 }, function(result)
    local def
    if result.code == 0 and result.stdout and #result.stdout > 0 and not result.stdout:match("no match") then
      def = parse_definition(result.stdout)
    end
    definition_cache[word] = def or false
    vim.schedule(function()
      callback(def)
    end)
  end)
end

-- Check if word is misspelled
local function is_misspelled(word)
  if not vim.wo.spell then
    return false
  end
  local result = vim.fn.spellbadword(word)
  return result[1] ~= ""
end

-- Get spelling suggestions
local function get_suggestions(word)
  return vim.fn.spellsuggest(word, 5)
end

function M.create_client()
  local handlers = {}

  -- Initialize
  handlers[ms.initialize] = function(_, callback)
    callback(nil, {
      capabilities = {
        hoverProvider = true,
        codeActionProvider = true,
        executeCommandProvider = {
          commands = {
            "spell.addToGlobal",
            "spell.addToLocal",
            "spell.replaceWith",
          },
        },
      },
    })
  end

  -- Hover: show definition
  handlers[ms.textDocument_hover] = function(_, callback)
    local word = vim.fn.expand("<cword>")
    if not word or #word == 0 then
      return callback(nil, nil)
    end

    local contents = {}

    -- Check spelling status
    if is_misspelled(word) then
      table.insert(contents, "⚠️ **Misspelled**: `" .. word .. "`\n")
      local suggestions = get_suggestions(word)
      if #suggestions > 0 then
        table.insert(contents, "**Suggestions**: " .. table.concat(suggestions, ", ") .. "\n")
      end
    end

    get_definition(word, function(def)
      if def then
        table.insert(contents, "---\n")
        table.insert(contents, def)
      elseif #contents == 0 then
        table.insert(contents, "No spelling issue found for: `" .. word .. "`")
      end

      callback(nil, {
        contents = {
          kind = "markdown",
          value = table.concat(contents, "\n"),
        },
      })
    end)
  end

  -- Code Actions: add to dictionary, replace with suggestion
  handlers[ms.textDocument_codeAction] = function(params, callback)
    local word = vim.fn.expand("<cword>")
    if not word or #word == 0 or not is_misspelled(word) then
      return callback(nil, {})
    end

    local actions = {}

    -- Add to global dictionary
    table.insert(actions, {
      title = "Add '" .. word .. "' to global dictionary",
      kind = "quickfix",
      command = {
        title = "Add to global dictionary",
        command = "spell.addToGlobal",
        arguments = { word },
      },
    })

    -- Add to local dictionary
    table.insert(actions, {
      title = "Add '" .. word .. "' to local dictionary",
      kind = "quickfix",
      command = {
        title = "Add to local dictionary",
        command = "spell.addToLocal",
        arguments = { word },
      },
    })

    -- Replacement suggestions
    local suggestions = get_suggestions(word)
    for _, suggestion in ipairs(suggestions) do
      table.insert(actions, {
        title = "Replace with '" .. suggestion .. "'",
        kind = "quickfix",
        command = {
          title = "Replace",
          command = "spell.replaceWith",
          arguments = { word, suggestion },
        },
      })
    end

    callback(nil, actions)
  end

  -- Execute commands
  handlers[ms.workspace_executeCommand] = function(params, callback)
    local cmd = params.command
    local args = params.arguments or {}

    if cmd == "spell.addToGlobal" then
      local word = args[1]
      if word then
        vim.cmd("spellgood " .. word)
        vim.notify("Added '" .. word .. "' to global dictionary", vim.log.levels.INFO)
      end
    elseif cmd == "spell.addToLocal" then
      local word = args[1]
      if word then
        local buf_state = get_buf_state(vim.api.nvim_get_current_buf())
        local file = io.open(buf_state.local_spellfile, "a")
        if file then
          file:write(word .. "\n")
          file:close()
          vim.cmd("mkspell! " .. buf_state.local_spellfile)
          vim.notify("Added '" .. word .. "' to local dictionary", vim.log.levels.INFO)
        end
      end
    elseif cmd == "spell.replaceWith" then
      local old_word = args[1]
      local new_word = args[2]
      if old_word and new_word then
        -- Replace word under cursor
        vim.cmd("normal! ciw" .. new_word)
        vim.notify("Replaced '" .. old_word .. "' with '" .. new_word .. "'", vim.log.levels.INFO)
      end
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
    notify = function() end,
    is_closing = function()
      return false
    end,
    terminate = function() end,
  }
end

function M.setup()
  vim.api.nvim_create_autocmd("FileType", {
    pattern = { "markdown", "text", "gitcommit", "mail" },
    callback = function(args)
      vim.lsp.start({
        name = "spell-lsp",
        cmd = M.create_client,
        root_dir = vim.fn.getcwd(),
      }, {
        bufnr = args.buf,
      })
    end,
  })
end

return M
