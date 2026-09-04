# Auto-load the nearest AGENTS.md into Claude Code.
function claude --description 'Run Claude with the nearest AGENTS.md'
    set -l dir $PWD

    while true
        if test -f "$dir/AGENTS.md"
            command claude \
                --append-system-prompt-file "$dir/AGENTS.md" \
                $argv
            return $status
        end

        if test "$dir" = /
            break
        end

        set dir (path dirname "$dir")
    end

    command claude $argv
end
