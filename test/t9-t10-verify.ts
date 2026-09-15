/** T9/T10 verification: serve API surface, media Range, MCP tool registry. */
import { sendMediaFile } from "../src/core/media.js";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}

// --- media Range serving ------------------------------------------------------
const mediaFile = path.resolve("./test/out/t5_loop.mp4");
if (fs.existsSync(mediaFile)) {
  const server = http.createServer((req, res) => {
    if (req.url === "/loop.mp4") {
      if (!sendMediaFile(req, res, mediaFile)) { res.writeHead(404); res.end(); }
    } else if (req.url === "/nope.mp4") {
      if (!sendMediaFile(req, res, mediaFile + ".missing")) { res.writeHead(404); res.end(); }
    } else {
      res.writeHead(404); res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  const full = await fetch(`${base}/loop.mp4`);
  check("media 200 with total length", full.status === 200 && Number(full.headers.get("content-length")) === fs.statSync(mediaFile).size);

  const part = await fetch(`${base}/loop.mp4`, { headers: { Range: "bytes=100-199" } });
  const buf = Buffer.from(await part.arrayBuffer());
  check("media 206 range", part.status === 206 && buf.length === 100);
  const orig = fs.readFileSync(mediaFile);
  check("range bytes correct", buf.equals(orig.subarray(100, 200)));
  check("content-range header", part.headers.get("content-range") === `bytes 100-199/${orig.length}`);

  const tail = await fetch(`${base}/loop.mp4`, { headers: { Range: "bytes=-50" } });
  check("suffix range clamps to end", tail.status === 206 && Number(tail.headers.get("content-length")) === 50);

  const bad = await fetch(`${base}/loop.mp4`, { headers: { Range: "bytes=999999999-" } });
  check("out-of-range -> 416", bad.status === 416);

  const missing = await fetch(`${base}/nope.mp4`);
  check("missing file -> 404 path", missing.status === 404);

  server.close();
} else {
  console.log("info: t5_loop.mp4 absent, media Range tests skipped");
}

// --- MCP tool registry ----------------------------------------------------------
const { TOOL_NAMES } = await import("../src/mcp/server.js").then((m) => ({ TOOL_NAMES: m.TOOL_NAMES })).catch(() => {
  // Importing the MCP server module would connect stdio transport; verify the
  // registry via source instead.
  const src = fs.readFileSync(path.resolve("./src/mcp/server.ts"), "utf8");
  const names = [...src.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
  return { TOOL_NAMES: names };
});
for (const n of ["import_scene_wallpaper", "set_background", "apply_options", "beautify_status"]) {
  check(`mcp tool ${n} registered`, TOOL_NAMES.includes(n), JSON.stringify(TOOL_NAMES));
}

// --- serve surface (static checks against source) --------------------------------
const serverSrc = fs.readFileSync(path.resolve("./src/core/server.ts"), "utf8");
for (const endpoint of ["/api/import-scene", "/api/import-status", "/api/library", "/api/apply-wallpaper", "/media/scene/"]) {
  check(`serve endpoint ${endpoint}`, serverSrc.includes(endpoint));
}
check("serve persists mediaType video on import done", serverSrc.includes('mediaType: "video"'));

const panelSrc = fs.readFileSync(path.resolve("./src/panel/panelScript.ts"), "utf8");
for (const ui of ["zb-import", "zb-progress", "zb-guide", "zb-guide-retry", "zb-lib", "zb-scene-path"]) {
  check(`panel element ${ui}`, panelSrc.includes(ui));
}
check("panel polls import status", panelSrc.includes("/api/import-status"));
check("panel groups library image/scene", panelSrc.includes("壁纸库 — 动态") && panelSrc.includes("壁纸库 — 图片"));

const cliSrc = fs.readFileSync(path.resolve("./src/cli.ts"), "utf8");
check("cli apply-scene command", cliSrc.includes('"apply-scene"') && cliSrc.includes("applySceneWallpaper"));

if (failed > 0) { console.error(`T9/T10 FAIL (${failed})`); process.exit(1); }
console.log("T9/T10 PASS");
