/**
 * External dependency detection for dynamic (scene) wallpaper support:
 * Wallpaper Engine (renderer executable) and ffmpeg (>= 5.0, for ddagrab).
 *
 * Detection never throws — a missing tool yields { ok: false } plus an
 * install guide string for the UI. Windows only; on other platforms both
 * checks simply report not-ok.
 *
 * Verified on a live machine (see docs/spike-notes.md): Steam may live on a
 * non-default drive (D:\SteamLibrary) and the registry may not expose
 * SteamPath, so library discovery parses libraryfolders.vdf and scans drive
 * roots instead of trusting a single hardcoded path.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execRaw = promisify(execFile);
/** windowsHide: console helpers (powershell/ffmpeg) must never flash a terminal window. */
const exec = ((cmd: any, args: any, opts: any) => execRaw(cmd, args, { windowsHide: true, ...opts })) as unknown as typeof execRaw;

export interface DependencyStatus {
  ok: boolean;
  /** Path of the detected executable, when found. */
  path?: string;
  /** Human-readable detection detail (which probe matched, version, …). */
  detail?: string;
}

const WE_EXE_RELATIVE = path.join("wallpaper_engine", "wallpaper64.exe");
/** ffmpeg major version that introduced the ddagrab filter. */
const MIN_FFMPEG_MAJOR = 5;

/**
 * Locates wallpaper64.exe. Probe order (first hit wins):
 * 1. a running wallpaper64.exe process (strongest signal, no install needed)
 * 2. HKLM\SOFTWARE\Wallpaper Engine registry key
 * 3. Steam libraries parsed from libraryfolders.vdf (default Steam roots)
 * 4. drive-root library scans (D:\SteamLibrary, E:\Steam, …)
 * 5. `where wallpaper64` on PATH
 */
export async function checkWallpaperEngine(): Promise<DependencyStatus> {
  if (process.platform !== "win32") {
    return { ok: false, detail: "Wallpaper Engine is Windows-only" };
  }

  const running = await findRunningWallpaperProcess();
  if (running) return { ok: true, path: running, detail: "detected via running wallpaper64.exe process" };

  const registry = await findWallpaperInRegistry();
  if (registry) return { ok: true, path: registry, detail: "detected via HKLM\\SOFTWARE\\Wallpaper Engine" };

  for (const candidate of steamLibraryCandidates()) {
    const exe = path.join(candidate, WE_EXE_RELATIVE);
    if (isFile(exe)) return { ok: true, path: exe, detail: `detected via Steam library ${candidate}` };
  }

  const onPath = await whereExecutable("wallpaper64.exe");
  if (onPath[0]) return { ok: true, path: onPath[0], detail: "detected on PATH" };

  return { ok: false, detail: "wallpaper64.exe not found in registry, Steam libraries or PATH" };
}

/**
 * Locates ffmpeg on PATH (or via the ZCODE_BEAUTIFY_FFMPEG env override) and
 * verifies the version supports ddagrab (>= 5.0).
 */
export async function checkFfmpeg(): Promise<DependencyStatus> {
  const override = process.env.ZCODE_BEAUTIFY_FFMPEG;
  const candidates = override ? [override, ...(await whereExecutable("ffmpeg"))] : await whereExecutable("ffmpeg");

  for (const candidate of candidates) {
    const exe = isFile(candidate) ? candidate : undefined;
    if (!exe) continue;
    const version = await ffmpegVersion(exe);
    if (version === undefined) continue;
    if (version.major < MIN_FFMPEG_MAJOR) {
      return {
        ok: false,
        path: exe,
        detail: `ffmpeg ${version.raw} found but ddagrab needs >= ${MIN_FFMPEG_MAJOR}.0`,
      };
    }
    return { ok: true, path: exe, detail: `ffmpeg ${version.raw}` };
  }

  return { ok: false, detail: "ffmpeg not found on PATH" + (override ? ` (env override ${override} not usable)` : "") };
}

/**
 * Install guidance for the settings panel / CLI. Returns one readable block
 * covering every missing dependency; empty when nothing is missing.
 */
export function getInstallGuide(missing: Array<"we" | "ffmpeg">): string {
  const sections: string[] = [];
  if (missing.includes("we")) {
    sections.push(
      [
        "## Wallpaper Engine 未检测到",
        "",
        "1. 通过 Steam 安装 Wallpaper Engine（商店页：https://store.steampowered.com/app/431960）。",
        "2. 启动一次 Wallpaper Engine，并至少订阅一个「场景（Scene）」类型壁纸。",
        "3. 如果安装在非默认 Steam 库，无需额外配置——插件会自动扫描所有 Steam 库。",
        "4. 安装完成后点击「已安装，重试」。",
      ].join("\n"),
    );
  }
  if (missing.includes("ffmpeg")) {
    sections.push(
      [
        "## ffmpeg 未检测到（需要 5.0 或更高版本）",
        "",
        "任选一种方式安装：",
        "",
        "- winget：`winget install Gyan.FFmpeg`（推荐，自动加入 PATH）",
        "- 手动：从 https://www.gyan.dev/ffmpeg/builds/ 下载 essentials 版，",
        "  解压后把 bin 目录加入 PATH，或设置环境变量 ZCODE_BEAUTIFY_FFMPEG 指向 ffmpeg.exe。",
        "",
        "安装完成后重启终端（让 PATH 生效），再点击「已安装，重试」。",
      ].join("\n"),
    );
  }
  return sections.join("\n\n");
}

// --- probes -----------------------------------------------------------------

async function findRunningWallpaperProcess(): Promise<string | undefined> {
  try {
    const { stdout } = await exec("powershell", [
      "-NoProfile",
      "-Command",
      "(Get-CimInstance Win32_Process -Filter \"Name='wallpaper64.exe'\" | Select-Object -First 1).ExecutablePath",
    ], { timeout: 8000 });
    const p = stdout.trim();
    return p && isFile(p) ? p : undefined;
  } catch {
    return undefined;
  }
}

async function findWallpaperInRegistry(): Promise<string | undefined> {
  for (const key of ["HKLM\\SOFTWARE\\Wallpaper Engine", "HKCU\\SOFTWARE\\Wallpaper Engine"]) {
    try {
      const { stdout } = await exec("reg", ["query", key, "/v", "InstallPath"], { timeout: 5000 });
      const match = /\sInstallPath\s+REG_SZ\s+(.+)/.exec(stdout);
      const dir = match?.[1]?.trim();
      if (dir) {
        const exe = path.join(dir, "wallpaper64.exe");
        if (isFile(exe)) return exe;
      }
    } catch {
      /* key absent — try next */
    }
  }
  return undefined;
}

/**
 * Steam library roots: parse libraryfolders.vdf from the default Steam
 * install locations, then fall back to scanning common library folder names
 * on every drive root (covers installs where the vdf is missing too).
 */
function steamLibraryCandidates(): string[] {
  const candidates = new Set<string>();

  const vdfRoots = [
    "C:\\Program Files (x86)\\Steam",
    "C:\\Program Files\\Steam",
    ...driveRoots().flatMap((d) => [path.join(d, "Steam"), path.join(d, "SteamLibrary")]),
  ];
  for (const root of vdfRoots) {
    const vdf = path.join(root, "steamapps", "libraryfolders.vdf");
    for (const lib of parseVdfPaths(readFileSafe(vdf))) candidates.add(lib);
  }

  for (const drive of driveRoots()) {
    for (const name of ["SteamLibrary", "Steam", "Games\\Steam", "Program Files (x86)\\Steam"]) {
      candidates.add(path.join(drive, name));
    }
  }
  return [...candidates];
}

/** Extracts the value of every `"path" "X"` line from a libraryfolders.vdf. */
export function parseVdfPaths(vdf: string): string[] {
  const paths: string[] = [];
  for (const match of vdf.matchAll(/"path"\s*"([^"]+)"/gi)) {
    paths.push(match[1].replace(/\\\\/g, "\\"));
  }
  return paths;
}

function driveRoots(): string[] {
  const roots: string[] = [];
  for (let i = 67; i <= 90; i++) {
    // C..Z
    const drive = `${String.fromCharCode(i)}:\\`;
    try {
      fs.accessSync(drive);
      roots.push(drive);
    } catch {
      /* drive absent */
    }
  }
  return roots;
}

async function whereExecutable(name: string): Promise<string[]> {
  try {
    const { stdout } = await exec("where", [name], { timeout: 5000 });
    return stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

async function ffmpegVersion(exe: string): Promise<{ raw: string; major: number } | undefined> {
  try {
    const { stdout } = await exec(exe, ["-version"], { timeout: 8000 });
    const match = /ffmpeg version (\S+)/.exec(stdout);
    if (!match) return undefined;
    const raw = match[1];
    // Handles "9.0.1", "6.1.1", "n7.1-esbuild", "2024-00-00-git-…" style tags.
    const numeric = raw.replace(/^n/i, "").match(/^(\d+)/);
    if (!numeric) return { raw, major: Number.MAX_SAFE_INTEGER }; // git master: assume recent
    return { raw, major: Number(numeric[1]) };
  } catch {
    return undefined;
  }
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function readFileSafe(p: string): string {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}
