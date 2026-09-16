import { execFile } from "node:child_process";
import type { TuiPluginModule } from "@opencode-ai/plugin/tui";

/** Open the current project in Zed without sending a prompt to the model. */
const plugin: TuiPluginModule = {
  id: "dotfiles-zed",
  tui: async (api) => {
    api.keymap.registerLayer({
      commands: [
        {
          name: "dotfiles.zed",
          title: "Open project in Zed",
          category: "Plugin",
          namespace: "palette",
          slashName: "zed",
          run() {
            api.ui.dialog.clear();
            const directory = api.state.path.directory;
            const command = process.platform === "darwin" ? "open" : "zeditor";
            if (process.platform !== "darwin" && process.platform !== "linux") {
              api.ui.toast({ variant: "error", message: `/zed does not support ${process.platform}` });
              return;
            }
            const args = process.platform === "darwin" ? ["-a", "Zed", directory] : [directory];
            execFile(command, args, { timeout: 10_000 }, (error) => {
              api.ui.toast({
                variant: error ? "error" : "success",
                message: error ? `Could not open Zed: ${error.message}` : `Opened ${directory} in Zed`,
              });
            });
          },
        },
      ],
    });
  },
};

export default plugin;
