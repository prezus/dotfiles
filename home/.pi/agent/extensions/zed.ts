import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OPEN_TIMEOUT_MS = 10_000;

type ZedLaunch = {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
};

function zedLaunch(platform: string, cwd: string): ZedLaunch | undefined {
  switch (platform) {
    case "darwin":
      return { command: "open", args: ["-a", "Zed", cwd] };
    case "linux":
      return { command: "zeditor", args: [cwd] };
    default:
      return undefined;
  }
}

/** Register `/zed`, which opens Pi's current working directory in Zed. */
export default function registerZedCommand(pi: ExtensionAPI): void {
  pi.registerCommand("zed", {
    description: "Open the current project in Zed",
    handler: async (_args, ctx) => {
      const launch = zedLaunch(process.platform, ctx.cwd);
      if (launch === undefined) {
        ctx.ui.notify(`/zed does not support ${process.platform}`, "error");
        return;
      }

      const result = await pi.exec(launch.command, [...launch.args], {
        timeout: OPEN_TIMEOUT_MS,
      });

      if (result.code === 0) {
        ctx.ui.notify(`Opened ${ctx.cwd} in Zed`, "info");
        return;
      }

      const reason = result.killed ? "timed out" : `exit ${result.code}`;
      ctx.ui.notify(`Could not open Zed with ${launch.command} (${reason})`, "error");
    },
  });
}
