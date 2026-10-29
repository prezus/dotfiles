# Sourced by the hooks in this directory. Wired per clone by `dotfiles init`
# (git config --local core.hooksPath .githooks); `dotfiles doctor` checks it.
hook=$(basename -- "$0")
root=$(git rev-parse --show-toplevel) || exit 1
config=$root/.gitleaks.toml

# Fail closed: a missing scanner must not mean an unscanned commit.
if ! command -v gitleaks >/dev/null 2>&1; then
    printf '%s: gitleaks is not installed, refusing (dotfiles brew / pacman -S gitleaks)\n' "$hook" >&2
    exit 1
fi

scan() {
    gitleaks git --no-banner --redact --verbose --log-level=warn --config "$config" "$@" "$root" && return 0
    printf '\n%s: blocked — the findings above would be published (this repo is public).\n' "$hook" >&2
    printf 'Remove them; if one is a false positive, allowlist it in .gitleaks.toml.\n' >&2
    exit 1
}
