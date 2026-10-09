function fish_user_key_bindings
  for mode in default insert
    bind -M $mode \cr _fzf_search_history
    bind -M $mode \cf _fzf_search_directory
  end

  if not command -q ghq
    for mode in default insert
      if string match -q "bind* ctrl-g __ghq_repository_search" -- (bind --user -M $mode ctrl-g 2>/dev/null)
        bind --erase -M $mode ctrl-g
      end
    end
  end

  # vim-like
  bind \cl forward-char

  # prevent iterm2 from closing when typing Ctrl-D (EOF)
  bind \cd delete-char
end
