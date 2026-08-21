import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OPEN_TIMEOUT_MS = 10_000;

/** Register `/zed`, which opens Pi's current working directory in Zed. */
export default function registerZedCommand(pi: ExtensionAPI): void {
  pi.registerCommand("zed", {
    description: "Open the current project in Zed",
    handler: async (_args, ctx) => {
      const result = await pi.exec("/usr/bin/open", ["-a", "Zed", ctx.cwd], {
        timeout: OPEN_TIMEOUT_MS,
      });

      if (result.code === 0) {
        ctx.ui.notify(`Opened ${ctx.cwd} in Zed`, "info");
        return;
      }

      ctx.ui.notify(`Could not open Zed (exit ${result.code})`, "error");
    },
  });
}
