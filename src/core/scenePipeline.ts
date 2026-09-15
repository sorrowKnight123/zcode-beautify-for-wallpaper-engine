/**
 * End-to-end scene wallpaper import pipeline:
 *
 *   detect -> check deps -> cache lookup -> open WE window -> record (ddagrab)
 *   -> close window -> seamless loop -> poster frame -> cache -> enforce LRU
 *
 * Every stage reports progress via onProgress. Rendering happens on the
 * machine itself, so the panel just passes the local wallpaper path — no
 * upload — and the result is served over the serve-mode media endpoint.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { detectWallpaperType } from "./wallpaperType.js";
import { checkWallpaperEngine, checkFfmpeg } from "./dependencyCheck.js";
import { openSceneWindow, closeSceneWindow } from "./weLauncher.js";
import { recordSceneWindow, analyzeBlackness } from "./recorder.js";
import { makeSeamless } from "./loopProcessor.js";
import { computeHash, getCachePath, hasCache, touchCache, enforceLimit } from "./cacheManager.js";

export interface SceneImportOptions {
  width?: number;
  height?: number;
  fps?: number;
  /** Raw capture length in seconds; the loop ends up duration - fade. */
  duration?: number;
  fadeSec?: number;
  /** Window title for the temporary WE render window. */
  title?: string;
  maxCacheBytes?: number;
}

export interface SceneImportResult {
  /** Cached seamless loop video, ready to serve. */
  loopPath: string;
  /** Extracted poster frame (for Monet theming), next to the loop. */
  posterPath: string;
  hash: string;
  /** Advisory footage check: dark wallpapers legitimately score low. */
  blackness: { blackFraction: number; meanLuma: number; durationSec: number };
  /** True when an existing cache entry was reused (no rendering happened). */
  fromCache: boolean;
}

export class MissingDependencyError extends Error {
  constructor(public readonly missing: Array<"we" | "ffmpeg">) {
    super(`Missing dependencies: ${missing.join(", ")}`);
  }
}

export class SceneImportError extends Error {}

/**
 * Accepts the many ways a user can point at a scene wallpaper: a `.pkg`
 * file, the wallpaper directory, or ANY file inside it (file dialogs make
 * users pick something concrete like preview.gif) — walks up to the nearest
 * enclosing `project.json` in that case.
 */
export function resolveSceneInput(input: string): string {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(input);
  } catch {
    return input; // nonexistent: let detectWallpaperType report it
  }
  if (stat.isDirectory()) return input;
  if (input.toLowerCase().endsWith(".pkg")) return input;
  let dir = path.dirname(path.resolve(input));
  for (let hop = 0; hop < 4; hop++) {
    if (fs.existsSync(path.join(dir, "project.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return input;
}

export const DEFAULT_SCENE_OPTIONS: Required<Pick<SceneImportOptions, "width" | "height" | "fps" | "duration" | "fadeSec" | "title" | "maxCacheBytes">> = {
  width: 1920,
  height: 1080,
  fps: 30,
  duration: 15,
  fadeSec: 1,
  title: "WE_Render",
  maxCacheBytes: 10 * 1024 ** 3,
};

export async function importScene(
  pkgPath: string,
  onProgress: (stage: string, detail?: string) => void = () => undefined,
  options: SceneImportOptions = {},
  ffmpegPath?: string,
): Promise<SceneImportResult> {
  const opts = { ...DEFAULT_SCENE_OPTIONS, ...options };

  pkgPath = resolveSceneInput(pkgPath);
  onProgress("detect", pkgPath);
  const type = detectWallpaperType(pkgPath);
  if (type !== "scene") {
    throw new SceneImportError(`Not a scene wallpaper (${type}): ${pkgPath}`);
  }

  onProgress("deps");
  const missing: Array<"we" | "ffmpeg"> = [];
  if (!(await checkWallpaperEngine()).ok) missing.push("we");
  if (!(await checkFfmpeg()).ok) missing.push("ffmpeg");
  if (missing.length > 0) throw new MissingDependencyError(missing);

  const hash = computeHash(pkgPath, {
    width: opts.width,
    height: opts.height,
    fps: opts.fps,
    duration: opts.duration,
    fadeSec: opts.fadeSec,
  });
  const loopPath = getCachePath(hash);
  const posterPath = path.join(path.dirname(loopPath), "poster.jpg");

  if (hasCache(hash)) {
    onProgress("cache-hit", hash);
    touchCache(hash);
    enforceLimit(opts.maxCacheBytes);
    return { loopPath, posterPath, hash, blackness: { blackFraction: -1, meanLuma: -1, durationSec: -1 }, fromCache: true };
  }

  onProgress("opening", `window "${opts.title}"`);
  const handle = await openSceneWindow(pkgPath, { width: opts.width, height: opts.height, title: opts.title });
  try {
    onProgress("render-ready", JSON.stringify(handle.client));
    await new Promise((r) => setTimeout(r, 3000)); // let the scene settle

    onProgress("recording", `${opts.duration}s @ ${opts.fps}fps`);
    const rawPath = path.join(path.dirname(loopPath), `raw-${Date.now()}.mp4`);
    fs.mkdirSync(path.dirname(rawPath), { recursive: true });
    try {
      await recordSceneWindow(handle, rawPath, { duration: opts.duration, fps: opts.fps, outWidth: opts.width, outHeight: opts.height }, ffmpegPath);
    } finally {
      onProgress("closing");
      await closeSceneWindow(handle).catch(() => undefined);
    }

    onProgress("processing", `crossfade ${opts.fadeSec}s`);
    const tmpLoop = `${loopPath}.tmp.mp4`;
    await makeSeamless(rawPath, tmpLoop, opts.fadeSec, ffmpegPath);

    onProgress("poster");
    await extractPoster(tmpLoop, posterPath, ffmpegPath);

    onProgress("saving", hash);
    fs.mkdirSync(path.dirname(loopPath), { recursive: true });
    fs.renameSync(tmpLoop, loopPath);
    fs.rmSync(rawPath, { force: true });

    const blackness = await analyzeBlackness(loopPath, ffmpegPath);
    enforceLimit(opts.maxCacheBytes);

    onProgress("done", loopPath);
    return { loopPath, posterPath, hash, blackness, fromCache: false };
  } finally {
    // If anything above threw, make sure the WE window never lingers.
    await closeSceneWindow(handle).catch(() => undefined);
  }
}

/** Grabs a representative frame for Monet color extraction. */
export async function extractPoster(loopFile: string, posterPath: string, ffmpegPath?: string): Promise<void> {
  const ffmpeg = ffmpegPath ?? (await checkFfmpeg()).path;
  if (!ffmpeg) throw new SceneImportError("ffmpeg not found");
  fs.mkdirSync(path.dirname(path.resolve(posterPath)), { recursive: true });
  await execFileP(ffmpeg, [
    "-y", "-loglevel", "error",
    "-ss", "1", // skip the crossfade's darkest opening moment
    "-i", loopFile,
    "-frames:v", "1", "-update", "1",
    "-q:v", "2",
    posterPath,
  ], { timeout: 60_000 });
}

function execFileP(
  cmd: string,
  args: string[],
  opts: { timeout: number },
): Promise<{ stdout: string; stderr: string }> {
  return promisify(execFile)(cmd, args, opts);
}
