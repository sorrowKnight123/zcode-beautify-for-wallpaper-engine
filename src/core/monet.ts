/**
 * Monet / Material Design 3 dynamic color extraction from a wallpaper image.
 * Pure Node: jimp decodes the image, @material/material-color-utilities does
 * quantization (Celebi), scoring and scheme generation.
 */

import { Jimp } from "jimp";
import {
  QuantizerCelebi,
  Score,
  argbFromRgb,
  themeFromSourceColor,
  type Theme,
} from "@material/material-color-utilities";

export interface WallpaperAssets {
  /** Processed wallpaper as a data URI (resized + JPEG-compressed). */
  dataUri: string;
  /** MD3 source color extracted from the image (ARGB int). */
  sourceArgb: number;
  /** Light and dark MD3 themes generated from the source color. */
  theme: Theme;
  /** Saliency-based framing suggestion for `fit: "smart"`. */
  focus: ImageFocus;
}

export interface ImageFocus {
  /** Salient-region center, normalized 0-1. */
  x: number;
  y: number;
  /** Whether the image suits full cover cropping or letterboxed contain. */
  fit: "cover" | "contain";
}

const MAX_WIDTH = 2560;
const JPEG_QUALITY = 82;

export async function loadWallpaper(imagePath: string, maxDimension = MAX_WIDTH): Promise<WallpaperAssets> {
  // Raise the decoder memory caps: modern wallpapers (phone shots, 4K PNGs)
  // blow past the defaults, and the failure mode was nasty — a 4s wait,
  // then a throw that silently dropped the wallpaper entirely. The typed
  // options only carry the cap for jpeg; pass it for every decoder (the
  // png/webp decoders honor the same field) and fall back if one rejects it.
  const decodeOpts = {
    "image/jpeg": { maxMemoryUsageInMB: 1024 },
    "image/png": { maxMemoryUsageInMB: 1024 },
    "image/webp": { maxMemoryUsageInMB: 1024 },
    "image/bmp": { maxMemoryUsageInMB: 1024 },
    "image/tiff": { maxMemoryUsageInMB: 1024 },
  };
  let image;
  try {
    image = await Jimp.read(imagePath, decodeOpts);
  } catch {
    image = await Jimp.read(imagePath);
  }

  // Downscale so the embedded data URI and the quantizer stay fast.
  const { width, height } = image.bitmap;
  if (Math.max(width, height) > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    image.resize({ w: Math.round(width * scale), h: Math.round(height * scale) });
  }

  const sourceArgb = extractSourceColor(image.bitmap);
  const theme = themeFromSourceColor(sourceArgb);
  const focus = analyzeFocus(image.bitmap);

  const jpeg = await image.getBuffer("image/jpeg", { quality: JPEG_QUALITY });
  const dataUri = `data:image/jpeg;base64,${jpeg.toString("base64")}`;

  return { dataUri, sourceArgb, theme, focus };
}

/**
 * Lightweight "smart fit" analysis, fully local: a saliency-weighted centroid
 * (pixels far from the global mean color get the most weight) becomes the
 * focus point, and extreme aspect ratios switch to a letterboxed contain mode
 * so the picture is never cropped beyond recognition.
 */
export function analyzeFocus(bitmap: { width: number; height: number; data: Uint8Array | Buffer }): ImageFocus {
  const { width, height, data } = bitmap;
  const aspect = width / height;
  const fit: ImageFocus["fit"] = aspect > 2.4 || aspect < 0.42 ? "contain" : "cover";

  // First pass: mean color of an opaque sample.
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 24000)));
  let rs = 0, gs = 0, bs = 0, n = 0;
  const samples: Array<[number, number, number, number, number]> = [];
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 255) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      samples.push([x, y, r, g, b]);
      rs += r; gs += g; bs += b; n++;
    }
  }
  if (n === 0) return { x: 0.5, y: 0.5, fit };
  const mr = rs / n, mg = gs / n, mb = bs / n;

  // Second pass: weight = squared color distance from the mean → centroid of
  // whatever stands out (subject, highlights, accents).
  let wx = 0, wy = 0, wsum = 0;
  for (const [x, y, r, g, b] of samples) {
    const dr = r - mr, dg = g - mg, db = b - mb;
    const w = dr * dr + dg * dg + db * db + 1;
    wx += x * w; wy += y * w; wsum += w;
  }
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x: clamp(wx / wsum / width), y: clamp(wy / wsum / height), fit };
}

/** Celebi quantization + MD3 scoring, on a decimated pixel sample. */
function extractSourceColor(bitmap: { width: number; height: number; data: Uint8Array | Buffer }): number {
  const { width, height, data } = bitmap;
  const pixels: number[] = [];
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 24000)));
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
      const alpha = data[i + 3];
      if (alpha < 255) continue;
      pixels.push(argbFromRgb(data[i], data[i + 1], data[i + 2]));
    }
  }
  if (pixels.length === 0) pixels.push(argbFromRgb(255, 255, 255));
  const quantized = QuantizerCelebi.quantize(pixels, 64);
  const ranked = Score.score(quantized);
  return ranked[0] ?? argbFromRgb(103, 80, 164);
}

/** Up to 8 dominant wallpaper colors as #rrggbb (theme pinning swatches):
 *  a coarse grid sample quantized by merging near-duplicates, most frequent
 *  first. Runs on the tiny ffmpeg thumb, so it stays fast. */
export async function extractPalette(imagePath: string): Promise<string[]> {
  const image = await Jimp.read(imagePath);
  const { width, height, data } = image.bitmap;
  const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();
  const step = Math.max(1, Math.floor(Math.min(width, height) / 24));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      // Skip near-black/near-white noise so swatches stay colorful.
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      if (luma < 24 || luma > 236) continue;
      const key =  Math.floor(r / 48) + ':' + Math.floor(g / 48) + ':' + Math.floor(b / 48);
      const cur = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
      cur.r += r; cur.g += g; cur.b += b; cur.n++;
      buckets.set(key, cur);
    }
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 8)
    .map((c) => {
      const h = (v: number) => Math.round(v / c.n).toString(16).padStart(2, '0');
      return '#' + h(c.r) + h(c.g) + h(c.b);
    });
}

export function argbToCss(argb: number, alpha = 1): string {
  const r = (argb & 0xff0000) >> 16;
  const g = (argb & 0x00ff00) >> 8;
  const b = argb & 0x0000ff;
  return alpha >= 1
    ? `#${toHex(r)}${toHex(g)}${toHex(b)}`
    : `rgba(${r}, ${g}, ${b}, ${round2(alpha)})`;
}

function toHex(v: number): string {
  return v.toString(16).padStart(2, "0");
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
