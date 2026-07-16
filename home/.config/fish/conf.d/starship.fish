# Starship prompt — shares the exact same config as zsh (starship is cross-shell).
# The same ~/.config/starship/starship.toml renders identically in both shells.
set -gx STARSHIP_CONFIG "$HOME/.config/starship/starship.toml"
if type -q starship
    starship init fish | source
end
