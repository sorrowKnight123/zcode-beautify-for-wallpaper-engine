/**
 * Content-addressed cache for rendered scene wallpaper loops.
 *
 * Layout: <dataDir>/scenes/<hash>/loop.mp4, where <hash> is an MD5 over the
 * source content (file bytes for .pkg inputs, a manifest of relative paths +
 * sizes for extracted workshop directories) plus the normalized render
 * options — so the same wallpaper re-imported at a different path or after a
 * re-download still hits, while changed content or settings miss.
 *
 * The scenes/ root is capped (default 10 GB) with LRU eviction on
 * last-access time (atime if tracked, mtime otherwise).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./launch.js";

export function scenesCacheRoot(): string {
  return path.join(dataDir(), "scenes");
}

export function getCachePath(hash: string): string {
  return path.join(scenesCacheRoot(), hash, "loop.mp4");
}

export function hasCache(hash: string): boolean {
  try {
    return fs.statSync(getCachePath(hash)).isFile() && fs.statSync(getCachePath(hash)).size > 0;
  } catch {
    return false;
  }
}

/**
 * MD5 of the wallpaper's content plus JSON-normalized opts. Directory inputs
 * are fingerprinted via a stable manifest (relative path + size of every
 * file), which stays cheap even for multi-hundred-MB published scenes.
 */
export function computeHash(pkgPath: string, opts: Record<string, unknown>): string {
  const md5 = crypto.createHash("md5");
  md5.update(fingerprint(pkgPath));
  md5.update(JSON.stringify(normalizeOpts(opts)));
  return md5.digest("hex");
}

/** Marks a cache entry as most recently used (called on hit). */
export function touchCache(hash: string): void {
  const file = getCachePath(hash);
  const now = new Date();
  try {
    fs.utimesSync(file, now, now);
  } catch {
    /* entry vanished — nothing to touch */
  }
}

/**
 * Enforces the total size cap across scenes/ by deleting the least recently
 * used entries first. Safe against concurrent mutation: re-stats each entry
 * as it goes and ignores vanished ones.
 */
export function enforceLimit(maxBytes: number): number {
  const root = scenesCacheRoot();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return 0;
  }

  const sized = entries
    .filter((e) => e.isDirectory())
    .map((e) => {
      const dir = path.join(root, e.name);
      try {
        return { dir, size: dirSize(dir), lru: lastUseMs(dir) };
      } catch {
        return { dir, size: 0, lru: 0 };
      }
    });

  let total = sized.reduce((sum, e) => sum + e.size, 0);
  if (total <= maxBytes) return total;

  sized.sort((a, b) => a.lru - b.lru); // oldest first
  for (const entry of sized) {
    if (total <= maxBytes) break;
    try {
      fs.rmSync(entry.dir, { recursive: true, force: true });
    } catch {
      continue; // locked or already gone — keep evicting others
    }
    total -= entry.size;
  }
  return total;
}

// --- helpers ----------------------------------------------------------------

function normalizeOpts(opts: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(opts).sort()) {
    sorted[key] = opts[key];
  }
  return sorted;
}

function fingerprint(p: string): string {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(p);
  } catch {
    return `missing:${p}`;
  }
  if (stat.isFile()) {
    // Hash file bytes in chunks; pkg files are typically < 200 MB.
    const buf = crypto.createHash("md5");
    buf.update(fs.readFileSync(p));
    return `file:${stat.size}:${buf.digest("hex")}`;
  }
  if (stat.isDirectory()) {
    const manifest: string[] = [];
    const walk = (abs: string, rel: string): void => {
      let items: fs.Dirent[];
      try {
        items = fs.readdirSync(abs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const item of items) {
        const childAbs = path.join(abs, item.name);
        const childRel = rel ? `${rel}/${item.name}` : item.name;
        if (item.isDirectory()) {
          walk(childAbs, childRel);
        } else if (item.isFile()) {
          let size = 0;
          try {
            size = fs.statSync(childAbs).size;
          } catch {
            /* unreadable file — size 0 keeps the manifest stable */
          }
          // Content-hash small files (json/pkg/shaders) so same-size edits
          // still miss; big binaries (mp4) practically always change size.
          if (size <= 16 * 1024 * 1024) {
            let content = "";
            try {
              content = crypto.createHash("md5").update(fs.readFileSync(childAbs)).digest("hex");
            } catch {
              content = "unreadable";
            }
            manifest.push(`${childRel}:${size}:${content}`);
          } else {
            manifest.push(`${childRel}:${size}`);
          }
        }
      }
    };
    walk(p, "");
    manifest.sort();
    const buf = crypto.createHash("md5");
    buf.update(manifest.join("\n"));
    return `dir:${manifest.length}:${buf.digest("hex")}`;
  }
  return `other:${p}`;
}

function dirSize(dir: string): number {
  let total = 0;
  walkSize(dir);
  return total;

  function walkSize(dir: string): void {
    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      const child = path.join(dir, item.name);
      if (item.isDirectory()) walkSize(child);
      else if (item.isFile()) {
        try {
          total += fs.statSync(child).size;
        } catch {
          /* vanished mid-walk */
        }
      }
    }
  }
}

/**
 * LRU bookkeeping uses mtime only: NTFS last-access updates are disabled by
 * default on modern Windows, so atime is meaningless there. touchCache()
 * bumps the entry file's mtime on every cache hit; eviction sorts on the
 * newest mtime found inside each entry directory.
 */
function lastUseMs(dir: string): number {
  // Only files inside count: the entry directory's own mtime is its creation
  // time and would mask the backdated mtimes that LRU bookkeeping relies on.
  let newest = 0;
  const consider = (st: fs.Stats | undefined): void => {
    if (st?.isFile()) newest = Math.max(newest, st.mtimeMs);
  };
  let items: fs.Dirent[];
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const item of items) {
    try {
      const st = fs.statSync(path.join(dir, item.name));
      consider(st);
      if (item.isDirectory()) {
        // one level deep is enough — entries hold a handful of files
        for (const inner of fs.readdirSync(path.join(dir, item.name), { withFileTypes: true })) {
          try {
            consider(fs.statSync(path.join(dir, item.name, inner.name)));
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  return newest;
}
