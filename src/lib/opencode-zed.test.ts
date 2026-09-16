import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Exercise the plugin entrypoint and a real child process without opening an editor.
test("OpenCode /zed launches the project as one argument and reports launch failures", async () => {
  if (process.platform !== "darwin" && process.platform !== "linux") return;
  const dir = await mkdtemp(join(tmpdir(), "opencode-zed-"));
  try {
    const command = process.platform === "darwin" ? "open" : "zeditor";
    const argsFile = join(dir, "args");
    const project = join(dir, "project with spaces; $literal");
    await writeFile(join(dir, command), '#!/bin/sh\nprintf "%s\\n" "$@" > "$ZED_ARGS"\nexit "$ZED_EXIT"\n', { mode: 0o755 });
    const plugin = new URL("../../home/.config/opencode/plugins/zed.ts", import.meta.url).href;
    const script = `
      import plugin from ${JSON.stringify(plugin)};
      let command;
      const result = new Promise(async (resolve) => {
        await plugin.tui({
          keymap: { registerLayer(layer) { command = layer.commands[0]; } },
          state: { path: { directory: ${JSON.stringify(project)} } },
          ui: { dialog: { clear() {} }, toast: resolve },
        });
        if (command.slashName !== "zed") throw new Error("Missing /zed command");
        command.run();
      });
      console.log(JSON.stringify(await result));
    `;
    for (const code of ["0", "1"]) {
      const child = Bun.spawn([process.execPath, "--eval", script], {
        env: { ...process.env, PATH: dir, ZED_ARGS: argsFile, ZED_EXIT: code },
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = await new Response(child.stdout).text();
      expect(await child.exited).toBe(0);
      expect(JSON.parse(output)).toMatchObject({ variant: code === "0" ? "success" : "error" });
      const expected = process.platform === "darwin" ? ["-a", "Zed", project] : [project];
      expect(await readFile(argsFile, "utf8")).toBe(`${expected.join("\n")}\n`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
