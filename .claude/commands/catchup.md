---
effort: medium
---

Read every file that has changed on the current branch compared to main (or master). Then present a structured summary so I have full context to continue working.

Steps:
1. Run `git diff --name-only main...HEAD 2>/dev/null || git diff --name-only master...HEAD` to get the list of changed files.
2. Also check for uncommitted changes with `git diff --name-only` and `git diff --name-only --cached`.
3. Read each changed file (skip binary files and files that no longer exist).
4. Present a summary with:
   - **Branch**: current branch name
   - **Changed files**: grouped by directory, with a one-line description of what changed in each
   - **Key patterns**: any new functions, components, sections, or schemas introduced
   - **Open questions**: anything that looks incomplete, has TODOs, or might need attention
   - **Uncommitted work**: staged and unstaged changes not yet committed

Keep the summary concise but complete enough that I can pick up exactly where I left off.
