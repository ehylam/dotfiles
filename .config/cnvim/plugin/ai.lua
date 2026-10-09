vim.pack.add({
  "https://github.com/ehylam/claude-preview.nvim",
  "https://github.com/MSmaili/wiremux.nvim",
  "https://github.com/folke/sidekick.nvim",
  "https://github.com/zbirenbaum/copilot.lua",
  "https://github.com/nvim-lua/plenary.nvim",
  "https://github.com/MunifTanjim/nui.nvim",
  "https://github.com/piersolenski/wtf.nvim",
})

local map = vim.keymap.set

-- Claude preview
local code_preview_ok, code_preview = pcall(require, "code-preview")
if code_preview_ok then
  code_preview.setup()
else
  local claude_preview_ok, claude_preview = pcall(require, "claude-preview")
  if claude_preview_ok then
    claude_preview.setup()
    map("n", "gX", function() require("claude-preview.diff").close_diff() end, { desc = "Close diff preview" })
  end
end

-- Wiremux
local ok2, wiremux = pcall(require, "wiremux")
if ok2 then
  wiremux.setup({
    picker = { adapter = "fzf-lua" },
  })

  -- Herdr owns targets; Wiremux supplies editor-context placeholders.
  local herd = function(action, ...) return require("config.herdr").route(action, ...) end

  map("n", "<leader>mt", herd("toggle"), { desc = "Toggle target" })
  map("n", "<leader>mc", herd("create"), { desc = "Create target" })
  map("n", "<leader>mf", herd("send", "{file}", { focus = true }), { desc = "Send file" })
  map({ "x", "n" }, "<leader>ms", herd("send", "{this}", { focus = true }), { desc = "Send this" })
  map("x", "<leader>mv", herd("send", "{selection}", { focus = true }), { desc = "Send selection" })
  map("n", "<leader>md", herd("send", "{diagnostics}", { focus = true }), { desc = "Send diagnostics" })
  map("n", "<leader>mD", herd("send", "{diagnostics_all}", { focus = true }), { desc = "Send all diagnostics" })
  map({ "x", "n" }, "gm", herd("send_motion"), { expr = true, desc = "Send motion" })
  map({ "n", "x" }, "<leader>mp", herd("send", {
    { label = "Review", value = "Review {selection} for correctness and readability" },
    { label = "Explain", value = "Explain {selection} and its context" },
    { label = "Fix diagnostics", value = "Fix these {diagnostics}" },
    { label = "Add tests", value = "Add tests for {selection}" },
    { label = "Optimize", value = "Optimize {selection} for performance" },
  }), { desc = "AI prompts" })
end

-- Team prompts for Sidekick
local team_context = [[
## AI Product Team Roles
- **[Syntax]** — Principal Engineer: Architecture, system design, code standards, performance, scalability
- **[Codey]** — Technical Program Manager: Sprint execution, timelines, dependencies, process discipline
- **[Aesthetica]** — Front-end Developer & UI/UX: Components, responsiveness, usability, visual consistency
- **[Sentinal]** — Security Operations: Threat modeling, code scanning, secure coding, compliance
- **[Flow]** — DevOps Engineer: CI/CD, deployments, observability, infra automation
- **[Verity]** — QA Analyst: Test strategies, acceptance criteria, regression, accessibility
- **[Bran]** — Digital Marketing: SEO, AEO, schema, web analytics
- **[Cipher]** — StoryBrand Expert: Messaging, customer clarity, narrative consistency
- **[Echo]** — Content Strategist: Content strategy, editorial planning, UX writing

## Core Principles
1. Clarity over cleverness
2. Consistency over creativity
3. No overengineering — simplest solution that scales
4. Quality is shared — QA, security, DevOps participate from the start
]]

local prompts = {
  review = team_context .. "\nAs [Syntax], [Sentinal], and [Verity] working together, review this code:\n\n{selection}\n\nProvide:\n1. **[Syntax]**: Architecture concerns, code standards, performance issues\n2. **[Sentinal]**: Security vulnerabilities, input validation, OWASP risks\n3. **[Verity]**: Edge cases, test coverage gaps, accessibility issues\n\nFormat as a structured review with severity levels (critical/warning/suggestion).",
  security = team_context .. "\nAs [Sentinal] Security Operations Specialist, perform a security audit on:\n\n{selection}\n\nCheck for: OWASP Top 10, input validation, XSS/SQL injection/command injection, auth flaws, secrets exposure, insecure dependencies.\n\nProvide severity ratings and remediation steps.",
  refactor = team_context .. "\nAs [Syntax] Principal Engineer, refactor this code:\n\n{selection}\n\nApply: Clarity over cleverness, no overengineering, small composable functions, explicit readable code.\n\nShow the refactored code with reasoning.",
  ux = team_context .. "\nAs [Aesthetica] Front-end Developer & UI/UX Designer, review:\n\n{selection}\n\nEvaluate: Component structure, responsive design, accessibility (WCAG 2.1 AA), visual consistency, UX improvements.",
  test = team_context .. "\nAs [Verity] QA Analyst, create a test strategy for:\n\n{selection}\n\nInclude: Unit tests, integration tests, accessibility, error handling, regression considerations.",
  document = team_context .. "\nAs [Echo] Content Strategist, add documentation to:\n\n{selection}\n\nProvide: Function/component docs, parameter descriptions, return values, usage examples, caveats.",
  seo = team_context .. "\nAs [Bran] Digital Marketing Specialist, optimize for SEO:\n\n{selection}\n\nReview: Schema.org, semantic HTML, meta info, heading hierarchy, Core Web Vitals, AEO.",
  plan = team_context .. "\nAs [Codey] Technical Program Manager, break down this task:\n\n{selection}\n\nProvide: Task summary, dependencies, subtasks, roles involved, Definition of Done, risks.",
  devops = team_context .. "\nAs [Flow] DevOps Engineer, review for deployment readiness:\n\n{selection}\n\nCheck: CI/CD implications, env config, performance/scaling, observability, rollback, infra requirements.",
  team = team_context .. "\nExecute [ProcessTaskQA] workflow on:\n\n{selection}\n\nMulti-agent: 1. [Syntax] 2. [Sentinal] 3. [Aesthetica] 4. [Verity] 5. [Flow]\n\nFinal recommendation: Pass / Pass with notes / Fail",
  shopify = team_context .. "\nYou are a Shopify development expert. Use Liquid best practices, follow theme architecture, optimize Core Web Vitals, implement schema.org, use native features first, follow WCAG 2.1 AA, consider Dawn patterns.\n\nPlease help with:\n{selection}",
}

-- Sidekick
local ok3, sidekick = pcall(require, "sidekick")
if ok3 then
  sidekick.setup({
    cli = {
      prompts = prompts,
      mux = {
        enabled = false,
      },
    },
  })

  map("n", "<tab>", function()
    if not require("sidekick").nes_jump_or_apply() then
      return "<Tab>"
    end
  end, { expr = true, desc = "Goto/Apply Next Edit Suggestion" })
  map("n", "<leader>aa", function() require("sidekick.cli").toggle() end, { desc = "Sidekick Toggle" })
  map("n", "<leader>as", function() require("sidekick.cli").select() end, { desc = "Select CLI" })
  map({ "x", "n" }, "<leader>at", function() require("sidekick.cli").send({ msg = "{this}" }) end, { desc = "Send This" })
  map("x", "<leader>av", function() require("sidekick.cli").send({ msg = "{selection}" }) end, { desc = "Send Selection" })
  map({ "n", "x" }, "<leader>ap", function() require("sidekick.cli").prompt() end, { desc = "Select Prompt" })
  map({ "n", "x", "i", "t" }, "<c-.>", function() require("sidekick.cli").focus() end, { desc = "Sidekick Focus" })
  map("n", "<leader>ac", function() require("sidekick.cli").toggle({ name = "claude", focus = true }) end, { desc = "Toggle Claude" })
end

-- WTF: AI debugging
local ok4, wtf = pcall(require, "wtf")
if ok4 then
  wtf.setup({
    popup_type = "popup",
    providers = {
      openai = { model_id = "gpt-4" },
    },
    search_engine = "google",
  })
  map({ "n", "x" }, "<leader>wD", function() require("wtf").diagnose() end, { desc = "Debug diagnostic with AI" })
  map({ "n", "x" }, "<leader>wf", function() require("wtf").fix() end, { desc = "Fix diagnostic with AI" })
  map("n", "<leader>ws", function() require("wtf").search() end, { desc = "Search diagnostic with Google" })
  map("n", "<leader>wp", function() require("wtf").pick_provider() end, { desc = "Pick AI provider" })
  map("n", "<leader>wh", function() require("wtf").history() end, { desc = "WTF history to quickfix" })
  map("n", "<leader>wg", function() require("wtf").grep_history() end, { desc = "Grep WTF history" })
end
