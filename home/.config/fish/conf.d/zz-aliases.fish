# Aliases — ported from .zshrc.
# Named `zz-` so it loads AFTER plugin-git's conf.d/git.fish, letting these
# personal git aliases override the plugin's where they differ.

# Modern CLI replacements
alias cat=bat
alias ls='eza --icons --git'
alias ll='eza -l --icons --git'
alias find=fd
alias grep=rg
alias cd=z                       # zoxide; z falls back to real cd for actual paths

# Personal git shortcuts (override plugin-git: e.g. `ga` = git add . , `gc` = commit -m)
alias gs='git status'
alias ga='git add .'
alias gc='git commit -m'
alias gp='git push'

# Custom
alias scripts='zed ~/Projects/Midtown/Scripts/'
alias tf=tofu
