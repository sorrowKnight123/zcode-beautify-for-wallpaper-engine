/** T6 verification: hashing, cache paths, and LRU eviction. */
import { computeHash, getCachePath, hasCache, enforceLimit, scenesCacheRoot, touchCache } from "../src/core/cacheManager.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

process.env.ZCODE_BEAUTIFY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "t6-cache-"));

let failed = 0;
function check(label: string, cond: boolean, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
}

// hash determinism & sensitivity
const h1 = computeHash("./test/fixtures/scene.pkg", { w: 1920, h: 1080, fps: 60 });
const h2 = computeHash("./test/fixtures/scene.pkg", { w: 1920, h: 1080, fps: 60 });
const h3 = computeHash("./test/fixtures/scene.pkg", { w: 1280, h: 720, fps: 60 });
check("same input+opts -> same hash", h1 === h2);
check("different opts -> different hash", h1 !== h3);

// same content at a different path hits the same hash (content addressing)
const copy = "./test/fixtures/_t6_copy.pkg";
fs.copyFileSync("./test/fixtures/scene.pkg", copy);
check("same content other path -> same hash", computeHash(copy, { w: 1920, h: 1080, fps: 60 }) === h1);
fs.rmSync(copy);

// changed content -> different hash
fs.writeFileSync(copy, "different bytes");
check("different content -> different hash", computeHash(copy, { w: 1920, h: 1080, fps: 60 }) !== h1);
fs.rmSync(copy);

// directory fingerprinting is stable and content-sensitive
const dirA = "./test/fixtures/_t6_dir";
fs.mkdirSync(dirA, { recursive: true });
fs.writeFileSync(path.join(dirA, "scene.pkg"), "AAA");
fs.writeFileSync(path.join(dirA, "project.json"), "{}");
const d1 = computeHash(dirA, {});
fs.writeFileSync(path.join(dirA, "scene.pkg"), "AAB");
check("dir content change -> different hash", computeHash(dirA, {}) !== d1);
fs.rmSync(dirA, { recursive: true, force: true });

// cache path layout per spec
const expected = path.join(process.env.ZCODE_BEAUTIFY_DATA_DIR!, "scenes", h1, "loop.mp4");
check("cache path layout", getCachePath(h1) === expected, getCachePath(h1));

// hasCache / touch
check("hasCache false when empty", !hasCache(h1));
fs.mkdirSync(path.dirname(getCachePath(h1)), { recursive: true });
fs.writeFileSync(getCachePath(h1), "x".repeat(64));
check("hasCache true when populated", hasCache(h1));
touchCache(h1);

// LRU eviction: 3 entries x 64B, cap = 160B -> oldest evicted first
const mk = (hash: string, mtime: number) => {
  const f = getCachePath(hash);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, "y".repeat(64));
  fs.utimesSync(f, new Date(mtime), new Date(mtime));
};
const old = computeHash("old", {}), mid = computeHash("mid", {}), neu = computeHash("new", {});
mk(old, Date.now() - 60_000);
mk(mid, Date.now() - 30_000);
mk(neu, Date.now());
const remaining = enforceLimit(160);
check("LRU evicts down to cap", remaining <= 160, `${remaining}B`);
check("newest survives", hasCache(neu));
check("middle evicted before newest", !hasCache(mid));
check("oldest evicted", !hasCache(old));

fs.rmSync(process.env.ZCODE_BEAUTIFY_DATA_DIR, { recursive: true, force: true });

if (failed > 0) { console.error(`T6 FAIL (${failed})`); process.exit(1); }
console.log("T6 PASS");
