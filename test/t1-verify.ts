/** T1 verification: type detection against fixtures, edge cases and real WE workshop content. */
import { detectWallpaperType } from "../src/core/wallpaperType.js";
import fs from "node:fs";
import path from "node:path";

const cases: Array<[string, string]> = [
  // spec cases
  ["./test/fixtures/sample.jpg", "image"],
  ["./test/fixtures/scene_dir", "scene"],
  ["./test/fixtures/scene.pkg", "scene"],
  ["./test/fixtures/video.mp4", "video"],
  // edges
  ["./test/fixtures/SAMPLE_UPPER.JPG", "image"],
  ["./test/fixtures/no-such-file.png", "image"], // extension wins without fs access
  ["./test/fixtures/no-such-dir", "unknown"],
  ["./test/fixtures", "scene"], // dir containing scene.pkg IS a scene per contents rule
  ["./test/fixtures/_t1_empty", "unknown"], // empty dir
];

// fixture variant that only exists for this run: dir with broken project.json but scene.pkg inside
const brokenDir = "./test/fixtures/_t1_broken_json";
fs.mkdirSync(brokenDir, { recursive: true });
fs.writeFileSync(path.join(brokenDir, "project.json"), "{ not json");
fs.writeFileSync(path.join(brokenDir, "scene.pkg"), "");
cases.push([brokenDir, "scene"]);

const emptyDir = "./test/fixtures/_t1_empty";
fs.mkdirSync(emptyDir, { recursive: true });

let failed = 0;
for (const [p, expected] of cases) {
  const got = detectWallpaperType(p);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${p} -> ${got}${ok ? "" : ` (expected ${expected})`}`);
}

// real Wallpaper Engine workshop content (live install on this machine)
const workshop = "D:/SteamLibrary/steamapps/workshop/content/431960";
const real: Array<[string, string]> = [
  ["2902406982", "scene"], // project.json type: scene
  ["3413921910", "scene"], // scene.pkg on disk
  ["3498185307", "scene"], // scene.pkg on disk (.pkg import candidate)
  ["3759460346", "video"], // project.json type: video
  ["3760876479", "video"], // mp4 on disk
  ["3791110375", "video"], // mp4 on disk
  ["3042533546", "video"], // no type/file fields, mp4 inside files/ subfolder
  ["3713369686", "unknown"], // no project.json at all
];
if (fs.existsSync(workshop)) {
  for (const [id, expected] of real) {
    const got = detectWallpaperType(path.join(workshop, id));
    const ok = got === expected;
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} [real] ${id} -> ${got}${ok ? "" : ` (expected ${expected})`}`);
  }
} else {
  console.log("info: WE workshop dir not present, real-world cases skipped");
}

fs.rmSync(brokenDir, { recursive: true, force: true });
fs.rmSync(emptyDir, { recursive: true, force: true });
if (failed > 0) {
  console.error(`T1 FAIL (${failed} mismatches)`);
  process.exit(1);
}
console.log("T1 PASS");
