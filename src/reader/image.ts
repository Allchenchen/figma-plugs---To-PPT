import type { ImageMimeType, SrcRect } from '../ir/types';

/**
 * Pure image helpers (no Figma sandbox dependency) so they can be unit-tested.
 */

/** Sniff an image's MIME type from its magic bytes. */
/** Read PNG IHDR width/height (big-endian). Returns null if not a PNG. */
export function pngPixelSize(bytes: Uint8Array): { width: number; height: number } | null {
  // PNG signature (8) + IHDR length(4) + "IHDR"(4) + width(4) + height(4)
  if (bytes.length < 24) return null;
  if (!(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) {
    return null;
  }
  const width = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
  const height = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
  if (width === 0 || height === 0) return null;
  return { width, height };
}

export function detectMime(bytes: Uint8Array): ImageMimeType | null {
  const b = bytes;
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 3 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  )
    return 'image/webp';
  return null;
}

/** Figma IMAGE paint, structurally typed so it can be tested without the sandbox. */
export interface ImagePaintLike {
  scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE';
  rotation?: number;
  filters?: {
    exposure?: number;
    contrast?: number;
    saturation?: number;
    temperature?: number;
    tint?: number;
    highlights?: number;
    shadows?: number;
  };
}

export type ImageFillMode = 'cover' | 'contain' | 'crop' | 'tile';

const FILTER_KEYS = [
  'exposure',
  'contrast',
  'saturation',
  'temperature',
  'tint',
  'highlights',
  'shadows',
] as const;

export function hasImageFilters(filters: { [k: string]: number | undefined } | undefined): boolean {
  if (!filters) return false;
  return FILTER_KEYS.some((k) => (filters[k] ?? 0) !== 0);
}

/** Natural image size (px). */
export interface ImageSize {
  width: number;
  height: number;
}

/** Axis-aligned crop: image px (x, y) → node px (a*x + b*y + c, d*x + e*y + f). */
export interface ImageTransformLike {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** Round and clamp a srcRect edge into PowerPoint's 0..100000 range. */
export function clampEdge(v: number): number {
  return Math.round(Math.min(100000, Math.max(0, v)));
}

/** Clamp a full srcRect so opposite edges never sum past 100000. */
export function clampSrcRect(r: SrcRect): SrcRect {
  const l = clampEdge(r.l);
  const t = clampEdge(r.t);
  const rr = clampEdge(r.r);
  const b = clampEdge(r.b);
  const scaleW = l + rr > 100000 ? 100000 / (l + rr) : 1;
  const scaleH = t + b > 100000 ? 100000 / (t + b) : 1;
  return {
    l: Math.round(l * scaleW),
    r: Math.round(rr * scaleW),
    t: Math.round(t * scaleH),
    b: Math.round(b * scaleH),
  };
}

/**
 * `srcRect` for a center-crop "cover" (Figma FILL): scale the image to cover
 * the box, then crop the overflow symmetrically.
 */
export function coverSrcRect(img: ImageSize, boxW: number, boxH: number): SrcRect {
  if (img.width <= 0 || img.height <= 0 || boxW <= 0 || boxH <= 0) {
    return { l: 0, r: 0, t: 0, b: 0 };
  }
  const scale = Math.max(boxW / img.width, boxH / img.height);
  const shownW = boxW / scale;
  const shownH = boxH / scale;
  const hz = ((img.width - shownW) / img.width) * 100000 * 0.5;
  const vz = ((img.height - shownH) / img.height) * 100000 * 0.5;
  return clampSrcRect({ l: hz, r: hz, t: vz, b: vz });
}

/** Letterboxed display size for "contain" (Figma FIT): image scaled to fit. */
export function containFit(img: ImageSize, boxW: number, boxH: number): { w: number; h: number } {
  if (img.width <= 0 || img.height <= 0) return { w: boxW, h: boxH };
  const scale = Math.min(boxW / img.width, boxH / img.height);
  return { w: img.width * scale, h: img.height * scale };
}

/**
 * `srcRect` for a Figma CROP fill (`ImagePaint.imageTransform`).
 *
 * Figma's matrix is in **normalized unit space** for both the node and the
 * image (REST `STRETCH` uses the same shape — e.g. `[[0.5,0,0],[0,0.5,0]]`).
 * It maps container unit coords → image unit coords (axis-aligned):
 *   ix = a * nx + c
 *   iy = e * ny + f
 * with nx,ny ∈ [0,1] and ix,iy ∈ [0,1] over the natural image.
 *
 * Identity `[[1,0,0],[0,1,0]]` therefore shows the **entire** image stretched
 * into the node. Interpreting the matrix in Figma px (0..boxW) wrongly maps
 * identity to the top-left boxW×boxH pixels — a tall screenshot then becomes
 * "logo only" while the JPEG bytes remain complete (Path A).
 *
 * `boxW` / `boxH` are unused for the unit-space map (kept for call-site
 * compatibility). Returns null when the transform is sheared/rotated or the
 * mapped region leaves the image (caller falls back to exportAsync).
 */
export function cropSrcRect(
  img: ImageSize,
  _boxW: number,
  _boxH: number,
  t: ImageTransformLike
): SrcRect | null {
  // Shear/rotation (b or d ≠ 0) cannot be expressed as an axis-aligned srcRect.
  const shearTol = 1e-6;
  if (Math.abs(t.b) > shearTol || Math.abs(t.d) > shearTol) return null;
  if (t.a === 0 || t.e === 0) return null;
  if (img.width <= 0 || img.height <= 0) return null;

  // Node corners in unit space → image unit (container → image).
  const ix0 = t.c;
  const ix1 = t.a + t.c;
  const iy0 = t.f;
  const iy1 = t.e + t.f;

  const left = Math.min(ix0, ix1);
  const right = Math.max(ix0, ix1);
  const top = Math.min(iy0, iy1);
  const bottom = Math.max(iy0, iy1);

  // Empty space outside the image unit square → fall back to rasterization.
  const eps = 1e-3;
  if (left < -eps || top < -eps || right > 1 + eps || bottom > 1 + eps) {
    return null;
  }
  if (right - left < eps || bottom - top < eps) return null;

  return clampSrcRect({
    l: left * 100000,
    r: (1 - right) * 100000,
    t: top * 100000,
    b: (1 - bottom) * 100000,
  });
}

/**
 * Map a Figma IMAGE paint to a native sizing mode, or null when it must be
 * rasterized (image filters, or a rotation that cover/contain cannot express).
 */
export function imageFillMode(paint: ImagePaintLike): ImageFillMode | null {
  if (hasImageFilters(paint.filters)) return null;
  const rotation = paint.rotation ?? 0;
  if ((((rotation % 360) + 360) % 360) !== 0) return null;
  switch (paint.scaleMode) {
    case 'FILL':
      return 'cover';
    case 'FIT':
      return 'contain';
    case 'CROP':
      return 'crop';
    case 'TILE':
      return 'tile';
    default:
      return null;
  }
}

/**
 * Figma TILE `scalingFactor` → PowerPoint `<a:tile>` ratios (100000 = 100%).
 * A factor of 1 tiles the image at its native size; smaller factors shrink the
 * tile (more repeats). Returns null when the factor is > 1 (upscaled tile) or
 * non-positive — PowerPoint's tile ratio is a percentage (max 100%), so those
 * cases must be rasterized.
 */
export function tileScale(scalingFactor: number | undefined): { scaleX: number; scaleY: number } | null {
  const f = typeof scalingFactor === 'number' && isFinite(scalingFactor) ? scalingFactor : 1;
  if (f <= 0 || f > 1) return null;
  const pct = Math.round(f * 100000);
  const clamped = Math.min(100000, Math.max(1, pct));
  return { scaleX: clamped, scaleY: clamped };
}
