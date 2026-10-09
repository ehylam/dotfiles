vim.pack.add({
	"https://github.com/folke/snacks.nvim",
})

Snacks.setup({
	bigfile = { enabled = true, size = 200 * 1024 },
	explorer = { enabled = true },
	image = { enabled = false },
	picker = { enabled = true, ui_select = true }, -- File search mappings still use fzf-lua
	profiler = { enabled = false },
	quickfile = { enabled = true, exclude = { "latex", "liquid", "markdown", "sshconfig", "sshdconfig", "yaml" } },
	scope = { enabled = false },
	statuscolumn = { enabled = false },
	words = { enabled = true },

	animate = {
		enabled = true,
		duration = 20,
		easing = "linear",
		fps = 60,
	},

	dashboard = {
		enabled = true,
		preset = {
			keys = {
				{ icon = " ", key = "f", desc = "Find File", action = "<cmd>FzfLua files<cr>" },
				{ icon = " ", key = "n", desc = "New File", action = ":ene | startinsert" },
				{ icon = " ", key = "g", desc = "Find Text", action = "<cmd>FzfLua live_grep<cr>" },
				{ icon = " ", key = "r", desc = "Recent Files", action = "<cmd>FzfLua oldfiles<cr>" },
				{
					icon = " ",
					key = "c",
					desc = "Config",
					action = function()
						require("fzf-lua").files({ cwd = vim.fn.stdpath("config") })
					end,
				},
				{ icon = " ", key = "q", desc = "Quit", action = ":qa" },
			},
		},
		sections = {
			{ section = "header" },
			{ icon = " ", title = "Keymaps", section = "keys", padding = 1 },
			{ icon = " ", title = "Recent Files", section = "recent_files", padding = 1 },
			{ icon = " ", title = "Projects", section = "projects", padding = 1 },
		},
	},

	indent = { enabled = false },
	input = { enabled = true },

	notifier = {
		enabled = true,
		timeout = 3000,
		style = "fancy",
	},

	scroll = { enabled = false },

	terminal = {
		enabled = true,
		win = {
			style = "terminal",
			border = vim.g.border_style,
			position = "float",
			height = 0.9,
			width = 0.9,
		},
	},

	styles = {
		notification = {
			border = vim.g.border_style,
			ft = "snacks_notif",
			wo = { wrap = true },
		},
		notification_history = {
			ft = "snacks_notif_history",
		},
		scratch = {
			border = vim.g.border_style,
		},
	},
})

Snacks.input.enable()
vim.ui.select = Snacks.picker.select

local map = vim.keymap.set

-- Explorer
map("n", "<leader>e", function()
	Snacks.explorer()
end, { desc = "File Explorer" })

-- Terminal
map("n", "<c-/>", function()
	Snacks.terminal()
end, { desc = "Toggle Terminal" })
map("n", "<c-_>", function()
	Snacks.terminal()
end, { desc = "which_key_ignore" })

-- Lazygit with reminder
map("n", "<leader>gg", function()
	Snacks.lazygit.open()
	vim.notify(
		"「□ Remember to do a local build」\n「□ Test on different browsers! 」\n「□ Triple check your code!」\n「□ Check all TODOs/FIX」\n「□ Remove console.logs」",
		vim.log.levels.INFO,
		{ title = "Before you send it", timeout = 7000 }
	)
end, { desc = "Lazygit" })
map("n", "<leader>gf", function()
	Snacks.lazygit.log_file()
end, { desc = "Git file history" })

-- Scratch
map("n", "<leader>.", function()
	Snacks.scratch()
end, { desc = "Toggle scratch buffer" })
map("n", "<leader>S", function()
	Snacks.scratch.select()
end, { desc = "Select scratch buffer" })

-- Rename file
map("n", "<leader>cR", function()
	Snacks.rename.rename_file()
end, { desc = "Rename file" })

-- Git browse
map({ "n", "v" }, "<leader>gB", function()
	Snacks.gitbrowse()
end, { desc = "Git browse" })

-- Notifications
map("n", "<leader>n", function()
	Snacks.notifier.show_history()
end, { desc = "Notification history" })
map("n", "<leader>un", function()
	Snacks.notifier.hide()
end, { desc = "Dismiss notifications" })

-- Zen mode
map("n", "<leader>zz", function()
	Snacks.zen()
end, { desc = "Zen mode" })
map("n", "<leader>Zz", function()
	Snacks.zen.zoom()
end, { desc = "Zoom" })

-- Words/references
map({ "n", "t" }, "]]", function()
	Snacks.words.jump(vim.v.count1)
end, { desc = "Next reference" })
map({ "n", "t" }, "[[", function()
	Snacks.words.jump(-vim.v.count1)
end, { desc = "Prev reference" })

-- Buffer delete
map("n", "<leader>bd", function()
	Snacks.bufdelete()
end, { desc = "Delete buffer" })
map("n", "<leader>bD", function()
	Snacks.bufdelete({ force = true })
end, { desc = "Delete buffer (force)" })

-- Toggles (deferred to ensure Snacks is fully loaded)
vim.schedule(function()
	_G.dd = function(...)
		Snacks.debug.inspect(...)
	end
	_G.bt = function()
		Snacks.debug.backtrace()
	end
	vim.print = _G.dd

	Snacks.toggle.option("spell", { name = "Spelling" }):map("<leader>uS")
	Snacks.toggle.option("wrap", { name = "Wrap" }):map("<leader>uw")
	Snacks.toggle.option("relativenumber", { name = "Relative Number" }):map("<leader>uL")
	Snacks.toggle.diagnostics():map("<leader>ud")
	Snacks.toggle.line_number():map("<leader>ul")
	Snacks.toggle.profiler():map("<leader>pp")
	Snacks.toggle.profiler_highlights():map("<leader>ph")
	Snacks.toggle
		.option("conceallevel", { off = 0, on = vim.o.conceallevel > 0 and vim.o.conceallevel or 2 })
		:map("<leader>uc")
	Snacks.toggle.treesitter():map("<leader>uT")
	Snacks.toggle.option("background", { off = "light", on = "dark", name = "Dark Background" }):map("<leader>ub")
	Snacks.toggle.inlay_hints():map("<leader>uh")
	Snacks.toggle.indent():map("<leader>ug")
	Snacks.toggle.dim():map("<leader>uD")
	Snacks.toggle.scroll():map("<leader>us")
end)
