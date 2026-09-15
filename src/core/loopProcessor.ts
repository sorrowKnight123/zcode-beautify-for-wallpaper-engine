/**
 * Seamless-loop processing for scene wallpaper captures.
 *
 * Construction (mathematically seam-free, verified by SSIM first-vs-last
 * frame check in test/t5-verify.ts):
 *
 *   output = crossfade( tail=input[D-f..D] (head image fades IN over it)
 *                     , main=input[f..D-f] )
 *   total duration = D - f
 *
 * Seams: output(0) is exactly input(D-f) (crossfade alpha 0), which equals
 * output(D-f) (main's last frame) -> the wrap is the same frame. At t=f the
 * crossfade ends on input(f), where main picks up. Every frame of the source
 * appears exactly once.
 *
 * Note: the originally specced chain ([b]trim=1 as base, fading head overlay
 * setpts-shifted to [D-1..D]) drops the overlay frames entirely — overlay
 * output ends with its main input, so frames past the main's end are never
 * composited. See docs/spike-notes.md.
 *
 * Audio is stripped (WE scenes may carry audio; a wallpaper must be silent)
 * and +faststart is applied for immediate playback when served over HTTP.
 */

import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { checkFfmpeg } from "./dependencyCheck.js";

const execRaw = promisify(execFile);
/** windowsHide: console helpers (powershell/ffmpeg) must never flash a terminal window. */
const exec = ((cmd: any, args: any, opts: any) => execRaw(cmd, args, { windowsHide: true, ...opts })) as unknown as typeof execRaw;

export class LoopError extends Error {}

export interface SeamlessOptions {
  /** Cut the source from startAt for `seconds` before looping (long inputs). */
  startAt?: number;
  seconds?: number;
  /** Downscale so width <= maxWidth (keeps aspect, even heights). Default no scaling. */
  maxWidth?: number;
}

export async function makeSeamless(
  input: string,
  output: string,
  fadeSec: number,
  ffmpegPath?: string,
  options: SeamlessOptions = {},
): Promise<{ inputDuration: number; outputDuration: number }> {
  const ffmpeg = ffmpegPath ?? (await checkFfmpeg()).path;
  if (!ffmpeg) throw new LoopError("ffmpeg not found — cannot process loop");

  const fullDuration = await probeDuration(input, ffmpeg);
  if (!Number.isFinite(fullDuration) || fullDuration <= fadeSec + 1) {
    throw new LoopError(`Input too short for a ${fadeSec}s crossfade (duration ${fullDuration}s)`);
  }
  // Long inputs are truncated to a middle segment before the crossfade; the
  // whole file would balloon the cache for minutes-long sources.
  const duration = Math.min(fullDuration, options.seconds ?? fullDuration);
  const startAt = Math.min(options.startAt ?? 0, fullDuration - duration);
  if (duration <= fadeSec + 1) {
    throw new LoopError(`Truncated input too short for a ${fadeSec}s crossfade (duration ${duration}s)`);
  }

  const tailStart = duration - fadeSec;
  const mainEnd = duration - fadeSec;
  const scale =
    options.maxWidth && options.maxWidth > 0
      ? `scale=w='min(${options.maxWidth}\\,iw)':h=-2,`
      : "";
  const filter = [
    `[0:v]split[base][src]`,
    // crossfade base: the source tail, head image fades in over it
    `[src]trim=start=${tailStart.toFixed(4)},setpts=PTS-STARTPTS[tail]`,
    `[base]trim=end=${fadeSec.toFixed(4)},setpts=PTS-STARTPTS,format=yuva420p,fade=t=in:d=${fadeSec.toFixed(4)}:alpha=1[head]`,
    `[tail][head]overlay=format=auto[xfade]`,
    // main body: the source between the crossfade end and the tail start
    `[base]trim=start=${fadeSec.toFixed(4)}:end=${mainEnd.toFixed(4)},setpts=PTS-STARTPTS[main]`,
    `[xfade][main]concat=n=2:v=1:a=0[joined]`,
    `[joined]${scale}format=yuv420p[out]`,
  ].join(";");

  mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  await exec(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "warning",
    // -ss/-t BEFORE -i: they must limit what the FILTERS see (an output-side
    // -t would cap the result while the trims ran on the whole stream).
    ...(options.startAt ? ["-ss", startAt.toFixed(3)] : []),
    ...(options.seconds ? ["-t", duration.toFixed(3)] : []),
    "-i", input,
    "-filter_complex", filter,
    "-map", "[out]",
    "-c:v", "libx264",
    "-crf", "18",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-an",
    output,
  ], { timeout: 600_000, maxBuffer: 16 * 1024 * 1024 });

  const outputDuration = await probeDuration(output, ffmpeg);
  return { inputDuration: duration, outputDuration };
}

/** First-frame vs last-frame SSIM: ~1.0 proves the loop wraps on the same frame. */
export async function loopSeamSsim(file: string, ffmpegPath?: string): Promise<number> {
  const ffmpeg = ffmpegPath ?? (await checkFfmpeg()).path;
  if (!ffmpeg) throw new LoopError("ffmpeg not found");

  const tmpLast = `${file}.last.png`;
  const tmpFirst = `${file}.first.png`;
  try {
    await exec(ffmpeg, ["-y", "-loglevel", "error", "-i", file, "-frames:v", "1", "-update", "1", tmpFirst], { timeout: 30_000 });
    // -sseof grabs the very last frame regardless of container duration rounding.
    await exec(ffmpeg, ["-y", "-loglevel", "error", "-sseof", "-0.05", "-i", file, "-frames:v", "1", "-update", "1", tmpLast], { timeout: 30_000 });
    const { stderr } = await exec(ffmpeg, [
      "-hide_banner", "-loglevel", "info",
      "-i", tmpFirst, "-i", tmpLast,
      "-filter_complex", "ssim", "-f", "null", "-",
    ], { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
    const m = /All:(\d+\.?\d*)/.exec(stderr);
    return m ? Number(m[1]) : -1;
  } finally {
    for (const f of [tmpLast, tmpFirst]) {
      try { await exec("cmd", ["/c", "del", "/q", path.resolve(f)], { timeout: 5000 }); } catch { /* temp file */ }
    }
  }
}

/** Container duration in seconds (ffprobe with an ffmpeg -i fallback). */
export async function probeDuration(file: string, ffmpegPath: string): Promise<number> {
  // ffprobe ships next to ffmpeg in standard distributions; fall back to ffmpeg -i.
  const ffprobe = ffmpegPath.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");
  try {
    const { stdout } = await exec(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { timeout: 30_000 });
    return Number(stdout.trim());
  } catch {
    const { stderr } = await exec(ffmpegPath, ["-hide_banner", "-i", file, "-f", "null", "-"], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(stderr);
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number.NaN;
  }
}
