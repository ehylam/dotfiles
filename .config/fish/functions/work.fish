function work
    ssh tmux -t "fish -c 'tmux attach -t work || tmux new -s work'"
end
