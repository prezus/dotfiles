# Environment shared by both platforms. Platform-specific VALUES live in the
# overlay fragments (10-darwin.fish / 00-omarchy.fish), never behind a uname
# test here.
set -gx LANG en_US.UTF-8
