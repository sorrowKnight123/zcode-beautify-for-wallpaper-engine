/** T8 verification: end-to-end import pipeline, real WE + ffmpeg, cache hit timing. */
import { importScene, MissingDependencyError } from "../src/core/scenePipeline.js";
import { computeHash, getCachePath, scenesCacheRoot } from "../src/core/cacheManager.js";
import { existsSync, rmSync, statSync } from "node:fs";
import path from "node:path";

if (process.platform !== "win32") { console.log("T8 SKIP (not Windows)"); process.exit(0); }

const pkg = process.env.TEST_PKG ?? "D:\\SteamLibrary\\steamapps\\workshop\\content\\431960\\3498185307\\scene.pkg";
if (!existsSync(pkg)) { console.log(`T8 SKIP (no scene pkg at ${pkg})`); process.exit(0); }

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}

// Short capture to keep the verify quick; production default is 15s.
const OPTS = { duration: 6, fadeSec: 1, fps: 30 };

// A previous run may have left this wallpaper cached; clear it so "first
// import" really renders.
const priorHash = computeHash(pkg, { width: 1920, height: 1080, fps: OPTS.fps, duration: OPTS.duration, fadeSec: OPTS.fadeSec });
rmSync(path.dirname(getCachePath(priorHash)), { recursive: true, force: true });

try {
  const t0 = Date.now();
  const r1 = await importScene(pkg, (s, d) => console.log(`  stage: ${s}${d ? ` (${d})` : ""}`), OPTS);
  const firstMs = Date.now() - t0;
  console.log("first import:", { loop: r1.loopPath, poster: r1.posterPath, hash: r1.hash.slice(0, 8), blackness: r1.blackness });

  check("loop file exists and >= 10KB", existsSync(r1.loopPath) && statSync(r1.loopPath).size >= 10_000, `${statSync(r1.loopPath).size}B`);
  check("poster file exists", existsSync(r1.posterPath));
  check("not from cache first time", r1.fromCache === false);
  check("blackness sane (fraction < 0.2)", r1.blackness.blackFraction < 0.2, `meanLuma=${r1.blackness.meanLuma.toFixed(1)}`);
  check("first import < 90s", firstMs < 90_000, `${firstMs}ms`);

  const t1 = Date.now();
  const r2 = await importScene(pkg, () => undefined, OPTS);
  const cachedMs = Date.now() - t1;
  console.log(`cached import: ${cachedMs}ms`);
  check("same loop path on second import", r1.loopPath === r2.loopPath);
  check("second import served from cache", r2.fromCache === true);
  check("cache hit < 3s", cachedMs < 3_000, `${cachedMs}ms`);
} catch (err) {
  if (err instanceof MissingDependencyError) {
    console.log(`T8 SKIP (deps missing: ${err.missing.join(", ")})`);
    process.exit(0);
  }
  throw err;
}

if (failed > 0) { console.error(`T8 FAIL (${failed})`); process.exit(1); }
console.log("T8 PASS");
