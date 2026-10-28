require("config.lazy")

require("catppuccin").setup({
flavour = "auto", -- follows vim.o.background, which Neovim reads from the terminal
background = { light = "latte", dark = "macchiato" },
show_end_of_buffer = true,
default_integrations = true,
styles = {
	comments = { "italic"},
	conditionals = { "italic" },
        loops = {},
        functions = {},
        keywords = {},
        strings = {},
        variables = {},
        numbers = {},
        booleans = {},
        properties = {},
        types = {},
        operators = {},
}
})
vim.cmd.colorscheme "catppuccin"

