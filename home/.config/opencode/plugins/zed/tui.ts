import { execFile } from "node:child_process";
import { Plugin } from "@opencode/plugin/tui";

/** Open the current project in Zed without sending a prompt to the model. */
export default Plugin.define({
  id: "dotfiles.zed",
  setup(context) {
    // Global, not the default base mode: slash completion and the palette push their
    // own input modes, and a base-mode command is not listed in either.
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "dotfiles.zed",
          title: "Open project in Zed",
          group: "Plugin",
          palette: true,
          slash: { name: "zed" },
          run() {
            const directory = (context.location ?? context.data.location.default()).directory;
            if (process.platform !== "darwin" && process.platform !== "linux") {
              context.ui.toast.show({ variant: "error", message: `/zed does not support ${process.platform}` });
              return;
            }
            const [command, args] = process.platform === "darwin" ? ["open", ["-a", "Zed", directory]] : ["zeditor", [directory]];
            execFile(command, args, { timeout: 10_000 }, (error) => {
              context.ui.toast.show({
                variant: error ? "error" : "success",
                message: error ? `Could not open Zed: ${error.message}` : `Opened ${context.ui.format.path(directory)} in Zed`,
              });
            });
          },
        },
      ],
    }));
  },
});
