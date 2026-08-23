-- Personal Hyprland bindings.
--
-- Omarchy's defaults load FIRST (hyprland.lua requires default.hypr.omarchy
-- before this file), so anything here wins. Rebinding an occupied key needs
-- hl.unbind() first — Hyprland appends, it does not replace.
--
-- PAIRED FILE: home-darwin/.config/aerospace/aerospace.toml. That file is the
-- source of truth for the motion set; this mirrors it so the same fingers work
-- on both machines. ALT is deliberate — it is the modifier AeroSpace uses
-- (macOS reserves CMD), and Omarchy's defaults are almost entirely SUPER, so
-- mirroring on ALT costs zero unbinds. Audited: the only bare-ALT bindings in
-- /usr/share/omarchy/default/hypr/bindings/ are ALT+TAB, ALT+SHIFT+TAB,
-- ALT+PRINT and the XF86 media keys, none of which this touches.
--
-- NOT mirrored from AeroSpace: alt-a..z workspace letters (Hyprland has 10
-- numeric workspaces, and it would eat the whole ALT letter space), and
-- alt-shift-semicolon service mode (no analogue).
--
-- Validate every edit: hyprctl reload && hyprctl configerrors

-- Focus. AeroSpace: alt-h/j/k/l
o.bind("ALT + H", "Focus left", hl.dsp.focus({ direction = "l" }))
o.bind("ALT + J", "Focus down", hl.dsp.focus({ direction = "d" }))
o.bind("ALT + K", "Focus up", hl.dsp.focus({ direction = "u" }))
o.bind("ALT + L", "Focus right", hl.dsp.focus({ direction = "r" }))

-- Move. AeroSpace: alt-shift-h/j/k/l
--
-- NOT equivalent, and worth knowing: AeroSpace's `move` can push a window INTO
-- a sibling container; Hyprland's swapwindow only exchanges it with the
-- neighbour. Same keys, slightly different behaviour at container boundaries.
o.bind("ALT + SHIFT + H", "Move window left", hl.dsp.window.swap({ direction = "l" }))
o.bind("ALT + SHIFT + J", "Move window down", hl.dsp.window.swap({ direction = "d" }))
o.bind("ALT + SHIFT + K", "Move window up", hl.dsp.window.swap({ direction = "u" }))
o.bind("ALT + SHIFT + L", "Move window right", hl.dsp.window.swap({ direction = "r" }))

-- Workspaces 1..9. AeroSpace: alt-1..9 / alt-shift-1..9
-- code:10..18 rather than the digits, matching Omarchy's own loop, so the
-- bindings survive a non-US keyboard layout.
for workspace = 1, 9 do
    local key = "code:" .. tostring(workspace + 9)
    o.bind(
        "ALT + " .. key,
        "Switch to workspace " .. workspace,
        hl.dsp.focus({ workspace = tostring(workspace) })
    )
    o.bind(
        "ALT + SHIFT + " .. key,
        "Move window to workspace " .. workspace,
        hl.dsp.window.move({ workspace = tostring(workspace) })
    )
end

-- Layout. AeroSpace: alt-slash toggles tiles horizontal/vertical
o.bind("ALT + SLASH", "Toggle split direction", hl.dsp.layout("togglesplit"))

-- Resize. AeroSpace: alt-shift-minus / alt-shift-equal ("resize smart ∓50").
-- code:20/21 are minus/equal, the same keys Omarchy uses for its SUPER resizes.
o.bind("ALT + SHIFT + code:20", "Shrink window", hl.dsp.window.resize({ x = -50, y = 0, relative = true }))
o.bind("ALT + SHIFT + code:21", "Expand window", hl.dsp.window.resize({ x = 50, y = 0, relative = true }))
