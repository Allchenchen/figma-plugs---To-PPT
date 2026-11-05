import type { CornerRadii } from '../ir/types';

/**
 * Corner radius source, resolved by the reader:
 * `cornerRadius` holds a single number when all four corners match;
 * otherwise it is `undefined` and the per-corner values are used.
 *
 * Values are in the **same space as `node.width` / `node.height`** (local).
 * When the node sits under a scaled Instance / group transform, multiply by
 * `absoluteCornerScale` before clamping to the absolute placement box.
 */
export interface CornerSource {
  cornerRadius?: number;
  topLeftRadius?: number;
  topRightRadius?: number;
  bottomRightRadius?: number;
  bottomLeftRadius?: number;
}

/** Scale every defined radius by `scale` (no-op when scale ≈ 1). */
export function scaleCornerSource(src: CornerSource, scale: number): CornerSource {
  if (!isFinite(scale) || Math.abs(scale - 1) < 1e-6) return src;
  const s = Math.max(0, scale);
  const out: CornerSource = {};
  if (typeof src.cornerRadius === 'number') out.cornerRadius = src.cornerRadius * s;
  if (typeof src.topLeftRadius === 'number') out.topLeftRadius = src.topLeftRadius * s;
  if (typeof src.topRightRadius === 'number') out.topRightRadius = src.topRightRadius * s;
  if (typeof src.bottomRightRadius === 'number') out.bottomRightRadius = src.bottomRightRadius * s;
  if (typeof src.bottomLeftRadius === 'number') out.bottomLeftRadius = src.bottomLeftRadius * s;
  return out;
}

/** Per-corner max; either side may be null. */
export function maxCornerRadii(
  a: CornerRadii | null,
  b: CornerRadii | null
): CornerRadii | null {
  if (!a) return b;
  if (!b) return a;
  return {
    tl: Math.max(a.tl, b.tl),
    tr: Math.max(a.tr, b.tr),
    br: Math.max(a.br, b.br),
    bl: Math.max(a.bl, b.bl),
  };
}

/**
 * Extract four independent corner radii (px), clamped so adjacent
 * corners never exceed their shared edge. Returns null when all zero.
 *
 * `width` / `height` must be in the **same coordinate space** as the radii
 * (typically the absolute placement box after `scaleCornerSource`).
 */
export function extractCornerRadii(
  src: CornerSource,
  width: number,
  height: number
): CornerRadii | null {
  let tl: number;
  let tr: number;
  let br: number;
  let bl: number;

  if (typeof src.cornerRadius === 'number') {
    const r = Math.max(0, src.cornerRadius);
    tl = tr = br = bl = r;
  } else {
    tl = Math.max(0, src.topLeftRadius || 0);
    tr = Math.max(0, src.topRightRadius || 0);
    br = Math.max(0, src.bottomRightRadius || 0);
    bl = Math.max(0, src.bottomLeftRadius || 0);
  }

  const maxR = Math.min(width, height) / 2;
  tl = Math.min(tl, maxR);
  tr = Math.min(tr, maxR);
  br = Math.min(br, maxR);
  bl = Math.min(bl, maxR);

  const scalePair = (a: number, b: number, edge: number): [number, number] => {
    const sum = a + b;
    if (sum <= edge || sum === 0) return [a, b];
    const k = edge / sum;
    return [a * k, b * k];
  };

  let p = scalePair(tl, tr, width);
  tl = p[0];
  tr = p[1];
  p = scalePair(bl, br, width);
  bl = p[0];
  br = p[1];
  p = scalePair(tl, bl, height);
  tl = p[0];
  bl = p[1];
  p = scalePair(tr, br, height);
  tr = p[0];
  br = p[1];

  if (tl === 0 && tr === 0 && br === 0 && bl === 0) return null;
  return { tl, tr, br, bl };
}
