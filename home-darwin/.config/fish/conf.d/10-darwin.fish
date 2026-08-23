# Platform-specific values pulled out of the shared conf.d/env.fish.
set -gx EDITOR zed

# /usr/libexec/java_home is macOS-only; on Linux the JDK is on PATH already.
set -gx JAVA_HOME (/usr/libexec/java_home -v 23.0.2 2>/dev/null)

if test "$TERM_PROGRAM" = ghostty
    set -gx TERM xterm-256color
end
