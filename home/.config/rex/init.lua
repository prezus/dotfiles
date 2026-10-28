-- Rex configuration, read by the Rex server on this machine.
-- Docs: https://www.superlogical.com/rex/docs/customize/config
--
-- Rex does not watch this file. After editing, run:
--   rex config check    # validate without applying
--   rex config reload   # apply to the running server
--
-- Split into modules beside this file with require("name") -> name.lua.

-- Themes are app settings, not config: an import copies the colours into the
-- app's preferences, so editing a theme file changes nothing until it is
-- imported again. The files are the official catppuccin/ghostty ones that
-- Ghostty also uses (home-darwin/.config/ghostty/themes). Importing selects the
-- theme for the appearance it is made for: Latte light, Macchiato dark.
rex.action({
	name = "import_catppuccin_themes",
	title = "Import Catppuccin Themes",
	category = "Appearance",
	keywords = "theme catppuccin macchiato latte dotfiles",
	run = function()
		local themes = os.getenv("HOME") .. "/.config/ghostty/themes/"
		rex.client.queue("client.theme.import", { path = themes .. "catppuccin-latte" })
		rex.client.queue("client.theme.import", { path = themes .. "catppuccin-macchiato" })
	end,
})
