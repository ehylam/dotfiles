#!/usr/bin/env bash

input=$(cat)

IFS=$'\t' read -r cwd model used_pct vim_mode session_name < <(
  jq -r '[
    .workspace.current_dir // .cwd // "",
    .model.display_name // "",
    .context_window.used_percentage // "",
    .vim.mode // "",
    .session_name // ""
  ] | @tsv' <<<"$input"
)

dir_label=""
if [ -n "$cwd" ]; then
  dir_label=$(basename "$cwd")
fi

git_branch=""
if [ -n "$cwd" ] && [ -d "$cwd/.git" ]; then
  git_branch=$(git -C "$cwd" --no-optional-locks symbolic-ref --short HEAD 2>/dev/null)
fi

context_label=""
if [ -n "$used_pct" ]; then
  used_int=$(printf "%.0f" "$used_pct")
  context_label="ctx:${used_int}%"
fi

vim_label=""
if [ -n "$vim_mode" ]; then
  vim_label="[$vim_mode]"
fi

parts=()

if [ -n "$dir_label" ]; then
  parts+=("$dir_label")
fi

if [ -n "$git_branch" ]; then
  parts+=("$git_branch")
fi

if [ -n "$model" ]; then
  parts+=("$model")
fi

if [ -n "$context_label" ]; then
  parts+=("$context_label")
fi

if [ -n "$vim_label" ]; then
  parts+=("$vim_label")
fi

if [ -n "$session_name" ]; then
  parts+=("\"$session_name\"")
fi

output=""
for part in "${parts[@]}"; do
  if [ -z "$output" ]; then
    output="$part"
  else
    output="$output | $part"
  fi
done

printf "%s" "$output"
