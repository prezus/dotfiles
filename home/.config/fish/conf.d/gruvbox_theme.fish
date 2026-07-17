# Apply the gruvbox dark theme by reprogramming the terminal palette.
# The theme_gruvbox function (functions/theme_gruvbox.fish) emits OSC escape
# sequences, so only run it in interactive shells. Change the second arg to
# `soft` or `hard` for a different background contrast.
if status is-interactive
    theme_gruvbox dark medium
end
