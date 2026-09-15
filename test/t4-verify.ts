/** T4 verification: record the real WE scene window and self-check the footage. */
import { openSceneWindow, closeSceneWindow } from "../src/core/weLauncher.js";
import { recordSceneWindow, analyzeBlackness } from "../src/core/recorder.js";
import { checkWallpaperEngine, checkFfmpeg } from "../src/core/dependencyCheck.js";
import { existsSync, statSync } from "node:fs";

if (process.platform !== "win32") { console.log("T4 SKIP (not Windows)"); process.exit(0); }
const ff = await checkFfmpeg();
const we = await checkWallpaperEngine();
if (!ff.ok) { console.log("T4 SKIP (ffmpeg not installed)"); process.exit(0); }
if (!we.ok) { console.log("T4 SKIP (WE not installed)"); process.exit(0); }

const pkg = process.env.TEST_PKG ?? "D:\\SteamLibrary\\steamapps\\workshop\\content\\431960\\3498185307\\scene.pkg";
if (!existsSync(pkg)) { console.log(`T4 SKIP (no scene pkg at ${pkg})`); process.exit(0); }

const OUT = "./test/out/t4_record.mp4";
let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}

const handle = await openSceneWindow(pkg, { width: 1280, height: 720, title: "WE_Render" });
await new Promise((r) => setTimeout(r, 3000)); // scene warm-up
try {
  const t0 = Date.now();
  await recordSceneWindow(handle, OUT, { duration: 4, fps: 30 }, ff.path);
  const elapsed = Date.now() - t0;
  check("recording finished", true, `${elapsed}ms for 4s target`);
  const size = statSync(OUT).size;
  check("output exists and >= 10KB", existsSync(OUT) && size >= 10_000, `${size} bytes`);

  const report = await analyzeBlackness(OUT, ff.path);
  console.log("blackness:", report);
  check("footage non-black (blackFraction < 0.2)", report.blackFraction < 0.2);
  check("footage has content (meanLuma > 5)", report.meanLuma > 5);
  check("duration ~4s", Math.abs(report.durationSec - 4) <= 0.5, `${report.durationSec}s`);
} finally {
  await closeSceneWindow(handle);
}

if (failed > 0) { console.error(`T4 FAIL (${failed})`); process.exit(1); }
console.log("T4 PASS");
