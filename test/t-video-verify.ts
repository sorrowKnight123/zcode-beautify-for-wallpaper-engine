/** T-V verification: direct video wallpaper import with the user's sample. */
import { importScene } from "../src/core/scenePipeline.js";
import { makeSeamless, loopSeamSsim, probeDuration } from "../src/core/loopProcessor.js";
import { checkFfmpeg } from "../src/core/dependencyCheck.js";
import { computeHash, getCachePath, hasCache, scenesCacheRoot } from "../src/core/cacheManager.js";
import { existsSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const ff = await checkFfmpeg();
if (!ff.ok) { console.log("T-V SKIP (ffmpeg not installed)"); process.exit(0); }

const VIDEO = process.env.TEST_VIDEO ?? "D:\\SteamLibrary\\steamapps\\workshop\\content\\431960\\3322549058\\2024-08-03 03-10-57.mp4";
if (!existsSync(VIDEO)) { console.log(`T-V SKIP (sample video missing: ${VIDEO})`); process.exit(0); }

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}

const srcDur = await probeDuration(VIDEO, ff.path!);
console.log(`source: ${srcDur.toFixed(1)}s`);
check("source longer than 60s (truncation branch exercised)", srcDur > 60, `${srcDur.toFixed(1)}s`);

const OPTS = { fadeSec: 1, maxSeconds: 60 };
// clear prior cache of this input so "first import" really processes
const priorHash = computeHash(VIDEO, { kind: "video", maxWidth: 1920, maxSeconds: OPTS.maxSeconds, fadeSec: OPTS.fadeSec });
rmSync(path.dirname(getCachePath(priorHash)), { recursive: true, force: true });

const t0 = Date.now();
const r = await importScene(VIDEO, (s, d) => console.log(`  stage: ${s}${d ? ` (${d})` : ""}`), OPTS, ff.path!);
const firstMs = Date.now() - t0;
console.log("import:", { hash: r.hash.slice(0, 8), loop: r.loopPath, size: statSync(r.loopPath).size });

check("loop exists and >= 10KB", existsSync(r.loopPath) && statSync(r.loopPath).size >= 10_000, `${statSync(r.loopPath).size}B`);
check("poster exists", existsSync(r.posterPath));
check("not from cache first time", r.fromCache === false);
check("duration = min(src,60) - fade", Math.abs(r.blackness.durationSec - (Math.min(srcDur, 60) - 1)) <= 0.3, `${r.blackness.durationSec}s`);
check("first import < 5min", firstMs < 300_000, `${firstMs}ms`);
check("footage non-black", r.blackness.blackFraction < 0.2, `meanLuma=${r.blackness.meanLuma.toFixed(1)}`);

const ssim = await loopSeamSsim(r.loopPath, ff.path!);
check("seam SSIM >= 0.9", ssim >= 0.9, `${ssim}`);

const t1 = Date.now();
const r2 = await importScene(VIDEO, () => undefined, OPTS, ff.path!);
const cachedMs = Date.now() - t1;
check("cache hit < 3s", cachedMs < 3_000 && r2.fromCache, `${cachedMs}ms`);

// width normalization: loop width must be <= 1920
const { execFile } = await import("node:child_process");
const { promisify } = await import("node:util");
const probe = await promisify(execFile)(ff.path!.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1"),
  ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", r.loopPath], { timeout: 30_000 });
const [w] = probe.stdout.trim().split(",").map(Number);
check("width <= 1920", w <= 1920, `${w}px`);

if (failed > 0) { console.error(`T-V FAIL (${failed})`); process.exit(1); }
console.log("T-V PASS");
