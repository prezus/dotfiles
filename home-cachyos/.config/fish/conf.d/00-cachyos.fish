# CachyOS's own fish setup (package cachyos-fish-config): what its /etc/skel config.fish
# sources, which stow replaced with ours. First in conf.d, so env.fish, zz-aliases.fish and
# the rest override it; it brings the fastfetch greeting, `done` notifications, MANPAGER,
# the `!!`/`!$` bindings and eza aliases. Guarded so a plain Arch box skips it.
if test -r /usr/share/cachyos-fish-config/cachyos-config.fish
    source /usr/share/cachyos-fish-config/cachyos-config.fish
end

set -gx EDITOR nvim
set -gx SUDO_EDITOR $EDITOR
set -gx BAT_THEME ansi
