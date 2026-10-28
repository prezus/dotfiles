# Catppuccin syntax colours. The theme ships a [dark] (Macchiato) and a [light]
# (Latte) section, and `choose` hooks $fish_terminal_color_theme, so fish follows
# the terminal when macOS switches appearance. The 16-colour palette itself is the
# terminal's job (Ghostty/Rex themes), so nothing here repaints it.
if status is-interactive
    fish_config theme choose catppuccin-macchiato
end
