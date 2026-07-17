# PATH — ported from .zshrc.
# fish_add_path writes to the universal fish_user_paths and won't REORDER an
# existing entry unless --move is given. We use --move so priority is
# deterministic every load: Homebrew first, language/tool bins last (so brew
# prettier/tsc win over bun's dependency copies in ~/.bun/bin).

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
