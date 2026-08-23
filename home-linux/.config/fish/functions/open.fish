# macOS parity: `open` is muscle memory, and Omarchy's bash defines the same shim.
function open --description 'Open a file or URL in the desktop default'
    xdg-open $argv >/dev/null 2>&1 &
    disown
end
