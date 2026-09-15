/**
 * HTTP media serving for scene wallpaper loop videos.
 *
 * The renderer plays the loop from http://127.0.0.1 (see docs/spike-notes.md:
 * file:/// URLs are unreliable and data URIs would blow the localStorage
 * quota), with Range requests so seeking/loading behaves like a normal media
 * source.
 */

import fs from "node:fs";
import http from "node:http";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

/**
 * Serves `filePath` with Range support (206 partial content) and CORS
 * headers, matching the renderer's <video> expectations.
 * Returns false when the file does not exist.
 */
export function sendMediaFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  filePath: string,
): boolean {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return false;
  }

  const type = MIME[filePath.toLowerCase().split(".").pop() ?? ""] ?? "application/octet-stream";
  const headers: Record<string, string | number> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  };

  // Handles "bytes=A-B", "bytes=A-" and suffix "bytes=-N".
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
  if (range && (range[1] !== "" || range[2] !== "")) {
    let start: number;
    let end: number;
    if (range[1] === "") {
      start = Math.max(0, stat.size - Number(range[2]));
      end = stat.size - 1;
    } else if (range[2] === "") {
      start = Number(range[1]);
      end = stat.size - 1;
    } else {
      start = Number(range[1]);
      end = Math.min(Number(range[2]), stat.size - 1);
    }
    if (start >= stat.size || start > end) {
      res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
      res.end();
      return true;
    }
    res.writeHead(206, {
      ...headers,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Content-Length": end - start + 1,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, "Content-Length": stat.size });
    fs.createReadStream(filePath).pipe(res);
  }
  return true;
}
