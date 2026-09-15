/** T5 verification: seamless loop + seam SSIM + duration check. */
import { makeSeamless, loopSeamSsim } from "../src/core/loopProcessor.js";
import { checkFfmpeg } from "../src/core/dependencyCheck.js";
import { existsSync, statSync } from "node:fs";

const ff = await checkFfmpeg();
if (!ff.ok) { console.log("T5 SKIP (ffmpeg not installed)"); process.exit(0); }

const INPUT = "./test/out/t4_record.mp4";
if (!existsSync(INPUT)) { console.log("T5 SKIP (no input footage from T4)"); process.exit(0); }

const FADE = 1;
const OUT = "./test/out/t5_loop.mp4";
let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}

const { inputDuration, outputDuration } = await makeSeamless(INPUT, OUT, FADE, ff.path);
console.log(`durations: input=${inputDuration.toFixed(3)}s output=${outputDuration.toFixed(3)}s`);
check("output exists and >= 10KB", existsSync(OUT) && statSync(OUT).size >= 10_000, `${statSync(OUT).size} bytes`);
check("duration = input - fade", Math.abs(outputDuration - (inputDuration - FADE)) <= 0.2);

const ssim = await loopSeamSsim(OUT, ff.path);
console.log(`seam SSIM (first vs last frame): ${ssim}`);
check("seam SSIM >= 0.9 (loop wraps on same frame)", ssim >= 0.9);

if (failed > 0) { console.error(`T5 FAIL (${failed})`); process.exit(1); }
console.log("T5 PASS");
