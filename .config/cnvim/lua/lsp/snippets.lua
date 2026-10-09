-- In-process snippet LSP
-- Serves the VSCode-format JSON in ~/.config/cnvim/snippets/ to native completion.
-- <filetype>.json applies to that filetype; global.json applies everywhere.

local ms = vim.lsp.protocol.Methods

local M = {}

local snippets_dir = vim.fs.joinpath(vim.fn.stdpath("config"), "snippets")

-- filetype -> completion items, built once on first use
local cache = {}

-- VSCode snippet bodies are either a string or an array of lines
local function body_to_text(body)
  return type(body) == "table" and table.concat(body, "\n") or body
end

local function read_file(path)
  local ok, content = pcall(function()
    return assert(io.open(path, "r")):read("*a")
  end)
  if not ok then
    return nil
  end
  local decoded_ok, decoded = pcall(vim.json.decode, content)
  return decoded_ok and decoded or nil
end

-- Turn one JSON file into LSP completion items
local function items_from_file(path)
  local parsed = read_file(path)
  if not parsed then
    vim.notify("snippets-lsp: could not parse " .. path, vim.log.levels.WARN)
    return {}
  end

  local items = {}
  for name, snippet in pairs(parsed) do
    local prefixes = snippet.prefix
    if type(prefixes) == "string" then
      prefixes = { prefixes }
    end
    local text = body_to_text(snippet.body)
    for _, prefix in ipairs(prefixes or {}) do
      table.insert(items, {
        label = prefix,
        kind = vim.lsp.protocol.CompletionItemKind.Snippet,
        detail = name,
        insertText = text,
        insertTextFormat = vim.lsp.protocol.InsertTextFormat.Snippet,
        documentation = { kind = "markdown", value = "```\n" .. text .. "\n```" },
      })
    end
  end
  return items
end

local function items_for(ft)
  if cache[ft] then
    return cache[ft]
  end

  local items = {}
  for _, name in ipairs({ "global", ft }) do
    local path = vim.fs.joinpath(snippets_dir, name .. ".json")
    if vim.uv.fs_stat(path) then
      vim.list_extend(items, items_from_file(path))
    end
  end

  cache[ft] = items
  return items
end

local function create_client(ft)
  local handlers = {}

  handlers[ms.initialize] = function(_, callback)
    callback(nil, { capabilities = { completionProvider = {} } })
  end

  handlers[ms.textDocument_completion] = function(_, callback)
    callback(nil, { isIncomplete = false, items = items_for(ft) })
  end

  handlers[ms.shutdown] = function(_, callback)
    callback(nil, nil)
  end

  return function()
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
end

-- Which filetypes have a <filetype>.json (global.json rides along with each)
local function snippet_filetypes()
  local fts = {}
  for name, kind in vim.fs.dir(snippets_dir) do
    local ft = kind == "file" and name:match("^(.+)%.json$")
    if ft and ft ~= "global" then
      table.insert(fts, ft)
    end
  end
  return fts
end

function M.setup()
  if not vim.uv.fs_stat(snippets_dir) then
    return
  end

  vim.api.nvim_create_autocmd("FileType", {
    pattern = snippet_filetypes(),
    callback = function(args)
      local ft = vim.bo[args.buf].filetype
      vim.lsp.start({
        -- Per-filetype name so vim.lsp.start does not reuse another filetype's client
        name = "snippets-lsp-" .. ft,
        cmd = create_client(ft),
        root_dir = vim.fn.getcwd(),
      }, { bufnr = args.buf })
    end,
  })
end

return M
