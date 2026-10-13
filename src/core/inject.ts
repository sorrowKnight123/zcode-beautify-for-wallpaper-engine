/**
 * Assembles the full injected payload: wallpaper layer CSS + variable
 * overrides, plus helpers to apply a theme to a running ZCode instance.
 */

import { CdpConnection, injectIntoTarget, isUpdaterTarget, listTargets, pickRendererTargets, buildBootstrapScript, buildResetScript } from "./cdp.js";
import { loadWallpaper, type WallpaperAssets } from "./monet.js";
import { buildVariableOverrides, buildTransparencyOverrides } from "./tokens.js";
import { dataDir } from "./launch.js";
import path from "node:path";

export type WallpaperFit = "cover" | "contain" | "smart";

/** Wallpaper switching effects; compositor-friendly where possible. */
export type WallpaperTransition = "fade" | "none" | "slide" | "zoom" | "blur";

/**
 * Rotation modes: "sequence" plays every entry for its duration in order and
 * loops; "random" does the same but never repeats the current entry back to
 * back; "schedule" switches at the entry's daily clock time.
 */
export type RotationMode = "sequence" | "random" | "schedule";

/** One playlist item: a wallpaper reference plus how long it stays on. */
export interface RotationEntry {
  /** sequence/random: play duration in seconds (>= 10). */
  seconds?: number;
  /** schedule: daily local clock time, "HH:MM" (24h). */
  time?: string;
  /** Scene loop reference: cache hash (scenes/<hash>/loop.mp4). */
  hash?: string;
  /** Static image reference: absolute path inside the data dir. */
  path?: string;
}

/** A named, self-contained playback plan: mode, transition effect, playlist. */
export interface RotationPlan {
  id: string;
  name: string;
  mode: RotationMode;
  /** Switching effect used while this plan is active (default "fade"). */
  transition?: WallpaperTransition;
  /** Optional daily activation window "HH:MM"-"HH:MM" (overnight spans ok):
   *  while "now" is inside, this plan plays regardless of activePlanId. */
  window?: { start: string; end: string };
  entries: RotationEntry[];
}

/**
 * Wallpaper rotation (定时播放): several saved plans, one of them active.
 * Configs written before plans existed carry a flat mode+entries pair and
 * are normalized into a single "默认方案" on read.
 */
export interface RotationConfig {
  enabled: boolean;
  /** Which plan plays; falls back to plans[0] when unset or unknown. */
  activePlanId?: string;
  plans: RotationPlan[];
}

/**
 * Zone-refined chat-area look (聊天界面): four independent masks layered
 * between the wallpaper and the UI, each a 0-100 density.
 */
export interface ChatLookConfig {
  /** Extra darkening behind the conversation column (聊天区暗度). */
  chatDim: number;
  /** Top-edge fading mask (遮罩上端浓度). */
  maskTop: number;
  /** Bottom-edge fading mask (遮罩下端浓度). */
  maskBottom: number;
  /** Whole-window white frost sheet (大容器偏白). */
  frost: number;
}

/** Clamp a partial chat look to four ints 0-100 (missing values become 0). */
export function normalizeChatLook(raw?: Partial<ChatLookConfig>): ChatLookConfig {
  const pct = (v: unknown): number =>
    typeof v === "number" && v >= 0 && v <= 100 ? Math.round(v) : 0;
  return {
    chatDim: pct(raw?.chatDim),
    maskTop: pct(raw?.maskTop),
    maskBottom: pct(raw?.maskBottom),
    frost: pct(raw?.frost),
  };
}

export interface BeautifyConfig {
  port: number;
  wallpaperPath?: string;
  blur: number;
  dim: number;
  monet: boolean;
  wallpaperVisible: boolean;
  fit: WallpaperFit;
  /**
   * Scene wallpapers: URL of the cached loop video (serve media endpoint).
   * When set, the wallpaper layer renders a <video> instead of an image.
   */
  sceneVideoUrl?: string;
  /** "video" when the current wallpaper is an imported scene wallpaper. */
  mediaType?: "image" | "video";
  /** Cache hash of the imported scene (loop at scenes/<hash>/loop.mp4). */
  sceneHash?: string;
  /** Serve API port used to derive sceneVideoUrl (default 9223). */
  apiPort?: number;
  /** Wallpaper rotation playlist (定时播放). */
  rotation?: RotationConfig;
  /** Slow pan/zoom breathing on static image wallpapers (Ken Burns). */
  kenBurns?: boolean;
  /** Video wallpaper audio 0-100 (0 = muted; wallpapers default silent). */
  videoVolume?: number;
  /** Pinned Monet source color "#rrggbb" overriding extraction. */
  themeColor?: string;
  /** Zone-refined chat-area masks (聊天界面); absent = all zero. */
  chatLook?: Partial<ChatLookConfig>;
  /** Hide wallpaper+panel during ZCode's startup screen (default true). */
  startupClean?: boolean;
  /** Beautify ZCode's update-status window too (default false — stays stock). */
  showOnUpdater?: boolean;
  /** Import resolution: "auto" follows the wallpaper project size, else WxH. */
  importRes?: { mode: string; width?: number; height?: number };
  /** Day/night look schedule (护眼): two dim/blur presets switching by time. */
  dayNight?: {
    enabled: boolean;
    start: string;
    end: string;
    dayDim: number;
    nightDim: number;
    dayBlur: number;
    nightBlur: number;
  };
}

export const DEFAULT_CONFIG: BeautifyConfig = {
  port: 9222,
  blur: 0,
  dim: 25,
  monet: true,
  wallpaperVisible: true,
  fit: "cover",
};

export interface BuiltPayload {
  css: string;
  wallpaperDataUri?: string;
  /** Set for scene wallpapers: the loop video URL for the <video> layer. */
  videoSrc?: string;
  /** How the wallpaper layer is framed; "contain" adds a blurred backdrop. */
  fit: "cover" | "contain";
  /** Switching effect the bootstrap overlay should play. */
  transition: WallpaperTransition;
  /** Normalized focus point for background-position. */
  focusX: number;
  focusY: number;
  /** True when Ken Burns motion applies to the current image wallpaper. */
  kenBurns: boolean;
  /** Video wallpaper audio volume 0-100 (0 = muted). */
  videoVolume: number;
  /** Zone-refined chat-area masks (聊天界面), normalized 0-100. */
  chatLook?: ChatLookConfig;
  /** Defer mounting until the ZCode startup screen is gone (default true). */
  startupClean?: boolean;
}

/** The switching effect comes from the active rotation plan (fallback fade). */
function activePlanTransition(rotation: RotationConfig | undefined): WallpaperTransition {
  const plans = rotation?.plans;
  if (!plans?.length) return "fade";
  const plan = plans.find((p) => p.id === rotation?.activePlanId) ?? plans[0];
  return plan?.transition ?? "fade";
}

export function buildPayload(config: BeautifyConfig, assets?: WallpaperAssets, mediaToken = ""): BuiltPayload {
  const parts: string[] = [];
  const tok = mediaToken ? (u: string) => `${u}?t=${mediaToken}` : (u: string) => u;

  // "smart" resolves to the analyzed suggestion at build time, so the injected
  // CSS only ever deals with cover or contain.
  const resolved: "cover" | "contain" =
    config.fit === "smart" ? (assets?.focus.fit ?? "cover") : config.fit === "contain" ? "contain" : "cover";
  const focusX = config.fit === "smart" ? (assets?.focus.x ?? 0.5) : 0.5;
  const focusY = config.fit === "smart" ? (assets?.focus.y ?? 0.5) : 0.5;
  const position = `${Math.round(focusX * 100)}% ${Math.round(focusY * 100)}%`;

  parts.push(`
html, body { background: transparent !important; }
#zcode-beautify-wallpaper {
  position: fixed;
  inset: 0;
  z-index: -2147483646;
  background-size: ${resolved};
  background-position: ${resolved === "contain" ? "center" : position};
  background-repeat: no-repeat;
  pointer-events: none;
  filter: blur(${config.blur}px);
  transform: scale(${config.blur > 0 ? 1.04 : 1});
}
#zcode-beautify-backdrop {
  position: fixed;
  inset: 0;
  z-index: -2147483647;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  pointer-events: none;
  filter: blur(28px) saturate(1.15) brightness(0.85);
  transform: scale(1.12);
  display: none;
}
#zcode-beautify-backdrop[data-on="1"] { display: block; }`);
  if (config.dim > 0) {
    parts.push(`#zcode-beautify-wallpaper::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / var(--zcode-beautify-dim, ${config.dim / 100}));
}`);
  }

  if (assets) {
    // Monet recolors the UI from the wallpaper; the wallpaper toggle only
    // decides whether the picture is visible at all. With Monet off we still
    // need transparency, otherwise the opaque UI hides the wallpaper.
    if (config.monet) {
      parts.push(buildVariableOverrides(assets.theme, {
        dim: config.dim,
        wallpaperVisible: config.wallpaperVisible,
      }));
    } else if (config.wallpaperVisible) {
      parts.push(buildTransparencyOverrides({ dim: config.dim }));
    }
  }
  // Library images stream over the serve media endpoint instead of a base64
  // data URI: a multi-MB payload means a huge CDP evaluate + a second decode
  // in the renderer, while the browser caches by URL — switching is far
  // faster. Wallpapers outside the data dir keep the inline fallback.
  let wallpaperDataUri: string | undefined;
  if (!config.sceneVideoUrl && config.wallpaperVisible) {
    // Normalize separators/case so forward-slash paths match too.
    const p = path.resolve(config.wallpaperPath ?? "").toLowerCase();
    const dir = path.resolve(dataDir()).toLowerCase();
    if (p.startsWith(dir + path.sep) && /\.(jpe?g|png|webp|bmp)$/i.test(p)) {
      wallpaperDataUri = tok(`http://127.0.0.1:${config.apiPort ?? 9223}/media/lib/${encodeURIComponent(path.basename(config.wallpaperPath!))}`);
    } else {
      wallpaperDataUri = assets?.dataUri;
    }
  }
  const videoSrc = config.wallpaperVisible && config.sceneVideoUrl ? tok(config.sceneVideoUrl) : undefined;
  // Ken Burns animates the wallpaper layer's transform — only meaningful for
  // a static image (a video plays its own motion) and with blur off (blur
  // already occupies the transform).
  const kenBurns = Boolean(config.kenBurns) && !videoSrc && config.blur === 0 && Boolean(wallpaperDataUri);

  return {
    css: parts.join("\n"),
    wallpaperDataUri,
    videoSrc,
    fit: config.wallpaperVisible ? resolved : "cover",
    transition: activePlanTransition(config.rotation),
    focusX,
    focusY,
    kenBurns,
    videoVolume: Math.max(0, Math.min(100, Math.round(config.videoVolume ?? 0))),
    chatLook: normalizeChatLook(config.chatLook),
    startupClean: config.startupClean !== false,
  };
}

export interface InjectScriptInput {
  mediaType: "image" | "video";
  /** Image file path / data URI, or the loop video URL for video type. */
  path: string;
  blur: number;
  dim: number;
  fit?: "cover" | "contain";
}

/**
 * Thin convenience wrapper that builds a standalone injection script from a
 * minimal input — used by tests and quick one-off injections. Full theming
 * flows through buildPayload().
 */
export function buildInjectScript(input: InjectScriptInput): string {
  let css = `
html, body { background: transparent !important; }
#zcode-beautify-wallpaper {
  position: fixed;
  inset: 0;
  z-index: -2147483646;
  pointer-events: none;
  filter: blur(${input.blur}px);
  transform: scale(${input.blur > 0 ? 1.04 : 1});
}
#zcode-beautify-wallpaper > video,
#zcode-beautify-wallpaper {
  width: 100%;
  height: 100%;
  object-fit: cover;
}`;
  if (input.dim > 0) {
    css += `
#zcode-beautify-wallpaper::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / ${input.dim / 100});
}`;
  }

  if (input.mediaType === "video") {
    return buildBootstrapScript({ css, videoSrc: input.path, fit: input.fit ?? "cover", transition: "fade" });
  }
  const src = /^(data:|https?:|file:)/i.test(input.path)
    ? input.path
    : `file:///${input.path.replace(/\\/g, "/").replace(/^\/+/, "")}`;
  return buildBootstrapScript({ css, wallpaperDataUri: src, fit: input.fit ?? "cover", transition: "fade" });
}

/** Apply config to a running ZCode instance. Returns how many windows got it. */
export async function applyToZCode(config: BeautifyConfig, payload: BuiltPayload): Promise<number> {
  const targets = pickRendererTargets(await listTargets(config.port));
  if (targets.length === 0) {
    throw new Error("No ZCode renderer target found on the CDP endpoint.");
  }
  let count = 0;
  for (const target of targets) {
    // The update-status window is opt-in; skip it unless configured otherwise.
    if (isUpdaterTarget(target) && config.showOnUpdater !== true) continue;
    try {
      await injectIntoTarget(target, payload);
      count++;
    } catch (err) {
      console.warn(`Injection into "${target.title}" failed: ${(err as Error).message}`);
    }
  }
  return count;
}

export async function resetZCode(port: number): Promise<number> {
  const targets = pickRendererTargets(await listTargets(port));
  let count = 0;
  for (const target of targets) {
    try {
      const conn = await CdpConnection.connect(target.webSocketDebuggerUrl!);
      await conn.send("Runtime.evaluate", { expression: buildResetScript() });
      conn.close();
      count++;
    } catch (err) {
      console.warn(`Reset of "${target.title}" failed: ${(err as Error).message}`);
    }
  }
  return count;
}

/** Re-export so CLI/MCP can load wallpapers without touching monet internals. */
export { loadWallpaper };
