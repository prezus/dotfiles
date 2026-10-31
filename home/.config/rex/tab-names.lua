-- Name each tab after the git repo and branch of its focused pane: "dotfiles · main",
-- and name a new session after the repo it is first used in: "dotfiles".
--
-- Rex shows the running program until a tab has a label, so four Claude Code tabs
-- in four repos all read "Claude Code". Herdr did this natively. Rex can't from
-- init.lua (the config file is never sent events), so this is a script that keeps
-- running and listens for them:
--
--   rex do ~/.config/rex/tab-names.lua --all
--
-- On macOS it is kept running by ~/Library/LaunchAgents/local.rex-tab-names.plist
-- (home-darwin). Edits take effect on restart:
--   launchctl kickstart -k gui/$(id -u)/local.rex-tab-names
--
-- A tab is ours to rename while its label is Rex's default ("Window 81303c6e"),
-- empty, or already in our "repo · branch" form. Anything else was typed by
-- someone and is left alone; clear the label to hand the tab back. Outside a repo
-- the tab goes back to Rex's default.
--
-- Sessions are named once. A session created while this runs keeps its label
-- until its active tab is in a repo, then takes the repo's name and is never
-- touched again: agents rename sessions after their task, and that label wins.
-- Rex says nothing about who set a label, and the server's own names
-- ("quiet-meadow") look like an agent's, so this only follows sessions it saw
-- created, and only while their label is still the one they were created with.
-- A label typed at creation (rex new work) is left alone unless it has the
-- server's two-word shape. Sessions that predate this script are never renamed.
--
-- Events say when a pane changes directory, starts a program, or gains focus. A
-- branch switch raises no event, so a timer re-reads git every few seconds too.

local TERMINAL = "com.superlogical.terminal"
local SEP = " · "
local POLL_SECONDS = 5
local SETTLE_SECONDS = 0.3
local MAX_LABEL = 128

local function ours(window)
	local label = window.label or ""
	return label == "" or label == "Window " .. window.window_id:sub(-8) or label:find(SEP, 1, true) ~= nil
end

-- The foreground process's cwd follows an agent even when its shell can't report
-- one; the shell's reported pwd (a file:// URL) is the fallback.
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

local function git(dir, ...)
	local result = rex.exec({ "git", "-C", dir, ... })
	if result and result.ok then
		return (result.stdout:gsub("%s+$", ""))
	end
end

-- The common dir is the main checkout's .git even inside a worktree, so a
-- worktree's tab carries the repo's name, not the worktree directory's.
local function repo_and_branch(dir)
	local out = git(dir, "rev-parse", "--path-format=absolute", "--git-common-dir", "--abbrev-ref", "HEAD")
	if not out then
		return nil
	end
	local common, branch = out:match("^(.-)\n(.*)$")
	if not common then
		return nil
	end
	if branch == "HEAD" then
		branch = git(dir, "rev-parse", "--short", "HEAD") or branch
	end
	local repo = common:gsub("/%.git/?$", ""):match("([^/]+)/?$")
	if not repo then
		return nil
	end
	return repo, branch
end

-- Rex refuses a label over 128 bytes; cut it, then back off any UTF-8
-- continuation bytes the cut split.
local function fit(label)
	if #label <= MAX_LABEL then
		return label
	end
	return label:sub(1, MAX_LABEL - 3):gsub("[\128-\191]+$", ""):gsub("[\192-\255]$", "") .. "…"
end

local function tab_name(dir)
	local repo, branch = repo_and_branch(dir)
	return repo and fit(repo .. SEP .. branch)
end

-- Sessions created while this runs, by ID, with the label each was created with.
local unnamed = {}

local function name_session(view)
	local created = unnamed[view.session_id]
	if not created then
		return
	end
	if view.label ~= created then
		unnamed[view.session_id] = nil -- renamed by someone else
		return
	end
	for _, window in ipairs(view.windows or {}) do
		if window.window_id == view.active_window_id and window.focused_block_id then
			local dir = directory(view.session_id, window.focused_block_id)
			local repo = dir and repo_and_branch(dir)
			if repo then
				local ok, err = rex.session.set_label({ session_id = view.session_id, label = fit(repo) })
				if ok then
					unnamed[view.session_id] = nil
				else
					rex.log("warn", "session label: " .. tostring(err))
				end
			end
			return
		end
	end
end

local function refresh(session_id)
	local view = rex.session.view({ session_id = session_id })
	if not view then
		return
	end
	name_session(view)
	for _, window in ipairs(view.windows or {}) do
		if window.focused_block_id and ours(window) then
			local dir = directory(session_id, window.focused_block_id)
			-- Outside a repo, an empty label hands the tab back to Rex's own name
			-- rather than leaving the last repo's name on it.
			local label = window.label or ""
			local name = dir and (tab_name(dir) or "")
			local stale = name == "" and label:find(SEP, 1, true) ~= nil
			if name and (stale or (name ~= "" and name ~= label)) then
				rex.session.set_window_label({ session_id = session_id, window_id = window.window_id, label = name })
			end
		end
	end
end

-- Events arrive in bursts (a cd raises pwd, process and view changes), so wait for
-- the burst to settle and refresh its session once.
local pending = {}
local function soon(ctx)
	local session_id = ctx.session_id
	if not session_id then
		return
	end
	if pending[session_id] then
		pending[session_id]:cancel()
	end
	pending[session_id] = rex.after(SETTLE_SECONDS, function()
		pending[session_id] = nil
		refresh(session_id)
	end)
end

for _, event in ipairs({
	"terminal.pwd_changed",
	"terminal.process_changed",
	"session_view_changed",
	"window_created",
	"window_label_changed",
}) do
	rex.on(event, soon)
end

-- Server events carry no ctx.session_id; the session is in the event itself.
-- The server names a session "adjective-noun"; anything else was typed.
rex.on("session_created", function(_, ev)
	local session = ev.session
	if session and session.session_id and (session.label or ""):match("^%l+%-%l+$") then
		unnamed[session.session_id] = session.label
		soon({ session_id = session.session_id })
	end
end)

rex.on("session_destroyed", function(_, ev)
	if ev.session_id then
		unnamed[ev.session_id] = nil
	end
end)

local function refresh_all()
	local list = rex.call("session.list")
	for _, session in ipairs(list and list.sessions or {}) do
		refresh(session.session_id)
	end
end

rex.every(POLL_SECONDS, refresh_all)
refresh_all()
