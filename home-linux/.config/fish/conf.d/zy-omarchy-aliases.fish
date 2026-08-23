# The portable half of Omarchy's bash aliases. `ls`, `cd` and the `g*` git set
# are deliberately absent: zz-aliases.fish is the shared definition and wins
# (zy- sorts before zz-).

if type -q fzf
    alias ff "fzf --preview 'bat --style=numbers --color=always {}'"
    alias eff '$EDITOR (ff)'
end

if type -q mise
    alias mup 'MISE_MINIMUM_RELEASE_AGE=0 mise up'
end

# Omarchy's own launchers — guarded so a plain Arch box skips them.
if type -q omarchy-agent
    alias a 'omarchy-agent --inline'
end
if type -q herdr
    alias h herdr
end
