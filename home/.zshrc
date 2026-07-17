# =============================================================================
# ZSH Configuration
# =============================================================================

# -----------------------------------------------------------------------------
# Oh My Zsh Setup
# -----------------------------------------------------------------------------

export ZSH="$HOME/.config/oh-my-zsh"

# Plugins (keep minimal for faster startup)
plugins=(
    1password
    git
    zoxide
    fzf
    poetry
    zsh-autosuggestions
    virtualenv
    zsh-syntax-highlighting
    talosctl
    ohmyzsh-full-autoupdate
)

# shellcheck source=/dev/null
source "$ZSH/oh-my-zsh.sh"

# -----------------------------------------------------------------------------
# Environment Variables
# -----------------------------------------------------------------------------

export LANG=en_US.UTF-8
export MANPATH="/usr/local/man:$MANPATH"
export EDITOR='zed'

# Java
export JAVA_HOME="$(/usr/libexec/java_home -v 23.0.2)"

# Starship prompt
export STARSHIP_CONFIG="$HOME/.config/starship/starship.toml"

# FZF
export FZF_DEFAULT_COMMAND='fd --type f --hidden --follow'

# Ghostty terminal compatibility
if [[ "$TERM_PROGRAM" == "ghostty" ]]; then
    export TERM=xterm-256color
fi

# -----------------------------------------------------------------------------
# PATH Configuration
# -----------------------------------------------------------------------------

# Homebrew and system tools
export PATH="/opt/homebrew/bin:$PATH"
export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"

# Language-specific paths
export PATH="$HOME/.bun/bin:$PATH"
export PATH="$PATH:$HOME/.local/bin"
export PATH="$PATH:$HOME/go/bin"

# Application paths
export PATH="$PATH:$HOME/.lmstudio/bin"

# dotfiles CLI (~/Projects/dotfiles/dotfiles)
export PATH="$PATH:$HOME/Projects/dotfiles"

# -----------------------------------------------------------------------------
# Aliases
# -----------------------------------------------------------------------------

# Modern CLI replacements
alias cat='bat'
alias ls='eza --icons --git'
alias ll='eza -l --icons --git'
alias find='fd'
alias grep='rg'
alias cd='z'

# Git shortcuts
alias gs='git status'
alias ga='git add .'
alias gc='git commit -m'
alias gp='git push'

# Custom shortcuts
alias scripts='zed ~/Projects/Midtown/Scripts/'
alias tf='tofu'

# -----------------------------------------------------------------------------
# Tool Initialization
# -----------------------------------------------------------------------------

# 1Password CLI
# shellcheck source=/dev/null
[ -f "$HOME/.config/op/plugins.sh" ] && source "$HOME/.config/op/plugins.sh"

# FZF
# shellcheck source=/dev/null
[ -f "$HOME/.fzf.zsh" ] && source "$HOME/.fzf.zsh"

# Zoxide
eval "$(zoxide init zsh)"

# Starship prompt
eval "$(starship init zsh)"

# -----------------------------------------------------------------------------
# Language Toolchains
# -----------------------------------------------------------------------------

# Rust toolchain (rustup)
# shellcheck source=/dev/null
[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"

# ESP32 Rust toolchain
# shellcheck source=/dev/null
[ -f "$HOME/.config/esp32/env.sh" ] && source "$HOME/.config/esp32/env.sh"

# Vite+ bin (https://viteplus.dev)
. "$HOME/.vite-plus/env"
