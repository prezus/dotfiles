# Omarchy ships no fish integration at all — this is a port of
# /usr/share/omarchy/default/bash/{env-bootstrap,envs}. Keep it in sync when
# Omarchy changes those; `omarchy update` will not do it for you.

# /etc/omarchy.conf only exists under `omarchy dev link`, and repoints everything.
if test -r /etc/omarchy.conf
    set -gx OMARCHY_PATH (sed -n 's/^path=//p' /etc/omarchy.conf)
end
if not set -q OMARCHY_PATH
    set -gx OMARCHY_PATH /usr/share/omarchy
end

set -gx EDITOR "omarchy-launch-editor --inline"
set -gx SUDO_EDITOR $EDITOR
# Shell-scoped on purpose: exporting BROWSER system-wide makes xdg-settings
# refuse to change the default browser.
set -gx BROWSER omarchy-launch-browser

set -gx BAT_THEME ansi
set -gx MANROFFOPT -c
set -gx MANPAGER "sh -c 'col -bx | bat -l man -p'"
