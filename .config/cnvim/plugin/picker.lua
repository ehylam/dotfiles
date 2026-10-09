vim.pack.add({
	"https://github.com/ibhagwan/fzf-lua",
	"https://github.com/nvim-tree/nvim-web-devicons",
})

if #vim.api.nvim_list_uis() == 0 then
	return
end

require("fzf-lua").setup({
	"default-title",
	fzf_colors = true,
	fzf_opts = {
		["--no-scrollbar"] = true,
	},
	previewers = {
		builtin = {
			treesitter = { enabled = false },
		},
	},
	defaults = {
		formatter = "path.dirname_first",
	},
	winopts = {
		width = 0.85,
		height = 0.80,
		row = 0.5,
		col = 0.5,
		preview = {
			scrollchars = { "┃", "" },
			layout = "vertical",
			vertical = "down:45%",
		},
	},
	files = {
		cwd_prompt = false,
		actions = {
			["alt-i"] = function()
				require("fzf-lua.actions").toggle_ignore()
			end,
			["alt-h"] = function()
				require("fzf-lua.actions").toggle_hidden()
			end,
		},
	},
	grep = {
		actions = {
			["alt-i"] = function()
				require("fzf-lua.actions").toggle_ignore()
			end,
			["alt-h"] = function()
				require("fzf-lua.actions").toggle_hidden()
			end,
		},
	},
	lsp = {
		symbols = {
			symbol_hl = function(s)
				return "TroubleIcon" .. s
			end,
			symbol_fmt = function(s)
				return s:lower() .. "\t"
			end,
			child_prefix = false,
		},
		code_actions = {
			previewer = vim.fn.executable("delta") == 1 and "codeaction_native" or nil,
		},
	},
})

local map = vim.keymap.set

-- File pickers
map("n", "<leader><space>", "<cmd>FzfLua files<cr>", { desc = "Find files" })
map("n", "<leader>,", "<cmd>FzfLua buffers<cr>", { desc = "Buffers" })
map("n", "<leader>/", "<cmd>FzfLua live_grep<cr>", { desc = "Grep" })
map("n", "<leader>:", "<cmd>FzfLua command_history<cr>", { desc = "Command history" })

-- Find
map("n", "<leader>fb", "<cmd>FzfLua buffers<cr>", { desc = "Buffers" })
map("n", "<leader>fc", function()
	require("fzf-lua").files({ cwd = vim.fn.stdpath("config") })
end, { desc = "Find config file" })
map("n", "<leader>ff", "<cmd>FzfLua files<cr>", { desc = "Find files" })
map("n", "<leader>fg", "<cmd>FzfLua git_files<cr>", { desc = "Find git files" })
map("n", "<leader>fr", "<cmd>FzfLua oldfiles<cr>", { desc = "Recent files" })

-- Git
map("n", "<leader>gB", "<cmd>FzfLua git_branches<cr>", { desc = "Git branches" })
map("n", "<leader>gl", "<cmd>FzfLua git_commits<cr>", { desc = "Git log" })
map("n", "<leader>gL", "<cmd>FzfLua git_bcommits<cr>", { desc = "Git log (buffer)" })
map("n", "<leader>gst", "<cmd>FzfLua git_status<cr>", { desc = "Git status" })
map("n", "<leader>gsa", "<cmd>FzfLua git_stash<cr>", { desc = "Git stash" })

-- Search
map("n", "<leader>sb", "<cmd>FzfLua lgrep_curbuf<cr>", { desc = "Buffer lines" })
map("n", "<leader>sB", "<cmd>FzfLua grep_curbuf<cr>", { desc = "Grep current buffer" })
map("n", "<leader>sg", "<cmd>FzfLua live_grep<cr>", { desc = "Grep" })
map("n", "<leader>sw", "<cmd>FzfLua grep_cword<cr>", { desc = "Grep word under cursor" })
map("n", "<leader>sW", "<cmd>FzfLua grep_cWORD<cr>", { desc = "Grep WORD under cursor" })
map("n", "<leader>s/", "<cmd>FzfLua search_history<cr>", { desc = "Search history" })
map("n", '<leader>s"', "<cmd>FzfLua registers<cr>", { desc = "Registers" })
map("n", "<leader>sa", "<cmd>FzfLua autocmds<cr>", { desc = "Autocmds" })
map("n", "<leader>sc", "<cmd>FzfLua command_history<cr>", { desc = "Command history" })
map("n", "<leader>sC", "<cmd>FzfLua commands<cr>", { desc = "Commands" })
map("n", "<leader>sd", "<cmd>FzfLua diagnostics_workspace<cr>", { desc = "Diagnostics" })
map("n", "<leader>sD", "<cmd>FzfLua diagnostics_document<cr>", { desc = "Buffer diagnostics" })
map("n", "<leader>sh", "<cmd>FzfLua help_tags<cr>", { desc = "Help" })
map("n", "<leader>sH", "<cmd>FzfLua highlights<cr>", { desc = "Highlights" })
map("n", "<leader>sj", "<cmd>FzfLua jumps<cr>", { desc = "Jumps" })
map("n", "<leader>sk", "<cmd>FzfLua keymaps<cr>", { desc = "Keymaps" })
map("n", "<leader>sl", "<cmd>FzfLua loclist<cr>", { desc = "Location list" })
map("n", "<leader>sm", "<cmd>FzfLua marks<cr>", { desc = "Marks" })
map("n", "<leader>sM", "<cmd>FzfLua man_pages<cr>", { desc = "Man pages" })
map("n", "<leader>sq", "<cmd>FzfLua quickfix<cr>", { desc = "Quickfix list" })
map("n", "<leader>sR", "<cmd>FzfLua resume<cr>", { desc = "Resume" })
map("n", "<leader>uC", "<cmd>FzfLua colorschemes<cr>", { desc = "Colorschemes" })

-- LSP
map("n", "gd", "<cmd>FzfLua lsp_definitions<cr>", { desc = "Goto definition" })
map("n", "gD", "<cmd>FzfLua lsp_declarations<cr>", { desc = "Goto declaration" })
map("n", "gr", "<cmd>FzfLua lsp_references<cr>", { desc = "References" })
map("n", "gI", "<cmd>FzfLua lsp_implementations<cr>", { desc = "Goto implementation" })
map("n", "gy", "<cmd>FzfLua lsp_typedefs<cr>", { desc = "Goto type definition" })
map("n", "<leader>ss", "<cmd>FzfLua lsp_document_symbols<cr>", { desc = "Document symbols" })
map("n", "<leader>sS", "<cmd>FzfLua lsp_workspace_symbols<cr>", { desc = "Workspace symbols" })
