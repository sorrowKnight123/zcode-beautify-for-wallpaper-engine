/**
 * Shared child-process helper: every external tool (powershell, ffmpeg,
 * wallpaper64.exe) is a console program, and without windowsHide each spawn
 * flashes a terminal window. One wrapper, used everywhere.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execRaw = promisify(execFile);

export const execFileP = ((cmd: any, args: any, opts: any = {}) =>
  execRaw(cmd, args, { windowsHide: true, ...opts })) as unknown as typeof execRaw;
