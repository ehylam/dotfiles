---
effort: high
---

# Fix and Verify

Fix the reported bug with a self-verification loop. Don't present the fix until you've confirmed it works.

## Input

The user will describe a bug — symptoms, expected vs actual behavior, and optionally the suspected cause or file.

## Workflow

1. **Locate the bug** — Find the root cause. Don't guess — read the relevant code. If the cause isn't clear from the description, ask one clarifying question.

2. **Write a test if feasible** — Before fixing, consider whether you can write a quick validation script:
   - JS logic bugs → small Node script in `/tmp/` that imports the function and asserts expected behavior
   - JSON/schema bugs → script that parses the file and checks structure (block IDs match order array, valid types, etc.)
   - Liquid rendering → not usually testable, skip to step 3
   - If a test would take longer than the fix itself, skip this step
   - Run the test to confirm it **fails** with the current code

3. **Fix it** — Make the minimal change that resolves the issue. Don't refactor surrounding code or add unrelated improvements.

4. **Run checks** — Execute whatever verification is available:
   - If you wrote a test in step 2: run it — if it fails, go back to step 3
   - If project tests exist: run them (`npm test`, `shopify app function run`, etc.)
   - If it's a Liquid/JSON change: re-read the file and validate structure
   - If it's a build step: run the build and check for errors
   - If none of the above: do a manual self-review (step 5)

5. **Self-review** — Before presenting, verify:
   - [ ] The fix addresses the root cause, not just the symptom
   - [ ] No other references to the changed code are now broken
   - [ ] No incomplete cleanup (removed a function but left calls to it, etc.)
   - [ ] JSON is still valid if any was modified
   - [ ] No new lint errors or type mismatches introduced

6. **If checks fail** — Fix the new issue and return to step 4. Do not present a broken fix.

7. **Present** — Explain:
   - What the root cause was
   - What you changed and why
   - What verification you ran
   - Any caveats or follow-up needed
