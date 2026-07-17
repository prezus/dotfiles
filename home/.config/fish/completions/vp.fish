# Vite+ dynamic completion registration, lazy-loaded by Fish on completion.
# Delegates to `vp` itself (version-agnostic) rather than launching it at startup.
complete --keep-order --exclusive --command vp --arguments "(VP_COMPLETE=fish $HOME/.vite-plus/bin/vp -- (commandline --current-process --tokenize --cut-at-cursor) (commandline --current-token))"
