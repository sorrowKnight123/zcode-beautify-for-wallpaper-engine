/**
 * Config persistence + ZCode launcher.
 *
 * Production ZCode builds have no built-in CDP port, so the launcher starts
 * ZCode.exe with --remote-debugging-port. ZCode enforces a single instance via
 * requestSingleInstanceLock, so we detect an already-running instance first.
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listTargets } from "./cdp.js";

export interface StoredConfig extends Partial<Omit<import("./inject.js").BeautifyConfig, "port">> {
  port?: number;
}

export function dataDir(): string {
  return (
    process.env.ZCODE_BEAUTIFY_DATA_DIR ??
    path.join(os.homedir(), ".zcode", "cli", "plugins", "data", "zcode-beautify")
  );
}

export function configFile(): string {
  return path.join(dataDir(), "config.json");
}

export function loadConfig(): StoredConfig {
  try {
    return JSON.parse(fs.readFileSync(configFile(), "utf8")) as StoredConfig;
  } catch (err) {
    // A PARSE error (not "file missing") means the stored config is corrupt:
    // quarantine it so the next save does not silently cement the wipe, and
    // the user's settings stay recoverable.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      try {
        fs.copyFileSync(configFile(), configFile() + `.corrupt-${Date.now().toString(36)}`);
      } catch {
        /* best effort */
      }
    }
    return {};
  }
}

/**
 * Cross-process serialized write. The serve daemon and MCP tool calls run in
 * different processes, both doing load→mutate→save on the same file; a bare
 * write can interleave and silently drop the other's settings. A lock file
 * (O_EXCL + retry) serializes writers; saveConfig is sync-friendly, so the
 * lock is acquired with a bounded busy-wait.
 */
function withConfigLock<T>(fn: () => T): T {
  const lock = configFile() + ".lock";
  fs.mkdirSync(dataDir(), { recursive: true });
  const deadline = Date.now() + 1500;
  let fd: number | null = null;
  for (;;) {
    try {
      fd = fs.openSync(lock, "wx");
      break;
    } catch {
      // A crash between open and the finally leaves the lock behind forever.
      // Break locks older than 5s (writes never take that long) instead of
      // spinning to the deadline — a hot 3s spin would freeze the event loop.
      try {
        const age = Date.now() - fs.statSync(lock).mtimeMs;
        if (age > 5000) {
          fs.rmSync(lock, { force: true });
          continue;
        }
      } catch {
        /* lock vanished — retry immediately */
      }
      if (Date.now() > deadline) return fn(); // contended: proceed unlocked
      const waitMs = Date.now();
      while (Date.now() - waitMs < 20) {
        /* brief spin */
      }
    }
  }
  try {
    return fn();
  } finally {
    try { fs.closeSync(fd!); } catch { /* closed */ }
    try { fs.rmSync(lock, { force: true }); } catch { /* locked */ }
  }
}

export function saveConfig(config: StoredConfig): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  withConfigLock(() => {
    // Write-then-rename: a full disk (ENOSPC) or crash mid-write must never
    // leave a truncated config.json behind — a corrupt file silently resets
    // every setting, which is exactly how rotation plans were lost once.
    const file = configFile();
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
    fs.renameSync(tmp, file);
  });
}

const ZCODE_EXE_CANDIDATES =
  process.platform === "win32"
    ? [
        process.env.ZCODE_WINDOWS_APP_INSTALL_DIR
          ? path.join(process.env.ZCODE_WINDOWS_APP_INSTALL_DIR, "ZCode.exe")
          : undefined,
        "C:\\Program Files\\ZCode\\ZCode.exe",
        path.join(os.homedir(), "AppData", "Local", "Programs", "ZCode", "ZCode.exe"),
      ].filter(Boolean)
    : process.platform === "darwin"
      ? ["/Applications/ZCode.app/Contents/MacOS/ZCode"]
      : ["/usr/bin/zcode", "/opt/ZCode/zcode"];

export function findZcodeExecutable(): string | undefined {
  return ZCODE_EXE_CANDIDATES.map((p) => p!).find((p) => {
    try {
      return fs.statSync(p!).isFile();
    } catch {
      return false;
    }
  });
}

const execFileAsync = promisify(execFile);

/**
 * Detects a live ZCode process. A running instance without the debug port
 * triggers the Electron single-instance lock: a newly spawned ZCode binds the
 * CDP port, forwards its args to the existing instance, then exits — closing
 * the port again. Launching must refuse upfront instead of racing that window.
 */
export async function isZcodeProcessRunning(): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("tasklist", ["/NH", "/FI", "IMAGENAME eq ZCode.exe"]);
      return stdout.toLowerCase().includes("zcode.exe");
    }
    const name = process.platform === "darwin" ? "ZCode" : "zcode";
    const { stdout } = await execFileAsync("pgrep", ["-x", name]);
    return stdout.trim().length > 0;
  } catch {
    return false; // pgrep exits non-zero when no process matches
  }
}

export interface LaunchResult {
  started: boolean;
  reason?: string;
}

/**
 * Starts ZCode with the CDP port enabled. If a CDP endpoint is already
 * reachable we are done; if a ZCode instance is running *without* CDP, the
 * single-instance lock blocks us and the user must restart ZCode themselves.
 */
export async function launchZcode(port: number): Promise<LaunchResult> {
  try {
    await listTargets(port);
    return { started: false, reason: "already-running-with-cdp" };
  } catch {
    /* not reachable yet */
  }

  const exe = findZcodeExecutable();
  if (!exe) throw new Error("ZCode executable not found; set ZCODE_WINDOWS_APP_INSTALL_DIR or install ZCode to the default path.");

  if (await isZcodeProcessRunning()) {
    return { started: false, reason: "running-without-cdp" };
  }

  // Beyond the CDP port: ZCode's transparent window gets misjudged as fully
  // occluded by Chromium's occlusion tracker, which stops ALL renderer
  // rendering — transition effects never play a frame and timers throttle
  // past 1s (the same root cause behind the video-freeze watchdog). Disabling
  // the tracker and renderer backgrounding keeps effects and timers alive in
  // the background.
  const child = spawn(exe, [
    `--remote-debugging-port=${port}`,
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  // Wait for the CDP endpoint to come up.
  let up = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      await listTargets(port);
      up = true;
      break;
    } catch {
      /* keep waiting */
    }
  }
  if (!up) {
    // Never leave the orphan we spawned: without the port it is unusable to
    // us, and its single-instance lock blocks every later launch attempt.
    try {
      child.kill();
    } catch {
      /* already gone */
    }
    throw new Error(
      "ZCode was started but no CDP endpoint appeared. Another instance may already be running without the debug port — quit ZCode completely and run `zcode-beautify launch` again."
    );
  }

  // Confirm the endpoint stays up: a second instance racing the single-instance
  // lock binds the port briefly and then quits, which would look like success.
  await new Promise((r) => setTimeout(r, 2000));
  try {
    await listTargets(port);
  } catch {
    throw new Error(
      "CDP came up but closed again immediately — a running ZCode instance took over via the single-instance lock. Quit ZCode completely and run `zcode-beautify launch` again."
    );
  }
  return { started: true };
}
