# PATH — ported from .zshrc. fish_add_path is idempotent (safe every startup).

# Prepend (higher priority)
fish_add_path /opt/homebrew/bin
fish_add_path /opt/homebrew/opt/openjdk/bin
fish_add_path /opt/homebrew/opt/libpq/bin
fish_add_path $HOME/.bun/bin
fish_add_path $HOME/.cargo/bin          # replaces `source ~/.cargo/env` (no env.fish exists)

# Append (lower priority)
fish_add_path --append $HOME/.local/bin
fish_add_path --append $HOME/go/bin
fish_add_path --append $HOME/.lmstudio/bin
