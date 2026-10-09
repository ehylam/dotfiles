return {
	-- Colorscheme: Catppuccin
	{
		"catppuccin/nvim",
		name = "catppuccin",
		priority = 1000,
		opts = {
			flavour = "mocha",
			integrations = {
				fzf = true,
				gitsigns = true,
				mason = true,
				mini = { enabled = true },
				native_lsp = { enabled = true },
				treesitter = true,
				which_key = true,
			},
		},
		config = function(_, opts)
			require("catppuccin").setup(opts)
			vim.cmd.colorscheme("catppuccin-mocha")
		end,
	},

	-- Snacks: Essential utilities
	{
		"folke/snacks.nvim",
		priority = 1000,
		lazy = false,
		opts = {
			bigfile = { enabled = true },
			explorer = { enabled = true },
			notifier = { enabled = true, timeout = 3000 },
			quickfile = { enabled = true, exclude = { "latex", "markdown" } },
			input = { enabled = true },
			picker = { enabled = true, ui_select = true },
			terminal = {
				enabled = true,
				win = {
					border = vim.g.border_style,
					position = "float",
					height = 0.9,
					width = 0.9,
				},
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
							key = "a",
							desc = "AI Sidekick",
							action = function()
								require("sidekick.cli").toggle()
							end,
						},
						{ icon = "󰒲 ", key = "l", desc = "Lazy", action = ":Lazy" },
						{ icon = " ", key = "q", desc = "Quit", action = ":qa" },
					},
				},
			},
		},
		keys = {
			{
				"<leader>e",
				function()
					Snacks.explorer()
				end,
				desc = "File Explorer",
			},
			{
				"<c-/>",
				function()
					Snacks.terminal()
				end,
				desc = "Toggle Terminal",
			},
			{
				"<leader>gg",
				function()
					Snacks.lazygit.open()
				end,
				desc = "Lazygit",
			},
			{
				"<leader>.",
				function()
					Snacks.scratch()
				end,
				desc = "Scratch buffer",
			},
			{
				"<leader>bd",
				function()
					Snacks.bufdelete()
				end,
				desc = "Delete buffer",
			},
			{
				"<leader>n",
				function()
					Snacks.notifier.show_history()
				end,
				desc = "Notifications",
			},
		},
		config = function(_, opts)
			require("snacks").setup(opts)
			Snacks.input.enable()
			vim.ui.select = Snacks.picker.select
		end,
		init = function()
			vim.api.nvim_create_autocmd("User", {
				pattern = "VeryLazy",
				callback = function()
					_G.dd = function(...)
						Snacks.debug.inspect(...)
					end
					vim.print = _G.dd
					Snacks.toggle.diagnostics():map("<leader>ud")
					Snacks.toggle.inlay_hints():map("<leader>uh")
					Snacks.toggle.option("wrap", { name = "Wrap" }):map("<leader>uw")
				end,
			})
		end,
	},

	-- Which-key: Keybinding help
	{
		"folke/which-key.nvim",
		event = "VeryLazy",
		opts = {
			preset = "helix",
			spec = {
				{ "<leader>a", group = "ai" },
				{ "<leader>b", group = "buffer" },
				{ "<leader>c", group = "code" },
				{ "<leader>f", group = "file/find" },
				{ "<leader>g", group = "git" },
				{ "<leader>h", group = "hints" },
				{ "<leader>s", group = "search" },
				{ "<leader>u", group = "ui/toggle" },
				{ "<leader>w", group = "windows" },
				{ "<leader>x", group = "diagnostics" },
			},
		},
	},

	-- Gitsigns: Git integration
	{
		"lewis6991/gitsigns.nvim",
		event = { "BufReadPost", "BufNewFile" },
		opts = {
			signs = {
				add = { text = "+" },
				change = { text = "~" },
				delete = { text = "_" },
				topdelete = { text = "‾" },
				changedelete = { text = "~" },
			},
			on_attach = function(bufnr)
				local gs = require("gitsigns")
				local map = function(mode, l, r, desc)
					vim.keymap.set(mode, l, r, { buffer = bufnr, desc = desc })
				end
				map("n", "]h", gs.next_hunk, "Next hunk")
				map("n", "[h", gs.prev_hunk, "Prev hunk")
				map("n", "<leader>ghs", gs.stage_hunk, "Stage hunk")
				map("n", "<leader>ghr", gs.reset_hunk, "Reset hunk")
				map("n", "<leader>ghp", gs.preview_hunk, "Preview hunk")
				map("n", "<leader>ghb", function()
					gs.blame_line({ full = true })
				end, "Blame line")
			end,
		},
	},

	-- Web devicons
	{ "nvim-tree/nvim-web-devicons", lazy = true },
}
