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

import fs from "node:fs";
import path from "node:path";
import { detectWallpaperType } from "./wallpaperType.js";
import { execFileP } from "./exec.js";
import { checkWallpaperEngine, checkFfmpeg } from "./dependencyCheck.js";
import { openSceneWindow, closeSceneWindow, windowIsBlack, SceneWindowBlackError } from "./weLauncher.js";
import { recordSceneWindow, analyzeBlackness } from "./recorder.js";
import { makeSeamless, probeDuration } from "./loopProcessor.js";
import { computeHash, getCachePath, hasCache, touchCache, enforceLimit } from "./cacheManager.js";

export interface SceneImportOptions {
  width?: number;
  height?: number;
  fps?: number;
  /** Raw capture length in seconds; the loop ends up duration - fade. */
  duration?: number;
  fadeSec?: number;
  /** Video imports longer than this are truncated to a middle segment. */
  maxSeconds?: number;
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

/** First .mp4/.webm in the directory root, then its files/ subfolder. */
function findVideoInDir(dir: string): string | undefined {
  for (const subdir of ["", "files"]) {
    const base = path.join(dir, subdir);
    let entries: string[];
    try {
      entries = fs.readdirSync(base);
    } catch {
      continue;
    }
    const hit = entries.find((e) => /\.(mp4|webm)$/i.test(e));
    if (hit) return path.join(base, hit);
  }
  return undefined;
}

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

export const DEFAULT_SCENE_OPTIONS: Required<Pick<SceneImportOptions, "width" | "height" | "fps" | "duration" | "fadeSec" | "title" | "maxCacheBytes" | "maxSeconds">> = {
  width: 1920,
  height: 1080,
  fps: 30,
  duration: 15,
  fadeSec: 1,
  title: "WE_Render",
  maxCacheBytes: 10 * 1024 ** 3,
  maxSeconds: 60,
};

export async function importScene(
  pkgPath: string,
  onProgress: (stage: string, detail?: string) => void = () => undefined,
  options: SceneImportOptions = {},
  ffmpegPath?: string,
): Promise<SceneImportResult> {
  const opts = { ...DEFAULT_SCENE_OPTIONS, ...options };

  onProgress("detect", pkgPath);
  let type = detectWallpaperType(pkgPath);

  // A video input stays a file (the footage itself); a video-type DIRECTORY
  // (WE video wallpapers have project.json too) resolves to the video inside.
  // Everything else may point at any file inside the wallpaper directory.
  try {
    if (type === "video" && fs.statSync(pkgPath).isDirectory()) {
      const videoFile = findVideoInDir(pkgPath);
      if (!videoFile) throw new SceneImportError(`No .mp4/.webm inside video wallpaper directory: ${pkgPath}`);
      pkgPath = videoFile;
    } else if (type !== "video") {
      pkgPath = resolveSceneInput(pkgPath);
      type = detectWallpaperType(pkgPath);
    }
  } catch (err) {
    if (err instanceof SceneImportError) throw err;
    /* stat failed on a nonexistent path — detect below reports it */
  }
  if (type !== "scene" && type !== "video") {
    throw new SceneImportError(`Not a scene or video wallpaper (${type}): ${pkgPath}`);
  }
  const isVideo = type === "video";

  onProgress("deps");
  // Video imports need no Wallpaper Engine — ffmpeg alone suffices.
  const missing: Array<"we" | "ffmpeg"> = [];
  if (!isVideo && !(await checkWallpaperEngine()).ok) missing.push("we");
  if (!(await checkFfmpeg()).ok) missing.push("ffmpeg");
  if (missing.length > 0) throw new MissingDependencyError(missing);

  const hash = isVideo
    ? computeHash(pkgPath, { kind: "video", maxWidth: 1920, maxSeconds: opts.maxSeconds, fadeSec: opts.fadeSec })
    : computeHash(pkgPath, {
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

  if (isVideo) {
    // Direct video wallpaper: no WE window, no recording — the source IS the
    // footage. Normalize (truncate long clips, cap width), loop, poster, cache.
    onProgress("analyzing", pkgPath);
    const sourceDuration = await probeDuration(pkgPath, ffmpegPath ?? (await checkFfmpeg()).path!);
    const trim =
      sourceDuration > opts.maxSeconds
        ? { startAt: (sourceDuration - opts.maxSeconds) / 2, seconds: opts.maxSeconds }
        : undefined;
    if (trim) onProgress("truncating", `${sourceDuration.toFixed(1)}s -> ${opts.maxSeconds}s`);

    onProgress("processing", `crossfade ${opts.fadeSec}s`);
    const tmpLoop = `${loopPath}.tmp.mp4`;
    await makeSeamless(pkgPath, tmpLoop, opts.fadeSec, ffmpegPath, {
      startAt: trim?.startAt,
      seconds: trim?.seconds,
      maxWidth: 1920,
    });

    onProgress("poster");
    await extractPoster(tmpLoop, posterPath, ffmpegPath);

    onProgress("saving", hash);
    fs.mkdirSync(path.dirname(loopPath), { recursive: true });
    fs.renameSync(tmpLoop, loopPath);

    const blackness = await analyzeBlackness(loopPath, ffmpegPath);
    enforceLimit(opts.maxCacheBytes);

    onProgress("done", loopPath);
    return { loopPath, posterPath, hash, blackness, fromCache: false };
  }

  // The render+capture pass, retryable: on hybrid-GPU machines the WE render
  // window comes up black INTERMITTENTLY. The manual-probe procedure (open
  // window, wait 8s, capture) always rendered fine, so the pipeline now
  // mirrors it exactly: longer settle, then a PRE-CHECK frame via GDI before
  // any recording — a black window is re-opened immediately instead of
  // wasting a 15s capture on it.
  // WE must receive the .pkg FILE, never the wallpaper directory (user-found
  // root cause: a directory -file opens a black window on this machine; the
  // probes that always rendered passed the pkg file). Resolve it once:
  let pkgFile = pkgPath;
  try {
    if (fs.statSync(pkgPath).isDirectory()) {
      let declared: string | undefined;
      try {
        declared = (JSON.parse(fs.readFileSync(path.join(pkgPath, "project.json"), "utf8")) as { file?: string }).file;
      } catch { /* fall back to the first .pkg in the dir */ }
      const name =
        declared && /\.pkg$/i.test(declared) && fs.existsSync(path.join(pkgPath, declared))
          ? declared
          : fs.readdirSync(pkgPath).find((e) => /\.pkg$/i.test(e));
      if (!name) throw new SceneImportError(`No scene.pkg inside: ${pkgPath}`);
      pkgFile = path.join(pkgPath, name);
    }
  } catch (err) {
    if (err instanceof SceneImportError) throw err;
    /* non-directory path or unreadable — pass through as-is */
  }
  const renderOnce = async (): Promise<{ rawPath: string }> => {
    onProgress("opening", `window "${opts.title}"`);
    const handle = await openSceneWindow(pkgFile, { width: opts.width, height: opts.height, title: opts.title });
    try {
      onProgress("render-ready", JSON.stringify(handle.client));
      await new Promise((r) => setTimeout(r, 4000)); // let the scene settle
      // WINDOW PRE-CHECK: capture the live window via GDI before committing
      // to a 15s recording. A near-uniform frame (tiny PNG) means the render
      // never attached — bail NOW and reopen, instead of wasting a full
      // capture on a window that stays black.
      const preBlack = await windowIsBlack(opts.title);
      if (preBlack === true) {
        throw new SceneWindowBlackError("窗口渲染未附着(预检帧全黑)");
      }

      onProgress("recording", `${opts.duration}s @ ${opts.fps}fps`);
      const rawPath = path.join(path.dirname(loopPath), `raw-${Date.now()}.mp4`);
      fs.mkdirSync(path.dirname(rawPath), { recursive: true });
      await recordSceneWindow(handle, rawPath, { duration: opts.duration, fps: opts.fps, outWidth: opts.width, outHeight: opts.height }, ffmpegPath);
      return { rawPath };
    } finally {
      onProgress("closing");
      await closeSceneWindow(handle).catch(() => undefined);
    }
  };
  const captureIsBlack = async (file: string): Promise<boolean> => {
    const b = await analyzeBlackness(file, ffmpegPath);
    return b.blackFraction > 0.95;
  };

  // Up to 2 passes on the SAME running WE core (the black root cause was the
  // directory -file, now fixed — no core restart needed). A pre-check black
  // window or a black recording just reopens the window once.
  let rawPath = "";
  let black = true;
  for (let pass = 0; pass < 2 && black; pass++) {
    const out = await renderOnce();
    rawPath = out.rawPath;
    black = await captureIsBlack(rawPath).catch(() => false);
    if (black) {
      onProgress(`black-retry-${pass + 1}`, "reopen window");
      try { fs.rmSync(rawPath, { force: true }); } catch { /* locked */ }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (black) {
    try { if (rawPath) fs.rmSync(rawPath, { force: true }); } catch { /* locked */ }
    throw new SceneImportError(
      "录制画面全黑(已自动重开窗口重试)——请稍候重试或重启 Wallpaper Engine",
    );
  }

  try {
    onProgress("processing", `crossfade ${opts.fadeSec}s`);
    const tmpLoop = `${loopPath}.tmp.mp4`;
    await makeSeamless(rawPath, tmpLoop, opts.fadeSec, ffmpegPath);

    onProgress("poster");
    await extractPoster(tmpLoop, posterPath, ffmpegPath);

    onProgress("saving", hash);
    fs.mkdirSync(path.dirname(loopPath), { recursive: true });
    fs.renameSync(tmpLoop, loopPath);
    fs.rmSync(rawPath, { force: true });

    enforceLimit(opts.maxCacheBytes);

    onProgress("done", loopPath);
    return { loopPath, posterPath, hash, blackness: { blackFraction: black ? 1 : 0, meanLuma: 0, durationSec: opts.duration }, fromCache: false };
  } finally {
    try { fs.rmSync(rawPath, { force: true }); } catch { /* locked */ }
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

