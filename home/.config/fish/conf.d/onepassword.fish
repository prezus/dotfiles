# 1Password CLI — fish-native completions.
#
# NOTE: the zsh setup sourced ~/.config/op/plugins.sh (biometric CLI plugins for
# aws/gh/etc.). That file is POSIX-sh and is NOT fish-sourceable, and op's shell
# plugins don't officially support fish. If you rely on `op plugin` aliases,
# keep using them from zsh, or wrap them as fish functions. Completions below work.
if type -q op
    op completion fish | source
end
