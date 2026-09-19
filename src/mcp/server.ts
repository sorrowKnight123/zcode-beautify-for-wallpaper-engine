/**
 * MCP server exposing zcode-beautify to the ZCode agent:
 * the model can set a wallpaper / re-theme / reset on the user's behalf.
 */

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { applyColorsOnly, applyWallpaper, applySceneWallpaper, reapplyStored, resetAppearance } from "../core/session.js";
import { detectWallpaperType } from "../core/wallpaperType.js";
import { loadConfig } from "../core/launch.js";

/**
 * ZCode launches this MCP server on every app start — the ideal hook to make
 * the settings panel "just exist": piggyback a detached `serve` process so it
 * injects the panel as soon as the renderer is up. Idempotent (a healthy
 * serve on the API port is left alone) and strictly fire-and-forget: a slow
 * or failed bootstrap must never delay or break MCP startup.
 */
function bootstrapServe(): void {
  try {
    const serverFile = path.resolve(process.argv[1] ?? "");
    // Only from the bundled layout (dist/mcp/server.js → dist/cli.js); under
    // tsx from src/ there is nothing to point at, so skip quietly.
    const cliJs = path.join(path.dirname(serverFile), "..", "cli.js");
    if (path.basename(serverFile) !== "server.js" || !existsSync(cliJs)) return;
    fetch("http://127.0.0.1:9223/api/health", { signal: AbortSignal.timeout(1500) })
      .then((r) => r.json())
      .then((body) => {
        if ((body as { service?: string })?.service !== "zcode-beautify") throw new Error("foreign service");
      })
      .catch(() => {
        try {
          // ZCode launches MCP servers with ZCODE_BEAUTIFY_DATA_DIR pointed at
          // a plugin-scoped directory (<plugin>@<marketplace>); letting the
          // serve inherit it splits the store from manually-started serves
          // (empty-looking library). Strip it so every serve uses the default
          // data dir.
          const childEnv = { ...process.env };
          delete childEnv.ZCODE_BEAUTIFY_DATA_DIR;
          spawn(process.execPath, [cliJs, "serve", "--detach"], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
            env: childEnv,
          }).unref();
        } catch {
          /* best effort */
        }
      });
    // Self-heal launch shortcuts: without the CDP flag a start-menu launch
    // gets no injection for the whole session. Fire-and-forget, silent.
    import("../core/shortcuts.js")
      .then((m) => m.ensureShortcutsHaveCdpFlag(9222))
      .catch(() => undefined);
  } catch {
    /* best effort */
  }
}
bootstrapServe();

const server = new McpServer({
  name: "zcode-beautify",
  version: "0.3.0",
});

/** Registry of the tools this server exposes (used by tests / docs). */
export const TOOL_NAMES = [
  "set_background",
  "import_scene_wallpaper",
  "apply_options",
  "refresh_theme",
  "reset_appearance",
  "beautify_status",
] as const;

server.registerTool(
  "set_background",
  {
    title: "Set ZCode wallpaper",
    description:
      "Set the ZCode desktop client's background wallpaper image and adapt the UI colors with Material Design 3 (Monet) dynamic color. Accepts a static image OR a Wallpaper Engine scene wallpaper (.pkg / workshop directory) — scene inputs are rendered, recorded and looped automatically. ZCode must be running with the CDP debug port (see zcode-beautify launch).",
    inputSchema: {
      image_path: z.string().describe("Absolute path of the image, .pkg file, or scene directory to use as wallpaper"),
      blur: z.number().min(0).max(100).optional().describe("Wallpaper blur radius in px (default 0)"),
      dim: z.number().min(0).max(100).optional().describe("Wallpaper darkening 0-100 (default 25)"),
    },
  },
  async ({ image_path, blur, dim }) => {
    try {
      const kind = detectWallpaperType(image_path);
      const { windows } =
        kind === "scene" || kind === "video"
          ? await applySceneWallpaper(image_path, { blur, dim })
          : await applyWallpaper(image_path, { blur, dim });
      return {
        content: [{
          type: "text",
          text:
            kind === "scene"
              ? `Scene wallpaper imported and applied to ${windows} window(s). First import renders in real time; later imports are served from cache.`
              : kind === "video"
                ? `Video wallpaper imported (trimmed and looped) and applied to ${windows} window(s).`
                : `Wallpaper applied to ${windows} window(s) with Monet-adapted colors.`,
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "import_scene_wallpaper",
  {
    title: "Import scene wallpaper",
    description:
      "Import a Wallpaper Engine scene wallpaper (.pkg file or extracted workshop directory) as an animated ZCode wallpaper: opens it in a Wallpaper Engine window, records ~15s with ffmpeg, processes it into a perfectly seamless loop, caches it, and applies it with Monet colors from a poster frame. Requires Wallpaper Engine and ffmpeg 5+ locally.",
    inputSchema: {
      path: z.string().describe("Absolute path of the .pkg file or the scene directory (project.json folder)"),
      blur: z.number().min(0).max(100).optional().describe("Wallpaper blur radius in px"),
      dim: z.number().min(0).max(100).optional().describe("Wallpaper darkening 0-100"),
    },
  },
  async ({ path: scenePath, blur, dim }) => {
    try {
      const stages: string[] = [];
      const { windows, served, scene } = await applySceneWallpaper(scenePath, {
        blur,
        dim,
        onProgress: (stage) => {
          if (stages[stages.length - 1] !== stage) stages.push(stage);
        },
      });
      const notes = served
        ? "Loop is streaming from the serve media endpoint."
        : "serve is not running: the poster frame is applied as a static wallpaper. Run `zcode-beautify serve --detach`, then `refresh_theme`, to get motion.";
      return {
        content: [{
          type: "text",
          text: `Scene imported (${scene.fromCache ? "cache hit" : "freshly rendered"}, ${Math.round(statSizeMb(scene.loopPath))} MB) and applied to ${windows} window(s). Stages: ${stages.join(" → ")}. ${notes}`,
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
    }
  }
);

function statSizeMb(file: string): number {
  try {
    return statSync(file).size / 1024 / 1024;
  } catch {
    return 0;
  }
}

server.registerTool(
  "apply_options",
  {
    title: "Tune ZCode appearance",
    description:
      "Adjust the live ZCode appearance without changing the wallpaper: blur radius, dim level, Monet dynamic colors on/off, and wallpaper visibility (translucent vs opaque surfaces). Only the provided values change; the rest keep their current setting.",
    inputSchema: {
      blur: z.number().min(0).max(100).optional().describe("Wallpaper blur radius in px"),
      dim: z.number().min(0).max(100).optional().describe("Wallpaper darkening 0-100"),
      monet: z.boolean().optional().describe("Regenerate UI colors from the wallpaper (true) or keep ZCode's original colors (false)"),
      wallpaper_visible: z.boolean().optional().describe("Translucent surfaces showing the wallpaper (true) or opaque surfaces (false)"),
      fit: z.enum(["cover", "contain", "smart"]).optional().describe("Framing: cover fills and crops, contain letterboxes with a blurred backdrop, smart analyzes the picture locally and picks the best framing + focus point"),
    },
  },
  async ({ blur, dim, monet, wallpaper_visible, fit }) => {
    try {
      const windows = await applyColorsOnly({ blur, dim, monet, wallpaperVisible: wallpaper_visible, fit });
      return { content: [{ type: "text", text: `Appearance updated in ${windows} window(s).` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "refresh_theme",
  {
    title: "Refresh ZCode theme",
    description: "Re-inject the stored wallpaper and Monet theme into the running ZCode client (e.g. after the app was restarted).",
    inputSchema: {},
  },
  async () => {
    try {
      const windows = await reapplyStored();
      return { content: [{ type: "text", text: `Theme re-injected into ${windows} window(s).` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "reset_appearance",
  {
    title: "Reset ZCode appearance",
    description: "Remove the wallpaper and color overrides, restoring ZCode's default appearance.",
    inputSchema: {},
  },
  async () => {
    try {
      await resetAppearance();
      return { content: [{ type: "text", text: "Appearance restored to default." }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.registerTool(
  "beautify_status",
  {
    title: "Beautify status",
    description: "Report the stored zcode-beautify configuration.",
    inputSchema: {},
  },
  async () => {
    const cfg = loadConfig();
    return { content: [{ type: "text", text: JSON.stringify(cfg, null, 2) }] };
  }
);

await server.connect(new StdioServerTransport());
