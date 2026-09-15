/** T2 verification: dependency detection + install guide, live on this machine. */
import { checkWallpaperEngine, checkFfmpeg, getInstallGuide, parseVdfPaths } from "../src/core/dependencyCheck.js";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}

// vdf parser unit checks
const sample = `"LibraryFolders"
{
  "0" { "path" "C:\\Program Files (x86)\\Steam" }
  "1" { "path" "D:\\SteamLibrary" }
}`;
const parsed = parseVdfPaths(sample);
check("parseVdfPaths", parsed.length === 2 && parsed[1] === "D:\\SteamLibrary", JSON.stringify(parsed));
check("parseVdfPaths empty", parseVdfPaths("no paths here").length === 0);

const we = await checkWallpaperEngine();
console.log("WE  :", we);
check("checkWallpaperEngine ok", we.ok, we.detail);
check("WE path points to wallpaper64.exe", we.path?.toLowerCase().endsWith("wallpaper64.exe") === true, we.path);

const ff = await checkFfmpeg();
console.log("ffmpeg:", ff);
if (!ff.ok) {
  console.log("info: no ffmpeg on PATH — probing version logic via ZCODE_BEAUTIFY_FFMPEG override");
  process.env.ZCODE_BEAUTIFY_FFMPEG =
    "D:\\2_Project\\3_trial\\4_zcode_beautiful\\spike\\tools\\ffmpeg-9.0.1-essentials_build\\bin\\ffmpeg.exe";
  const ff2 = await checkFfmpeg();
  console.log("ffmpeg (override):", ff2);
  check("checkFfmpeg via override ok", ff2.ok, ff2.detail);
  check("ffmpeg version >= 5 detected", /ffmpeg (9|8|7|6|5)/.test(ff2.detail ?? "") === true, ff2.detail);
  const guide = getInstallGuide(["ffmpeg"]);
  check("guide mentions winget", guide.includes("winget"));
} else {
  check("ffmpeg version reported", /ffmpeg \d/.test(ff.detail ?? ""), ff.detail);
}

const guide = getInstallGuide(["we", "ffmpeg"]);
check("guide covers both deps", guide.includes("Wallpaper Engine") && guide.includes("ffmpeg"));
check("guide non-empty for no deps", getInstallGuide([]) === "");

if (failed > 0) {
  console.error(`T2 FAIL (${failed})`);
  process.exit(1);
}
console.log("T2 PASS");
