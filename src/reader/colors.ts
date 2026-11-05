/** Channel 0..1 → 2-digit uppercase hex. */
function channelHex(v: number): string {
  return Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
}

export function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  return `#${channelHex(rgb.r)}${channelHex(rgb.g)}${channelHex(rgb.b)}`;
}

/** Clamp 0..1. */
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Alpha channel on a SOLID color (Figma `color.a`), default 1 when absent.
 * Designers often set transparency on the color itself rather than Paint.opacity.
 */
export function solidColorAlpha(paint: Paint): number {
  if (paint.type !== 'SOLID') return 1;
  const a = (paint.color as RGB & { a?: number }).a;
  return typeof a === 'number' ? clamp01(a) : 1;
}

/**
 * Effective paint opacity = Paint.opacity × color.a (both default to 1).
 * Missing Paint.opacity must NOT skip color.a — otherwise semi-transparent
 * blacks become opaque (or the reverse mismatch vs Figma).
 */
export function paintOpacity(paint: Paint): number {
  const layer =
    'opacity' in paint && typeof paint.opacity === 'number' ? clamp01(paint.opacity) : 1;
  return clamp01(layer * solidColorAlpha(paint));
}

/**
 * Explicit combined opacity when either Paint.opacity or color.a is set.
 * `undefined` only when both are absent (treat as fully opaque at call sites
 * that fall back to node.fills).
 */
export function paintOpacityExplicit(paint: Paint): number | undefined {
  const hasPaintOp = 'opacity' in paint && typeof paint.opacity === 'number';
  const hasColorA =
    paint.type === 'SOLID' && typeof (paint.color as RGB & { a?: number }).a === 'number';
  if (!hasPaintOp && !hasColorA) return undefined;
  return paintOpacity(paint);
}

function topSolidPaint(fills: readonly Paint[]): Paint | undefined {
  for (let i = fills.length - 1; i >= 0; i--) {
    const fill = fills[i];
    if (fill.visible === false) continue;
    if (fill.type === 'SOLID') return fill;
  }
  return undefined;
}

/**
 * Resolve text fill color + opacity from styled-segment paints, falling back to
 * the TextNode's own `fills` when segment paints omit `opacity` (common in the
 * Figma plugin API). Matches UI: Layer 100% + Fill 80% → opacity 0.8.
 */
export function resolveTextSolidFill(
  segmentFills: readonly Paint[],
  nodeFills: readonly Paint[]
): SolidFill | undefined {
  const segPaint = topSolidPaint(segmentFills);
  const nodePaint = topSolidPaint(nodeFills);
  if (!segPaint && !nodePaint) return undefined;

  const color = rgbToHex(
    ((segPaint ?? nodePaint) as SolidPaint).color
  );

  const segOp = segPaint ? paintOpacityExplicit(segPaint) : undefined;
  const nodeOp = nodePaint ? paintOpacityExplicit(nodePaint) : undefined;
  const opacity = segOp !== undefined ? segOp : nodeOp !== undefined ? nodeOp : 1;

  return { color, opacity };
}

/**
 * Combine opacities that belong to the SAME leaf (node.opacity × paint.opacity).
 * Do NOT use this to push a parent group's opacity onto multiple overlapping
 * children — that changes compositing; use `shouldRasterizeForGroupOpacity`.
 */
export function combineLeafOpacity(nodeOpacity: number, fillOpacity: number): number {
  const a = Math.min(1, Math.max(0, nodeOpacity));
  const b = Math.min(1, Math.max(0, fillOpacity));
  return a * b;
}

/**
 * Group opacity is applied to the flattened group in Figma. Decomposing a
 * semi-transparent multi-child group and multiplying each child is wrong when
 * children overlap. Rasterize the group as one image instead.
 */
export function shouldRasterizeForGroupOpacity(groupOpacity: number, childCount: number): boolean {
  return groupOpacity < 1 - 1e-6 && childCount > 1;
}

export interface SolidFill {
  color: string;
  /** 0..1 paint opacity */
  opacity: number;
}

/**
 * Topmost visible SOLID fill with its paint opacity, or undefined.
 * `fills` must already be resolved (pass `[]` for `figma.mixed`).
 */
export function topSolidFill(fills: readonly Paint[]): SolidFill | undefined {
  for (let i = fills.length - 1; i >= 0; i--) {
    const fill = fills[i];
    if (fill.visible === false) continue;
    if (fill.type === 'SOLID') {
      return { color: rgbToHex(fill.color), opacity: paintOpacity(fill) };
    }
  }
  return undefined;
}

/**
 * Topmost visible SOLID fill color, or undefined.
 * `fills` must already be resolved (pass `[]` for `figma.mixed`).
 */
export function topSolidFillColor(fills: readonly Paint[]): string | undefined {
  return topSolidFill(fills)?.color;
}
