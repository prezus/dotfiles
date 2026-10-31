-- A shell above the focused pane, a quarter of its height, in its directory,
-- when that pane is running an agent (cmd+shift+up). Any other pane gets the
-- usual even split up.
--
-- pane.split always halves the pane and takes no ratio, so with Rex on half a
-- monitor a prompt beside an agent cost the agent half its rows. This splits
-- through the server instead, where new_split takes a ratio: the new shell is
-- the "before" (top) side and gets PROMPT_RATIO of the space.

local TERMINAL = "com.superlogical.terminal"
local PROMPT_RATIO = 0.25

-- Same lookup as tab-names.lua: the foreground program's cwd follows an agent
-- even when its shell can't report one; the shell's reported pwd is the fallback.
local function directory(session_id, block_id)
	local args = { session_id = session_id, block_id = block_id }
	local process = rex.block.call(TERMINAL, "process", args)
	if process and process.foreground and process.foreground.cwd then
		return process.foreground.cwd
	end
	local reported = rex.block.call(TERMINAL, "pwd", args)
	if reported and reported.pwd then
		local path = reported.pwd:gsub("^file://[^/]*", "")
		return (path:gsub("%%(%x%x)", function(hex)
			return string.char(tonumber(hex, 16))
		end))
	end
end

-- A key press may not say which pane it came from; the active tab's focused
-- pane is the one the user is looking at.
local function focused_block(session_id)
	local view = session_id and rex.session.view({ session_id = session_id })
	for _, window in ipairs(view and view.windows or {}) do
		if window.window_id == view.active_window_id then
			return window.focused_block_id
		end
	end
end

-- Agents, by the name of the program in the pane's foreground. npm-installed
-- ones run under node, so argv0 and the invoked path's basename count too.
local AGENTS = { claude = true, pi = true, opencode = true, codex = true }

local function basename(path)
	return path and path:match("([^/]+)$")
end

-- A pane runs an agent when its foreground program is one, or when that program
-- reports an agent status (Claude Code reports app = "claude-code"). The status
-- must come from the foreground process, so one left behind by an agent that
-- has since exited doesn't count.
local function runs_agent(session_id, block_id)
	local args = { session_id = session_id, block_id = block_id }
	local process = rex.block.call(TERMINAL, "process", args)
	local fg = process and process.foreground
	if not fg then
		return false
	end
	if AGENTS[fg.name or ""] or AGENTS[fg.argv0 or ""] or AGENTS[basename(fg.invoked_path) or ""] then
		return true
	end
	local status = rex.block.call(TERMINAL, "program_status", args)
	for _, record in ipairs(status and status.records or {}) do
		if record.app and record.app ~= "" and record.owner and record.owner.pid == fg.pid then
			return true
		end
	end
	return false
end

local function split_prompt_above(ctx)
	local block_id = ctx.block_id or focused_block(ctx.session_id)
	if not block_id or not runs_agent(ctx.session_id, block_id) then
		-- Not an agent: the plain split cmd+shift+up does without this file.
		rex.client.queue("pane.split", { direction = "up" })
		return
	end
	local options = {}
	local dir = directory(ctx.session_id, block_id)
	if dir then
		options.cwd = dir
	end
	-- The app's "balance splits on creation" evens this to 50/50 right after, and
	-- init.lua has no timers to wait that out. The "prompt" label is what
	-- prompt-split.lua (a rex do script, which has timers) looks for to put
	-- PROMPT_RATIO back.
	local _, err = rex.session.new_split({
		session_id = ctx.session_id,
		anchor_id = block_id,
		direction = "vertical",
		side = "before",
		ratio = PROMPT_RATIO,
		focus = true,
		layout = rex.layout.block({ flavor = TERMINAL .. ".shell", label = "prompt", options = options }),
	})
	if err then
		rex.log("warn", "split_prompt_above: " .. tostring(err))
	end
end

rex.action({
	name = "split_prompt_above",
	title = "Split Prompt Above (25%)",
	category = "Pane",
	keywords = "pane split prompt shell terminal above up quarter small agent",
	run = split_prompt_above,
})

-- cmd+shift+arrows split in each direction; up is the one that opens a prompt
-- above an agent. Bound as a function, not by action name: the app runs its own
-- built-in split for a key bound to a server action, but a function binding is
-- offered to the server first and wins.
rex.bind("cmd+shift+up", function(ctx)
	split_prompt_above(ctx)
	return true
end)
