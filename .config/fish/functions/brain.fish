function brain --description 'Read or record this project\'s private workflow notebook'
    if test (count $argv) -eq 0
        command python3 "$HOME/.claude/scripts/project-brain.py" show
    else
        command python3 "$HOME/.claude/scripts/project-brain.py" $argv
    end
end
