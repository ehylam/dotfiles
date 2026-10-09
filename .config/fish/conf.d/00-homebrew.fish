# ===== Homebrew =====
# Puts brew's bin/sbin on PATH. Lives in conf.d rather than config.fish because
# conf.d snippets are sourced first, and fnm.fish/fzf.fish probe for
# brew-installed binaries. The 00- prefix sorts it ahead of those.
if test -x /opt/homebrew/bin/brew
    eval (/opt/homebrew/bin/brew shellenv)
else if test -x /usr/local/bin/brew
    eval (/usr/local/bin/brew shellenv)
end

# Versioned Homebrew Python keeps generic executables in libexec/bin.
for python_bin in /opt/homebrew/opt/python@3.12/libexec/bin /usr/local/opt/python@3.12/libexec/bin
    if test -x "$python_bin/python3"
        fish_add_path -g "$python_bin"
        break
    end
end
