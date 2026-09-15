/**
 * Shared high-level operations used by both the CLI and the MCP server.
 */

import fs from "node:fs";
import path from "node:path";
import { applyToZCode, buildPayload, DEFAULT_CONFIG, loadWallpaper, resetZCode, type BeautifyConfig, type BuiltPayload } from "./inject.js";
import { dataDir, loadConfig, saveConfig } from "./launch.js";
import { detectWallpaperType } from "./wallpaperType.js";
import { importScene, MissingDependencyError, type SceneImportResult } from "./scenePipeline.js";
import { getInstallGuide } from "./dependencyCheck.js";

export interface ApplyOptions {
  port?: number;
  blur?: number;
  dim?: number;
  monet?: boolean;
  wallpaperVisible?: boolean;
  fit?: "cover" | "contain" | "smart";
}

/** Applies (or refreshes) the theme using the stored config. */
export async function reapplyStored(): Promise<number> {
  const config = mergedConfig();
  return applyToZCode(config, await buildPayloadFromConfig(config));
}

export async function applyWallpaper(imagePath: string, opts: ApplyOptions): Promise<{ windows: number; config: BeautifyConfig }> {
  const abs = path.resolve(imagePath);
  if (!fs.existsSync(abs)) throw new Error(`Image not found: ${abs}`);

  // Scene and video wallpapers route through the render pipeline and end up
  // as a loop video + Monet theme from the poster frame.
  const kind = detectWallpaperType(abs);
  if (kind === "scene" || kind === "video") {
    const result = await applySceneWallpaper(abs, opts);
    return { windows: result.windows, config: result.config };
  }

  const stored = loadConfig();
  const config: BeautifyConfig = { ...baseConfig(opts, stored), mediaType: "image", sceneHash: undefined };

  // Keep a copy of the wallpaper inside the data dir so the theme survives
  // the original file being moved/deleted.
  fs.mkdirSync(dataDir(), { recursive: true });
  const dest = path.join(dataDir(), "wallpaper" + path.extname(abs).toLowerCase());
  if (dest !== abs) fs.copyFileSync(abs, dest);

  const assets = await loadWallpaper(dest);
  const payload = buildPayload(config, assets);
  // Persist first: even if the app is not running yet, `launch` + `refresh_theme`
  // can pick the stored theme up later.
  saveConfig({ ...config, wallpaperPath: dest });

  const windows = await applyToZCode(config, payload);
  return { windows, config };
}

export async function applyColorsOnly(opts: ApplyOptions): Promise<number> {
  const stored = loadConfig();
  const config = baseConfig(opts, stored);
  saveConfig(config);
  return applyToZCode(config, await buildPayloadFromConfig(config));
}

/** Merges ApplyOptions over the stored config (CLI/MCP flags win). */
function baseConfig(opts: ApplyOptions, stored: Partial<BeautifyConfig>): BeautifyConfig {
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    port: opts.port ?? stored.port ?? DEFAULT_CONFIG.port,
    blur: opts.blur ?? stored.blur ?? DEFAULT_CONFIG.blur,
    dim: opts.dim ?? stored.dim ?? DEFAULT_CONFIG.dim,
    monet: opts.monet ?? stored.monet ?? DEFAULT_CONFIG.monet,
    wallpaperVisible: opts.wallpaperVisible ?? stored.wallpaperVisible ?? DEFAULT_CONFIG.wallpaperVisible,
    fit: opts.fit ?? stored.fit ?? DEFAULT_CONFIG.fit,
  };
}

/**
 * Imports a Wallpaper Engine scene and applies it as an animated wallpaper.
 * The loop video is served from the serve-mode media endpoint; without a
 * running serve the poster frame is applied as a static wallpaper instead,
 * with an install hint rather than a silent failure.
 */
export async function applySceneWallpaper(
  scenePath: string,
  opts: ApplyOptions & { onProgress?: (stage: string, detail?: string) => void } = {},
): Promise<{ windows: number; config: BeautifyConfig; scene: SceneImportResult; served: boolean }> {
  const abs = path.resolve(scenePath);
  const { importScene } = await import("./scenePipeline.js");

  const scene = await importScene(abs, opts.onProgress ?? (() => undefined));
  const stored = loadConfig();
  const config = baseConfig(opts, stored);
  const apiPort = stored.apiPort ?? 9223;
  const sceneVideoUrl = `http://127.0.0.1:${apiPort}/media/scene/${scene.hash}.mp4`;

  // Serve must be reachable for the renderer to stream the loop; otherwise
  // fall back to the poster frame and tell the user how to get motion.
  const served = await isServeAlive(apiPort);

  const next: BeautifyConfig = {
    ...config,
    mediaType: "video",
    sceneHash: scene.hash,
    wallpaperPath: scene.loopPath,
    apiPort,
    ...(served ? { sceneVideoUrl } : {}),
  };
  saveConfig(next);

  if (!served) {
    console.warn(
      "scene loop stored, but serve is not running — applying the poster frame as a static wallpaper.\n" +
        "Run `zcode-beautify serve --detach` and `refresh_theme` to enable motion.",
    );
    const assets = await loadWallpaper(scene.posterPath);
    const payload = buildPayload({ ...next, sceneVideoUrl: undefined }, assets);
    const windows = await applyToZCode({ ...next, sceneVideoUrl: undefined }, payload);
    return { windows, config: next, scene, served: false };
  }

  const windows = await applyToZCode(next, await buildPayloadFromConfig(next));
  return { windows, config: next, scene, served: true };
}

async function isServeAlive(apiPort: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${apiPort}/api/health`, { signal: AbortSignal.timeout(1200) });
    return ((await res.json()) as { service?: string })?.service === "zcode-beautify";
  } catch {
    return false;
  }
}

export { MissingDependencyError, getInstallGuide };

export async function resetAppearance(port?: number): Promise<number> {
  const stored = loadConfig();
  await resetZCode(port ?? stored.port ?? DEFAULT_CONFIG.port);
  saveConfig({ ...stored, wallpaperPath: undefined, mediaType: undefined, sceneHash: undefined, sceneVideoUrl: undefined });
  return 0;
}

export async function buildPayloadFromConfig(config: BeautifyConfig): Promise<BuiltPayload> {
  let assets;
  if (config.mediaType === "video" && config.wallpaperPath && fs.existsSync(config.wallpaperPath)) {
    // Monet colors come from the poster frame; the loop video streams via HTTP.
    const posterPath = path.join(path.dirname(config.wallpaperPath), "poster.jpg");
    if (fs.existsSync(posterPath)) {
      assets = await loadWallpaper(posterPath);
    }
    const apiPort = config.apiPort ?? 9223;
    if (!config.sceneVideoUrl && config.sceneHash) {
      config = { ...config, sceneVideoUrl: `http://127.0.0.1:${apiPort}/media/scene/${config.sceneHash}.mp4` };
    }
    return buildPayload(config, assets);
  }
  if (config.wallpaperPath && fs.existsSync(config.wallpaperPath)) {
    assets = await loadWallpaper(config.wallpaperPath);
  }
  return buildPayload(config, assets);
}

function mergedConfig(): BeautifyConfig {
  return { ...DEFAULT_CONFIG, ...loadConfig(), port: loadConfig().port ?? DEFAULT_CONFIG.port };
}
