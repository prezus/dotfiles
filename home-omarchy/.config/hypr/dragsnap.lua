-- Drag-to-snap for floating windows (no keybinds needed).
--
-- While dragging a window, push the cursor against a screen edge and let go:
--   left / right edge      -> left / right half
--   top edge               -> fill the screen
--   corners (top/bottom)   -> quarters
-- Drag a snapped window away and it returns to its previous size.

local GAP = 10        -- space around snapped windows
local EDGE = 4        -- how close (px) the cursor must be to an edge
local CORNER = 120    -- how far from a corner still counts as the corner
local TICK = 50       -- poll interval (ms)
local SETTLE = 4      -- ticks without movement before snapping

local LMB = 272

local state = {}      -- current drag tracking for the active window
local snapped = {}    -- address -> { box = {x,y,w,h}, orig = {w,h} }

local function same(a, b)
  return a and b and math.abs(a.x - b.x) <= 1 and math.abs(a.y - b.y) <= 1
end

local function workarea(m)
  local s = m.scale or 1
  local r = m.reserved or {}
  local x = m.x + (r.left or 0) + GAP
  local y = m.y + (r.top or 0) + GAP
  local w = math.floor(m.width / s) - (r.left or 0) - (r.right or 0) - 2 * GAP
  local h = math.floor(m.height / s) - (r.top or 0) - (r.bottom or 0) - 2 * GAP
  return x, y, w, h
end

local function zone_at(c)
  local m = hl.get_monitor_at(c.x, c.y)
  if not m then return nil end
  local s = m.scale or 1
  local mx, my = m.x, m.y
  local mw, mh = math.floor(m.width / s), math.floor(m.height / s)
  local top = (m.reserved and m.reserved.top) or 0

  local left = c.x <= mx + EDGE
  local right = c.x >= mx + mw - 1 - EDGE
  local at_top = c.y <= my + top + EDGE
  local near_top = c.y <= my + CORNER
  local near_bottom = c.y >= my + mh - CORNER

  if left and near_top then return "tl", m end
  if left and near_bottom then return "bl", m end
  if right and near_top then return "tr", m end
  if right and near_bottom then return "br", m end
  if left then return "left", m end
  if right then return "right", m end
  if at_top then return "max", m end
  return nil
end

local function box_for(zone, m)
  local x, y, w, h = workarea(m)
  local hw, hh = math.floor((w - GAP) / 2), math.floor((h - GAP) / 2)
  local boxes = {
    left = { x, y, hw, h },
    right = { x + hw + GAP, y, hw, h },
    max = { x, y, w, h },
    tl = { x, y, hw, hh },
    tr = { x + hw + GAP, y, hw, hh },
    bl = { x, y + hh + GAP, hw, hh },
    br = { x + hw + GAP, y + hh + GAP, hw, hh },
  }
  local b = boxes[zone]
  return { x = b[1], y = b[2], w = b[3], h = b[4] }
end

local function place(addr, b)
  local win = "address:" .. addr
  -- resize keeps the window centered, so resize first, then move into place
  hl.dispatch(hl.dsp.window.resize({ window = win, x = b.w, y = b.h }))
  hl.dispatch(hl.dsp.window.move({ window = win, x = b.x, y = b.y }))
end

local function tick()
  local w = hl.get_active_window()
  if not w or not w.floating or (w.fullscreen or 0) ~= 0 then
    state = {}
    return
  end

  local addr = w.address
  local pos = { x = w.at.x, y = w.at.y }

  if state.addr ~= addr then
    state = { addr = addr, last = pos, moving = false, still = 0 }
    return
  end

  if not same(pos, state.last) then
    state.last = pos
    state.moving = true
    state.still = 0

    -- Dragged away from a snapped spot: give the window its old size back.
    local s = snapped[addr]
    if s and not same(pos, s.box) then
      snapped[addr] = nil
      hl.dispatch(hl.dsp.window.resize({ window = "address:" .. addr, x = s.orig.w, y = s.orig.h }))
    end
    return
  end

  if not state.moving then return end
  if hl.is_key_down(LMB) then return end -- still holding the mouse button

  state.still = state.still + 1
  if state.still < SETTLE then return end
  state.moving = false

  local c = hl.get_cursor_pos()
  if not c then return end
  local zone, m = zone_at(c)
  if not zone then return end

  local b = box_for(zone, m)
  snapped[addr] = snapped[addr] or { orig = { w = w.size.x, h = w.size.y } }
  snapped[addr].box = b
  place(addr, b)
  state.last = { x = b.x, y = b.y }
end

hl.on("window.close", function(w)
  if w and w.address then snapped[w.address] = nil end
end)

hl.timer(tick, { timeout = TICK, type = "repeat" })
