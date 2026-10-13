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
/** Raised by the pipeline pre-check (not a user-facing failure). */
export class SceneWindowBlackError extends Error {}

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
 * Kills any running Wallpaper Engine and starts a FRESH core instance.
 *
 * The long-running core degrades over repeated playInWindow cycles — windows
 * come up black (forever, not late), and eventually stop appearing at all.
 * Every probe run right after a core restart rendered fine, so imports now
 * begin from a clean core every time. The desktop wallpaper is NOT affected
 * (it is not played by WE); an open WE UI dies with the core — that is
 * accepted: the UI is exactly what accelerates the degradation.
 */
export async function ensureFreshCore(wallpaperExePath?: string): Promise<void> {
  const exe = wallpaperExePath ?? (await checkWallpaperEngine()).path;
  if (!exe) throw new SceneWindowError("Wallpaper Engine not found");

  // Kill the old core and CONFIRM it is fully gone: wallpaper64 is
  // single-instance, so a not-yet-dead old core turns the freshly started
  // exe into a mere -control forwarder that exits — leaving the degraded
  // core in charge and the next window black.
  const countCores = async (): Promise<number> => {
    const out = await exec(
      "powershell",
      ["-NoProfile", "-Command", "(Get-Process wallpaper64 -ErrorAction SilentlyContinue | Measure-Object).Count"],
      { timeout: 10_000 },
    ).catch(() => ({ stdout: "-1" }));
    return Number(out.stdout.trim());
  };
  for (let i = 0; i < 12 && (await countCores()) > 0; i++) {
    if (i === 0) {
      await exec(
        "powershell",
        ["-NoProfile", "-Command", "Get-Process wallpaper64 -ErrorAction SilentlyContinue | Stop-Process -Force"],
        { timeout: 15_000 },
      ).catch(() => undefined);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await new Promise((r) => setTimeout(r, 1500));

  // The core MUST be started in an independent environment. Spawning it
  // directly from serve (a wscript-hidden, console-less chain) produces a
  // core whose render windows come up BLACK — while the identical sequence
  // from a normal shell renders fine (verified end-to-end). Start-Process
  // breaks the inheritance and gives the core a clean environment of its own.
  await exec(
    "powershell",
    ["-NoProfile", "-Command", `Start-Process -FilePath '${exe.replace(/'/g, "''")}'`],
    { timeout: 15_000 },
  ).catch(() => undefined);
  // Flat warm-up: process-alive is NOT readiness (a young core accepts
  // -control but its renderer still yields black frames for several more
  // seconds on this hybrid-GPU machine).
  await new Promise((r) => setTimeout(r, 15_000));
}

/**
 * True when the given window's live pixels are (near-)uniform — the black
 * render. Uses PrintWindow(PW_CLIENTONLY|PW_RENDERFULLCONTENT) exactly like
 * the recorder (client-only, so the title bar never brightens the probe),
 * which stays accurate even while the window sits BEHIND ZCode (a screen
 * CopyFromScreen here would capture whatever covers the window instead).
 * Returns null when the window cannot be captured (treated as "not black").
 */
export async function windowIsBlack(title: string): Promise<boolean | null> {
  const script = `
Add-Type -AssemblyName System.Drawing
$p = Get-Process | Where-Object { $_.MainWindowTitle -eq '${title.replace(/'/g, "''")}' } | Select-Object -First 1
if ($p) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class ZB2 {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
}
'@
  $r = New-Object ZB2+RECT
  [ZB2]::GetClientRect($p.MainWindowHandle, [ref]$r) | Out-Null
  $w = $r.R - $r.L; $h = $r.B - $r.T
  if ($w -gt 0 -and $h -gt 0) {
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc = $g.GetHdc()
    [ZB2]::PrintWindow($p.MainWindowHandle, $hdc, 3) | Out-Null
    $g.ReleaseHdc($hdc); $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output $ms.Length
  } else { Write-Output -1 }
} else { Write-Output -1 }`;
  try {
    const { stdout } = await exec("powershell", ["-NoProfile", "-Command", script], { timeout: 15_000 });
    const bytes = Number(stdout.trim());
    if (!Number.isFinite(bytes) || bytes < 0) return null;
    return bytes < 30000; // a rendered frame is 150KB+; black is <30KB
  } catch {
    return null;
  }
}

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
  ], { stdio: "ignore", detached: true, windowsHide: true });
  proc.unref();

  const hwnd = await waitForWindow(opts.title, 15_000);
  if (hwnd === null) {
    throw new SceneWindowError(`Window "${opts.title}" did not appear within 15s`);
  }

  // NO SetWindowPos repositioning (size/move): every manual probe rendered
  // fine, while the pipeline that moved the window right after creation came
  // up black on this hybrid-GPU machine. The recorder crops by the MEASURED
  // client rect, so the window stays wherever WE placed it.
  const client = await measureClientRect(hwnd, opts.title);
  // Z-ORDER ONLY: sink the render window to the BOTTOM of the stack so it
  // never covers the user's work — capture is PrintWindow-based and works
  // fully occluded (HWND_BOTTOM after pointer = 1; flags 0x3 = NOMOVE|NOSIZE
  // and no activation). The window is visible only for the instant between
  // WE creating it and this call.
  await exec("powershell", [
    "-NoProfile", "-Command",
    `Add-Type -Namespace N -Name Z -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);'
[N.Z]::SetWindowPos([IntPtr]${hwnd}, [IntPtr]1, 0, 0, 0, 0, 0x0003) | Out-Null`,
  ], { timeout: 10_000 }).catch(() => undefined);
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
