# ESP32 (Xtensa) Rust toolchain — installed by `dotfiles rust` via espup.
# espup writes ~/export-esp.sh (bash/zsh syntax, not fish-sourceable), so we
# re-derive the same two vars here. Mirrored for zsh in ~/.config/esp32/env.sh.
#
# Globbed, not pinned: the version dirs change on `espup update`, and a pinned
# path would break silently the next time it moves.
set -l esp_root $HOME/.rustup/toolchains/esp
if test -d $esp_root
    # Quote the subscript: an unmatched glob leaves the list empty, and an
    # unquoted `test -d $empty[-1]` is called with NO argument and errors.
    set -l gcc_bin $esp_root/xtensa-esp-elf/*/xtensa-esp-elf/bin
    if test -d "$gcc_bin[-1]"
        # -gP, not the bare/--move form paths.fish uses. paths.fish writes to the
        # universal fish_user_paths because its entries are stable; this one is
        # version-stamped, and a universal entry would outlive `espup update` as a
        # dangling path forever. -gP prepends to $PATH for this session only,
        # recomputed from the glob on every shell start.
        #
        # NOT -g: that copies all of fish_user_paths into a global that SHADOWS
        # the universal one, so paths.fish's later --move calls would silently
        # write to the shadow instead.
        fish_add_path -gP "$gcc_bin[-1]"
    end
    set -l clang_lib $esp_root/xtensa-esp32-elf-clang/*/esp-clang/lib
    if test -d "$clang_lib[-1]"
        set -gx LIBCLANG_PATH "$clang_lib[-1]"
    end
end
