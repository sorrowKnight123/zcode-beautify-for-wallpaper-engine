/**
 * Wallpaper Engine scene-window launcher.
 *
 * Verified behaviors (docs/spike-notes.md) this module relies on:
 * - `wallpaper64.exe -control openWallpaper -file <pkg> -playInWindow <title>`
 *   creates a window whose title is EXACTLY <title>; `-width/-height` are
 *   unreliable (a 1920x1080 request produced a 1280x720 window), so the
 *   window is sized explicitly with SetWindowPos afterwards.
 * - If Wallpaper Engine is already running, the spawned process merely
 *   forwards the command over IPC and exits; the window belongs to the
 *   pre-existing process. The returned handle therefore carries the real
 *   window handle + client rect, and `proc` is diagnostics-only.
 * - Closing must go through `-control closeWallpaper -playInWindow <title>`;
 *   killing the spawn handle would leave the window behind.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { checkWallpaperEngine } from "./dependencyCheck.js";
import { execFileP } from "./exec.js";

const exec = execFileP;

export interface SceneWindowOptions {
  width: number;
  height: number;
  /** Exact window title to use (and later match on); e.g. "WE_Render". */
  title: string;
  /** Outer window position; defaults to centered on the primary display. */
  x?: number;
  y?: number;
}

export interface SceneWindowHandle {
  title: string;
  /** Win32 window handle of the created window. */
  hwnd: number;
  /** Screen-space client rect, measured AFTER positioning (what T4 crops). */
  client: { x: number; y: number; width: number; height: number };
  /** Spawned process — may have exited immediately (IPC handoff). Diagnostics only! */
  proc: ChildProcess | null;
}

export class SceneWindowError extends Error {}

const PS_WINDOW_HELPERS = `
# ddagrab captures PHYSICAL pixels; without DPI awareness PowerShell returns
# logical (virtualized) coordinates and the crop lands on the wrong region.
Add-Type -Namespace N -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[N.Dpi]::SetProcessDPIAware() | Out-Null
Add-Type -Namespace Native -Name Win -MemberDefinition @'
[DllImport("user32.dll")]
public static extern bool SetWindowPos(IntPtr h, IntPtr after, int X, int Y, int cx, int cy, uint flags);
[DllImport("user32.dll")]
public static extern bool GetClientRect(IntPtr h, out RECT r);
[DllImport("user32.dll")]
public static extern bool ClientToScreen(IntPtr h, ref POINT p);
public struct RECT { public int Left, Top, Right, Bottom; }
public struct POINT { public int X, Y; }
'@
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class WinEnum {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int m);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  public static string FindExact(string title) {
    string hit = null;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(256);
      GetWindowText(h, sb, 256);
      if (sb.ToString() == title) { hit = h.ToString(); return false; }
      return true;
    }, IntPtr.Zero);
    return hit;
  }
}
'@
function Find-WindowByTitle([string]$Title) {
  # FindWindowW misbehaves under PowerShell string marshaling for these
  # windows (verified: EnumWindows sees WE_Render, FindWindowW returns 0).
  $r = [WinEnum]::FindExact($Title)
  if ($r) { [long]$r } else { $null }
}
function Measure-Client([IntPtr]$h) {
  $cr = New-Object Native.Win+RECT
  [Native.Win]::GetClientRect($h, [ref]$cr) | Out-Null
  $pt = New-Object Native.Win+POINT
  [Native.Win]::ClientToScreen($h, [ref]$pt) | Out-Null
  ,@($pt.X, $pt.Y, ($cr.Right - $cr.Left), ($cr.Bottom - $cr.Top))
}
`;

/**
 * Opens `pkgPath` in a dedicated Wallpaper Engine window and returns a handle
 * to it. Resolves only after the window exists, is positioned, and its client
 * rect has been measured.
 */
export async function openSceneWindow(
  pkgPath: string,
  opts: SceneWindowOptions,
  wallpaperExePath?: string,
): Promise<SceneWindowHandle> {
  const exe = wallpaperExePath ?? (await checkWallpaperEngine()).path;
  if (!exe) throw new SceneWindowError("Wallpaper Engine not found — cannot open scene window");

  const proc = spawn(exe, [
    "-control", "openWallpaper",
    "-file", pkgPath,
    "-playInWindow", opts.title,
    "-width", String(opts.width),
    "-height", String(opts.height),
  ], { stdio: "ignore", detached: false, windowsHide: true });
  proc.unref();

  const hwnd = await waitForWindow(opts.title, 15_000);
  if (hwnd === null) {
    throw new SceneWindowError(`Window "${opts.title}" did not appear within 15s`);
  }

  const client = await positionWindow(hwnd, opts);
  return { title: opts.title, hwnd, client, proc };
}

/** Closes the scene window via the control IPC and waits until it is gone. */
export async function closeSceneWindow(handle: SceneWindowHandle, wallpaperExePath?: string): Promise<void> {
  const exe = wallpaperExePath ?? (await checkWallpaperEngine()).path;
  if (!exe) throw new SceneWindowError("Wallpaper Engine not found — cannot close scene window");

  await exec(exe, ["-control", "closeWallpaper", "-playInWindow", handle.title], { timeout: 10_000 });

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const still = await findWindowOnce(handle.title);
    if (still === null) return;
    await sleep(300);
  }
  throw new SceneWindowError(`Window "${handle.title}" still present 10s after closeWallpaper`);
}

// --- window helpers (single PowerShell roundtrip per operation) -------------

/** Polls for the window inside one PowerShell process to avoid cold-start costs per iteration. */
async function waitForWindow(title: string, timeoutMs: number): Promise<number | null> {
  const script = `${PS_WINDOW_HELPERS}
$deadline = (Get-Date).AddMilliseconds(${timeoutMs})
while ((Get-Date) -lt $deadline) {
  $h = Find-WindowByTitle '${title}'
  if ($null -ne $h) { Write-Output $h; exit 0 }
  Start-Sleep -Milliseconds 300
}
exit 3`;
  try {
    const { stdout } = await exec("powershell", ["-NoProfile", "-Command", script], { timeout: timeoutMs + 10_000 });
    const hwnd = Number(stdout.trim());
    return Number.isFinite(hwnd) && hwnd > 0 ? hwnd : null;
  } catch {
    return null;
  }
}

async function findWindowOnce(title: string): Promise<number | null> {
  const script = `${PS_WINDOW_HELPERS}
$h = Find-WindowByTitle '${title}'
if ($null -ne $h) { Write-Output $h }`;
  try {
    const { stdout } = await exec("powershell", ["-NoProfile", "-Command", script], { timeout: 15_000 });
    const hwnd = Number(stdout.trim());
    return Number.isFinite(hwnd) && hwnd > 0 ? hwnd : null;
  } catch {
    return null;
  }
}

/** Moves/sizes the window (outer rect) and returns the resulting client rect in screen coords. */
async function positionWindow(
  hwnd: number,
  opts: SceneWindowOptions,
): Promise<SceneWindowHandle["client"]> {
  const script = `${PS_WINDOW_HELPERS}
$h = [IntPtr]${hwnd}
$x = ${opts.x ?? -1}; $y = ${opts.y ?? -1}
$w = ${opts.width}; $hh = ${opts.height}
if ($x -eq -1 -or $y -eq -1) {
  Add-Type -AssemblyName System.Windows.Forms
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $x = [int](($b.Width - $w) / 2); $y = [int](($b.Height - $hh) / 2)
}
[Native.Win]::SetWindowPos($h, [IntPtr]::Zero, $x, $y, $w, $hh, 0x0004) | Out-Null  # SWP_NOZORDER
Start-Sleep -Milliseconds 200
$c = Measure-Client $h
Write-Output ("{0},{1},{2},{3}" -f $c[0], $c[1], $c[2], $c[3])`;
  const { stdout } = await exec("powershell", ["-NoProfile", "-Command", script], { timeout: 15_000 });
  return parseClientRect(stdout, opts.title);
}

/**
 * Re-measures the window's client rect in screen coords. WE repositions/
 * resizes its play window asynchronously after opening, so the rect captured
 * at open time can be stale by the time recording starts — always measure
 * right before capturing (the WE window is topmost at that point).
 */
export async function measureClientRect(hwnd: number, title: string): Promise<SceneWindowHandle["client"]> {
  const script = `${PS_WINDOW_HELPERS}
$c = Measure-Client ([IntPtr]${hwnd})
Write-Output ("{0},{1},{2},{3}" -f $c[0], $c[1], $c[2], $c[3])`;
  const { stdout } = await exec("powershell", ["-NoProfile", "-Command", script], { timeout: 15_000 });
  return parseClientRect(stdout, title);
}

function parseClientRect(stdout: string, title: string): SceneWindowHandle["client"] {
  const [x, y, width, height] = stdout.trim().split(",").map(Number);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new SceneWindowError(`Failed to measure client rect for "${title}" (got "${stdout.trim()}")`);
  }
  return { x, y, width, height };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
