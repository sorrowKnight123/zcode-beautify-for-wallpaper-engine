/** T3 verification: open a real WE scene window, position it, close it. */
import { openSceneWindow, closeSceneWindow } from "../src/core/weLauncher.js";
import { checkWallpaperEngine } from "../src/core/dependencyCheck.js";
import { existsSync } from "node:fs";

if (process.platform !== "win32") {
  console.log("T3 SKIP (not Windows)");
  process.exit(0);
}
const we = await checkWallpaperEngine();
if (!we.ok || !we.path) {
  console.log("T3 SKIP (WE not installed)");
  process.exit(0);
}

// Prefer a real workshop scene.pkg, fall back to the fixture.
const pkg =
  process.env.TEST_PKG ??
  "D:\\SteamLibrary\\steamapps\\workshop\\content\\431960\\3498185307\\scene.pkg";
if (!existsSync(pkg)) {
  console.log(`T3 SKIP (no scene pkg available at ${pkg})`);
  process.exit(0);
}

const t0 = Date.now();
const handle = await openSceneWindow(pkg, { width: 1280, height: 720, title: "WE_Render" });
console.log("opened:", { hwnd: handle.hwnd, client: handle.client, procPid: handle.proc?.pid ?? "(exited)" });
const openMs = Date.now() - t0;
check("client rect positive", handle.client.width > 0 && handle.client.height > 0);
check("open completed in < 15s", openMs < 15_000, `${openMs}ms`);

await new Promise((r) => setTimeout(r, 3000)); // let the scene render for a moment

const t1 = Date.now();
await closeSceneWindow(handle);
const closeMs = Date.now() - t1;
check("close completed in < 10s", closeMs < 10_000, `${closeMs}ms`);

function check(label: string, cond: boolean, extra = "") {
  if (!cond) process.exitCode = 1;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}
console.log(process.exitCode === 1 ? "T3 FAIL" : "T3 PASS");
