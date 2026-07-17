# Completions for the `dotfiles` CLI.
# DYNAMIC: the subcommand list comes from `dotfiles __commands` (the CLI is the
# single source of truth), so this stays in sync automatically when commands change.

# top-level subcommands (name<TAB>description from the CLI)
complete -c dotfiles -f -n __fish_use_subcommand -a "(dotfiles __commands)"

# `dotfiles skills <sub>`
complete -c dotfiles -f -n "__fish_seen_subcommand_from skills" \
    -a "install\t'wire skills symlinks' update\t're-sync vendored skills' status\t'show links + pinned commit'"

# `dotfiles stow --adopt`
complete -c dotfiles -f -n "__fish_seen_subcommand_from stow" -l adopt -d "adopt existing files (first run on a configured machine)"
