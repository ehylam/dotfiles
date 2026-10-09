local augroup = vim.api.nvim_create_augroup
local autocmd = vim.api.nvim_create_autocmd

-- Note: Yank highlighting is handled by yanky.nvim

-- Visible marks in sign column (cached + debounced)
local marks_ns = vim.api.nvim_create_namespace("visible_marks")
local marks_cache = {} -- bufnr -> { tick, marks_hash }
local marks_timer = vim.uv.new_timer()

local function update_marks()
	local bufnr = vim.api.nvim_get_current_buf()
	local bufname = vim.api.nvim_buf_get_name(bufnr)
	if bufname == "" then
		return
	end

	-- Skip if buffer hasn't changed since last update
	local tick = vim.api.nvim_buf_get_changedtick(bufnr)
	local cached = marks_cache[bufnr]
	local local_marks = vim.fn.getmarklist(bufnr)

	-- Build a simple hash to detect mark changes
	local hash = #local_marks
	for _, mark in ipairs(local_marks) do
		hash = hash + (mark.pos[2] or 0)
	end

	if cached and cached.tick == tick and cached.hash == hash then
		return
	end

	vim.api.nvim_buf_clear_namespace(bufnr, marks_ns, 0, -1)

	-- Add global marks matching this buffer
	local all_marks = local_marks
	local resolved = vim.fn.fnamemodify(bufname, ":p")
	for _, mark in ipairs(vim.fn.getmarklist()) do
		if mark.file and vim.fn.fnamemodify(mark.file, ":p") == resolved then
			all_marks[#all_marks + 1] = mark
		end
	end

	for _, mark in ipairs(all_marks) do
		local mark_char = mark.mark:sub(2, 2)
		if mark_char:match("[a-zA-Z]") and mark.pos[2] > 0 then
			pcall(vim.api.nvim_buf_set_extmark, bufnr, marks_ns, mark.pos[2] - 1, 0, {
				sign_text = mark_char,
				sign_hl_group = "DiagnosticSignHint",
				priority = 10,
			})
		end
	end

	marks_cache[bufnr] = { tick = tick, hash = hash }
end

-- Debounced update: coalesce rapid CursorHold/BufEnter events
local function update_marks_debounced()
	marks_timer:stop()
	marks_timer:start(50, 0, vim.schedule_wrap(update_marks))
end

autocmd({ "BufEnter", "CursorHold" }, {
	group = augroup("visible_marks", { clear = true }),
	callback = update_marks_debounced,
})

-- Clean up cache when buffers are deleted
autocmd("BufDelete", {
	group = augroup("visible_marks_cleanup", { clear = true }),
	callback = function(args)
		marks_cache[args.buf] = nil
	end,
})

-- Override m to update marks after setting (immediate, no debounce needed)
vim.keymap.set("n", "m", function()
	local char = vim.fn.nr2char(vim.fn.getchar())
	vim.cmd("normal! m" .. char)
	vim.defer_fn(update_marks, 10)
end, { desc = "Set mark and update display" })

-- Disable diagnostics in node_modules
autocmd({ "BufRead", "BufNewFile" }, {
	group = augroup("disable_node_modules_diagnostics", { clear = true }),
	pattern = "*/node_modules/*",
	callback = function()
		vim.diagnostic.enable(false, { bufnr = 0 })
	end,
})

-- Return to last edit position
autocmd("BufReadPost", {
	group = augroup("last_location", { clear = true }),
	callback = function(args)
		local exclude = { "gitcommit", "gitrebase", "help" }
		if vim.tbl_contains(exclude, vim.bo[args.buf].filetype) then
			return
		end
		local mark = vim.api.nvim_buf_get_mark(args.buf, '"')
		if mark[1] > 0 and mark[1] <= vim.api.nvim_buf_line_count(args.buf) then
			pcall(vim.api.nvim_win_set_cursor, 0, mark)
		end
	end,
})

-- Close certain filetypes with <q>
autocmd("FileType", {
	group = augroup("close_with_q", { clear = true }),
	pattern = {
		"checkhealth",
		"git",
		"help",
		"lspinfo",
		"man",
		"notify",
		"qf",
		"query",
		"scratch",
		"startuptime",
	},
	callback = function(args)
		vim.bo[args.buf].buflisted = false
		vim.keymap.set("n", "q", "<cmd>close<cr>", { buffer = args.buf, silent = true })
	end,
})

-- Toggle relative line numbers based on focus
autocmd({ "WinEnter", "BufEnter", "FocusGained", "InsertLeave" }, {
	group = augroup("toggle_line_numbers", { clear = true }),
	callback = function()
		if vim.wo.number then
			vim.wo.relativenumber = true
		end
	end,
})

autocmd({ "WinLeave", "BufLeave", "FocusLost", "InsertEnter" }, {
	group = augroup("toggle_line_numbers", { clear = false }),
	callback = function()
		if vim.wo.number then
			vim.wo.relativenumber = false
		end
	end,
})

-- Auto-resize splits when window is resized
autocmd("VimResized", {
	group = augroup("resize_splits", { clear = true }),
	callback = function()
		local current_tab = vim.fn.tabpagenr()
		vim.cmd("tabdo wincmd =")
		vim.cmd("tabnext " .. current_tab)
	end,
})

-- Disable line numbers in terminal/special buffers
autocmd("BufEnter", {
	group = augroup("special_buffers", { clear = true }),
	pattern = { "copilot-*", "term://*" },
	callback = function()
		vim.opt_local.relativenumber = false
		vim.opt_local.number = false
	end,
})

-- Check for file changes when focusing (pair with autoread)
autocmd({ "FocusGained", "TermClose", "TermLeave" }, {
	group = augroup("checktime", { clear = true }),
	callback = function()
		if vim.o.buftype ~= "nofile" then
			vim.cmd("checktime")
		end
	end,
})

-- Treesitter folding (enable after buffer loads)
-- Note: snacks.bigfile handles disabling treesitter for large files
-- The per-filetype opt-out list here is gone as of 2026-08-14; see the note in
-- plugin/treesitter.lua. start() is pcall'd, so filetypes with no parser just skip folding.
autocmd("FileType", {
	group = augroup("treesitter_folding", { clear = true }),
	callback = function(args)
		local ok = pcall(vim.treesitter.start, args.buf)
		if ok then
			vim.wo.foldmethod = "expr"
			vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
		end
	end,
})

-- Fancy diagnostics float (press D to show)
require("ui.diagnostics").setup({
	keymap = "D",
	max_width = 60,
	max_height = 15,
	border = vim.g.border_style or "rounded",
})
