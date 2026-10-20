-- Title bars on every window via the official hyprbars plugin.
--
-- Install once (needs sudo):
--   hyprpm update
--   hyprpm add https://github.com/hyprwm/hyprland-plugins
--   hyprpm enable hyprbars
-- After a Hyprland update, rebuild with `hyprpm update`.
--
-- Everything below is skipped when the plugin isn't loaded, so this file is
-- safe on a machine that hasn't installed it.

local function loaded()
  for _, p in ipairs(hl.get_loaded_plugins() or {}) do
    if p.name and p.name:lower():find("hyprbars") then return true end
  end
  return false
end

-- Load enabled hyprpm plugins at login (no-op if hyprpm has none).
hl.on("hyprland.start", function()
  hl.exec_cmd("hyprpm reload -n")
end)

if not loaded() then return end

-- Follow the current Omarchy theme.
local function theme_color(key, fallback)
  local f = io.open(os.getenv("HOME") .. "/.local/state/omarchy/current/theme/colors.toml")
  if not f then return fallback end
  local text = f:read("*a")
  f:close()
  local hex = text:match("\n%s*" .. key .. '%s*=%s*"#(%x%x%x%x%x%x)"')
    or text:match("^%s*" .. key .. '%s*=%s*"#(%x%x%x%x%x%x)"')
  return hex and ("rgb(" .. hex .. ")") or fallback
end

local bg = theme_color("background", "rgb(1a1b26)")
local fg = theme_color("foreground", "rgb(a9b1d6)")
local accent = theme_color("accent", "rgb(7aa2f7)")

local maximize = [[hyprctl dispatch 'hl.dsp.window.fullscreen({ mode = "maximized", action = "toggle" })']]

hl.config({
  plugin = {
    hyprbars = {
      bar_height = 24,
      bar_color = bg,
      ["col.text"] = fg,
      bar_text_size = 10,
      bar_text_font = "JetBrainsMono Nerd Font",
      bar_text_align = "center",
      bar_part_of_window = true,
      bar_precedence_over_border = true,
      bar_padding = 10,
      bar_button_padding = 8,
      inactive_button_color = "rgba(59595988)",
      on_double_click = maximize,
    },
  },
})

-- Buttons are listed right to left.
hl.plugin.hyprbars.add_button({
  bg_color = "rgb(f7768e)",
  fg_color = bg,
  size = 12,
  icon = "",
  action = "hyprctl dispatch 'hl.dsp.window.close()'",
})

hl.plugin.hyprbars.add_button({
  bg_color = accent,
  fg_color = bg,
  size = 12,
  icon = "",
  action = maximize,
})

-- Apps that draw their own title bar (client-side decorations) would get two.
o.window("(chromium|google-chrome|brave-browser|org\\.gnome\\..*)", { ["hyprbars:no_bar"] = true })
