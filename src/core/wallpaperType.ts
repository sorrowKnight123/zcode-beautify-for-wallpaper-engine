/**
 * Wallpaper input type detection.
 *
 * Recognizes the inputs this plugin can consume: plain images (the original
 * static-wallpaper path) and Wallpaper Engine scene wallpapers (`.pkg` files
 * or extracted workshop directories with a `project.json`). Video and web
 * wallpapers are detected for accurate messaging even though the import
 * pipeline only accepts scenes.
 *
 * Real-world `project.json` layouts vary (verified against live workshop
 * content): most declare a top-level `type` ("scene" | "video" | "web"), some
 * only an entry `file` (`scene.pkg`, `scene.json`, `*.mp4`, `*.html`), and
 * some publish neither — those are resolved by scanning the directory (root
 * plus the `files/` asset folder WE uses in published layouts).
 */

import fs from "node:fs";
import path from "node:path";

export type WallpaperType = "image" | "scene" | "video" | "web" | "unknown";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm"]);
const SCENE_ENTRY_EXTENSIONS = new Set([".pkg", ".json"]);

/** Detects what kind of wallpaper `input` is; never throws. */
export function detectWallpaperType(input: string): WallpaperType {
  const ext = path.extname(input).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (ext === ".pkg") return "scene";

  let stat: fs.Stats;
  try {
    stat = fs.statSync(input);
  } catch {
    return "unknown";
  }
  if (!stat.isDirectory()) return "unknown";

  return detectDirectoryType(input);
}

function detectDirectoryType(dir: string): WallpaperType {
  const project = readProjectJson(path.join(dir, "project.json"));

  const declared = typeof project?.type === "string" ? project.type.toLowerCase() : "";
  if (declared === "scene" || declared === "video" || declared === "web") {
    return declared;
  }

  const entryExt = path.extname(typeof project?.file === "string" ? project.file : "").toLowerCase();
  if (SCENE_ENTRY_EXTENSIONS.has(entryExt)) return "scene";
  if (VIDEO_EXTENSIONS.has(entryExt)) return "video";
  if (entryExt === ".html" || entryExt === ".htm") return "web";

  return detectFromDirectoryContents(dir);
}

function readProjectJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function detectFromDirectoryContents(dir: string): WallpaperType {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return "unknown";
  }

  // Published workshop layouts keep assets in a `files/` subfolder.
  let nested: string[] = [];
  if (entries.some((e) => e.toLowerCase() === "files")) {
    try {
      nested = fs
        .readdirSync(path.join(dir, "files"))
        .map((e) => path.join("files", e));
    } catch {
      /* unreadable asset folder — root entries only */
    }
  }

  for (const name of [...entries, ...nested]) {
    const lower = name.toLowerCase();
    const ext = path.extname(lower);
    if (lower === "scene.pkg" || lower === "scene.json") return "scene";
    if (ext === ".html" || ext === ".htm") return "web";
    if (VIDEO_EXTENSIONS.has(ext)) return "video";
  }
  return "unknown";
}
