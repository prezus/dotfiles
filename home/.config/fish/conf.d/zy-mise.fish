# MUST be the last PATH mutation. fish_add_path writes the UNIVERSAL
# fish_user_paths, which fish prepends wholesale on every reconstruction — so a
# fish_add_path running after this would put ~/.cargo/bin ahead of mise's node.
# mise's prompt hook re-asserts before the first interactive command, but
# `fish -c '...'` (which this CLI uses) never gets a prompt.
#
# Hence `zy-`, not a number: digits sort BEFORE letters, so a 60- prefix would
# load before vite-plus.fish. Same trick as zz-aliases.fish.
if type -q mise
    mise activate fish | source
end
