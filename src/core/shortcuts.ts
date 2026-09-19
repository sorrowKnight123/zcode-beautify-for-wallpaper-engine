/**
 * Persists the CDP debug-port flag into every ZCode launch shortcut.
 *
 * ZCode only accepts --remote-debugging-port at process start, so a shortcut
 * without it means no injection for that whole session (wallpaper/panel never
 * appear). Scans the usual .lnk locations, appends the flag where missing.
 * Idempotent; the all-users Start Menu may need elevation — reported, never
 * prompted (no UAC popups from a background serve).
 */

import fs from "node:fs";
import path from "node:path";
import { execFileP as exec } from "./exec.js";

export interface ShortcutSyncResult {
  /** Shortcuts that gained the flag this run. */
  updated: string[];
  /** Shortcuts already carrying the flag (or not pointing at ZCode.exe). */
  skipped: string[];
  /** Shortcuts that could not be saved (typically ProgramData without elevation). */
  failed: Array<{ path: string; reason: string }>;
}

/** Directories that hold ZCode launch shortcuts, in priority order. */
function shortcutDirs(): string[] {
  const home = process.env.USERPROFILE ?? "";
  const appData = process.env.APPDATA ?? "";
  return [
    // Desktop may be OneDrive-redirected; cover both physical locations.
    path.join(home, "Desktop"),
    ...(process.env.OneDrive ? [path.join(process.env.OneDrive, "Desktop")] : []),
    path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs"),
    path.join("C:", "ProgramData", "Microsoft", "Windows", "Start Menu", "Programs"),
    path.join(appData, "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar"),
  ];
}

export async function ensureShortcutsHaveCdpFlag(port: number): Promise<ShortcutSyncResult> {
  if (process.platform !== "win32") return { updated: [], skipped: [], failed: [] };

  const flag = `--remote-debugging-port=${port}`;
  const result: ShortcutSyncResult = { updated: [], skipped: [], failed: [] };

  const links: string[] = [];
  const collect = (dir: string) => {
    links.push(...fs.readdirSync(dir).filter((f) => /^zcode/i.test(f) && f.endsWith(".lnk")).map((f) => path.join(dir, f)));
  };
  for (const dir of shortcutDirs()) {
    try {
      collect(dir);
      // One subdirectory level (desktop folders like "agent", start-menu groups).
      for (const sub of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!sub.isDirectory()) continue;
        try {
          collect(path.join(dir, sub.name));
        } catch {
          /* unreadable subdir */
        }
      }
    } catch {
      /* dir absent */
    }
  }
  if (links.length === 0) return result;

  // One PowerShell per shortcut: read args via WScript.Shell COM, append the
  // flag when missing, save. Output "updated|<path>" / "ok|<path>" / "err|<path>|<msg>".
  for (const lnk of links) {
    const script = `
$ErrorActionPreference = 'Stop'
try {
  $ws = New-Object -ComObject WScript.Shell
  $s = $ws.CreateShortcut('${lnk.replace(/'/g, "''")}')
  if ($s.TargetPath -notmatch 'ZCode\.exe$') { Write-Output 'ok|not-zcode'; exit }
  if ($s.Arguments -like '*--remote-debugging-port*') { Write-Output 'ok|has-flag'; exit }
  $s.Arguments = ($s.Arguments.Trim() + ' ${flag}').Trim()
  $s.Save()
  Write-Output 'updated'
} catch { Write-Output ('err|' + $_.Exception.Message) }`;
    try {
      const { stdout } = await exec("powershell", ["-NoProfile", "-Command", script], { timeout: 15_000, windowsHide: true });
      const out = stdout.trim();
      if (out.startsWith("updated")) result.updated.push(lnk);
      else if (out.startsWith("err")) result.failed.push({ path: lnk, reason: out.slice(4) });
      else result.skipped.push(lnk);
    } catch (err) {
      result.failed.push({ path: lnk, reason: (err as Error).message });
    }
  }
  return result;
}
