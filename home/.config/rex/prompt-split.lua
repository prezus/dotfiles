-- Hold a new "prompt" pane (splits.lua, cmd+shift+up over an agent) at a quarter of its split.
--
-- splits.lua asks for a 25/75 split, but the app's "balance splits on creation"
-- setting evens it to 50/50 straight after. init.lua can't wait that out:
-- rex.after and rex.every don't exist in the config, only in scripts. So this
-- script runs beside tab-names.lua and puts the ratio back:
--
--   rex do ~/.config/rex/prompt-split.lua --all
--
-- On macOS it is kept running by ~/Library/LaunchAgents/local.rex-prompt-split.plist
-- (home-darwin). Edits take effect on restart:
--   launchctl kickstart -k gui/$(id -u)/local.rex-prompt-split
--
-- Only for GRACE_SECONDS after a prompt pane first appears, so a border you drag
-- afterwards stays where you put it. Panes that exist when this starts are left alone.

local LABEL = "prompt"
local RATIO = 0.25
local GRACE_SECONDS = 2

-- Prompt block ID -> true while it may still be corrected, false once settled.
local watching = {}

local function prompt_blocks(layer, found)
	for _, block in ipairs(layer.blocks or {}) do
		if block.label == LABEL then
			found[block.block_id] = true
		end
	end
end

-- The layout is a tree: a node is { block_id = ... } or { split = {...} }, and a
-- split has before and after nodes. Yield each split whose top is a prompt.
local function each_prompt_split(node, prompts, fn)
	if not node then
		return
	end
	local split = node.split or (node.split_id and node)
	if not split then
		return
	end
	local top, bottom = split.before, split.after
	if split.direction == "vertical" and top and top.block_id and prompts[top.block_id] and bottom and bottom.block_id then
		fn(split, top.block_id, bottom.block_id)
	end
	each_prompt_split(top, prompts, fn)
	each_prompt_split(bottom, prompts, fn)
end

local function scan(session_id, settle_existing)
	local view = rex.session.view({ session_id = session_id })
	for _, window in ipairs(view and view.windows or {}) do
		for _, layer in ipairs(window.layers or {}) do
			local prompts = {}
			prompt_blocks(layer, prompts)
			each_prompt_split(layer.layout, prompts, function(split, top, bottom)
				if watching[top] == nil then
					watching[top] = not settle_existing
					if not settle_existing then
						rex.after(GRACE_SECONDS, function()
							watching[top] = false
						end)
					end
				end
				if watching[top] and math.abs((split.ratio or 0) - RATIO) > 0.01 then
					rex.call("session.resize_pane", {
						session_id = session_id,
						direction = "vertical",
						before_block_id = top,
						after_block_id = bottom,
						ratio = RATIO,
					})
				end
			end)
		end
	end
end

rex.on("session_view_changed", function(ctx)
	if ctx.session_id then
		scan(ctx.session_id, false)
	end
end)

rex.on("block_closed", function(_, ev)
	if ev and ev.block_id then
		watching[ev.block_id] = nil
	end
end)

local list = rex.call("session.list")
for _, session in ipairs(list and list.sessions or {}) do
	scan(session.session_id, true)
end
