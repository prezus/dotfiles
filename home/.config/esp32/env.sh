# ESP32 (Xtensa) Rust toolchain — mirrors conf.d/esp32.fish for zsh.
# Sourced from .zshrc. espup writes ~/export-esp.sh with the version dirs baked
# in; we glob instead so `espup update` cannot strand us on a path that no
# longer exists.
esp_root="$HOME/.rustup/toolchains/esp"
[ -d "$esp_root" ] || return 0

# zsh ABORTS a sourced file on an unmatched glob (bash leaves it literal), and a
# partially-installed toolchain is exactly that case. `emulate -L sh` gets us
# bash's behaviour with the option change scoped to this function.
_esp32_apply() {
  emulate -L sh 2>/dev/null || true
  for d in "$esp_root"/xtensa-esp-elf/*/xtensa-esp-elf/bin; do
    [ -d "$d" ] && PATH="$d:$PATH"
  done
  for d in "$esp_root"/xtensa-esp32-elf-clang/*/esp-clang/lib; do
    [ -d "$d" ] && LIBCLANG_PATH="$d"
  done
}
_esp32_apply
export PATH LIBCLANG_PATH
unset esp_root d
unset -f _esp32_apply
