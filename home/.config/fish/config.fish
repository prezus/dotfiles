# Fish shell configuration.
#
# Per-concern setup lives in conf.d/*.fish (auto-sourced before this file).
# Plugins are managed by fisher (see fish_plugins); restore with `fisher update`.
# Fish provides autosuggestions + syntax highlighting natively, so the zsh
# plugins for those are intentionally not ported.

# Disable the interactive greeting
set -g fish_greeting ""

# Added by OrbStack: command-line tools and integration
# This won't be added again if you remove it.
source ~/.orbstack/shell/init2.fish 2>/dev/null || :
