# fzf — ported from .zshrc (~/.fzf.zsh → native fish integration)
set -gx FZF_DEFAULT_COMMAND 'fd --type f --hidden --follow'
if type -q fzf
    fzf --fish | source
end
