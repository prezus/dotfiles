# ZED CONFIG

Editor config: `settings.json` (behavior/LSP/theme) + `keymap.json` (keybindings).
Theme Catppuccin Mocha, Monaspace fonts, AI panel on but **inline predictions off**.

> **Agents:** most changes are in `settings.json`. Preserve the security and
> privacy settings below — don't regress them.

## WHERE TO LOOK

| Task | Location in `settings.json` |
|------|------------------------------|
| Add/adjust a language's LSP or formatter | `languages.<Lang>` (`language_servers`, `formatter`) |
| Tune an LSP server | `lsp.<server>.settings` / `initialization_options` |
| Map file glob → language | `file_types.<Lang>` (e.g. Ansible, OpenTofu) |
| Theme / icons | `theme`, `icon_theme` (Catppuccin Mocha) |
| Fonts | `ui_font_family` / `buffer_font_family` (Monaspace Xenon/Neon) |
| AI / agent panel | `agent`, `agent_servers` (opencode registered), `disable_ai` |
| Exclude files from AI edit-prediction | `edit_predictions.disabled_globs` |
| Keybindings | `keymap.json` |

## CONVENTIONS

- **Formatter split:** `prettier` for JS/TS/TSX/JSON/Markdown/Svelte/GraphQL;
  `language_server` for Go/Rust/Python/Swift/TOML.
- **TypeScript uses `vtsls`** (not tsserver), with 8 GB tsserver memory.
- **Python:** `pyright` (strict, workspace diagnostics) + `ruff`.
- **Rust:** `rust-analyzer` with `clippy` check + inlay hints.
- **AI on, inline predictions OFF** — `show_edit_predictions: false`,
  `edit_prediction_provider: none`, and disabled in comments.
- **Theme:** Catppuccin Mocha dark, italic comments; relative line numbers; minimap off.

## ANTI-PATTERNS / DO-NOT-REGRESS

- **Do not** enable edit predictions for the secret globs in
  `edit_predictions.disabled_globs` (`.env*`, `*.pem`, `*.key`, `*.cert`,
  `.dev.vars`, `secrets.yml`) — this keeps credentials out of AI context.
- **Keep telemetry off** (`telemetry.diagnostics/metrics: false`).
- Don't turn on inline edit predictions unless explicitly asked.
- Don't hardcode a machine-specific `pythonPath` beyond the existing `~/env/bin/python` default without noting it.

## NOTES

- External agent server `opencode` is registered (`agent_servers.opencode`).
- `file_types` maps Ansible YAML patterns and `.tf`/`.tfvars` → OpenTofu.
- LSP servers referenced here (vtsls, gopls, rust-analyzer, pyright/ruff, bash-/svelte-/graphql-/tailwindcss-language-server) should be installed — many come via brew (`packages/bundle`) or bun (`bun-global.txt`).
