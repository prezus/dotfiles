# PATH — ported from .zshrc.
# fish_add_path writes to the universal fish_user_paths and won't REORDER an
# existing entry unless --move is given. We use --move so priority is
# deterministic every load: Vite+ shims first, then Homebrew, language/tool bins
# last (so brew prettier/tsc win over bun's dependency copies in ~/.bun/bin).

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
