# Environment variables — ported from .zshrc
set -gx LANG en_US.UTF-8
set -gx EDITOR zed
set -gx MANPATH /usr/local/man $MANPATH

# Java (matches `/usr/libexec/java_home -v 23.0.2`)
set -gx JAVA_HOME (/usr/libexec/java_home -v 23.0.2 2>/dev/null)

# Ghostty terminal compatibility
if test "$TERM_PROGRAM" = ghostty
    set -gx TERM xterm-256color
end
