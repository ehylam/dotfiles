---
effort: medium
---

# Checkpoint

The user is pausing or ending this session. Save the current state so the next session can resume without re-exploring.

## Write to memory

Use the memory tools to save a checkpoint file at the path `checkpoint.md` with:

```
## Checkpoint — [project name]
**Date:** [today]
**Branch:** [current git branch]
**Task:** [what the user was working on]
**Status:** [where we got to — what's done, what's not]
**Next steps:** [concrete list of what remains]
**Key files:** [files that were being modified or are relevant]
**Gotchas:** [anything the next session needs to know — failed approaches, edge cases found, decisions made]
```

## Rules

- Be specific about next steps — "finish the CSS" is too vague, "add responsive styles for .gallery-grid at 768px breakpoint in assets/section-gallery.css" is useful.
- Include file paths, not just descriptions.
- If there are uncommitted changes, note that.
- Keep it under 30 lines. This is a resume point, not documentation.
