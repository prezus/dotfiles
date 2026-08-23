# PATH, shared by both platforms.
#
# fish_add_path writes the UNIVERSAL fish_user_paths, so entries outlive the file
# that added them: removing a line here does not remove the path from a machine
# that already ran the old version. Bump __dotfiles_paths_generation to force a
# rebuild everywhere.
#
# The /opt/homebrew entries are safe to keep shared — fish_add_path silently
# skips a directory that does not exist, so they are inert on Linux (verified on
# fish 4.8.1). Don't add a uname test for them.
set -l generation 2
if test "$__dotfiles_paths_generation" != "$generation"
    set -U fish_user_paths
    set -U __dotfiles_paths_generation $generation
end

# Low priority — move to the end (append)
fish_add_path --move --append $HOME/.local/bin
fish_add_path --move --append $HOME/go/bin
fish_add_path --move --append $HOME/.lmstudio/bin
fish_add_path --move --append $HOME/.cargo/bin        # replaces `source ~/.cargo/env`
fish_add_path --move --append $HOME/.bun/bin
fish_add_path --move --append $HOME/Projects/dotfiles # the `dotfiles` CLI

# High priority — move to the front (last call ends up first)
fish_add_path --move /opt/homebrew/opt/libpq/bin
fish_add_path --move /opt/homebrew/opt/openjdk/bin
fish_add_path --move /opt/homebrew/bin

# Vite+ shims (node/npm/npx/corepack) MUST outrank /opt/homebrew/bin — brew pulls
# in `node` as a transitive dep of node-based CLIs (opencode, pi-coding-agent,
# mongosh, prettier, typescript, …) and it cannot be uninstalled while they exist.
# Whichever of the two lands first in PATH is the node you actually run, so pin it
# here explicitly. conf.d/vite-plus.fish also prepends this (via env.fish) but only
# because "vite-plus" happens to sort after "paths" alphabetically — don't rely on
# that. See AGENTS.md → KEY DECISIONS (Node.js).
fish_add_path --move "$HOME/.vite-plus/bin"
