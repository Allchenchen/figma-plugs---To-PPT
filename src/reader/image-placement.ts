import type { Rect } from '../ir/types';

export interface ImagePlacementInput {
  /** absoluteBoundingBox relative to frame (may be unclipped). */
  aabb: Rect | null;
  /** absoluteRenderBounds relative to frame (closer to masked/visible pixels). */
  render: Rect | null;
  /** Frame size in the same coordinate space (origin at frame top-left). */
  frame: { width: number; height: number };
  /** Optional natural PNG pixel size (after export) for aspect correction. */
  pngWidthPx?: number;
  pngHeightPx?: number;
}

/**
 * Choose the slide placement rect for a rasterized node.
 *
 * Rules (visual fidelity):
 * 1. Prefer render bounds over AABB — Mask Groups often have a larger unclipped
 *    AABB than the masked PNG; stretching into the AABB causes deformation.
 * 2. Never shrink a hanging-off-frame graphic into the slide — keep negative
 *    x/y so PowerPoint clips the overflow (same as Figma's frame clip).
 * 3. If PNG pixel aspect diverges from the box (>1% ), fit the PNG aspect
 *    inside the box while keeping the box center (letterbox-free: we shrink
 *    the dominant axis only).
 */
export function imagePlacementRect(input: ImagePlacementInput): Rect {
  const base =
    input.render && input.render.width > 0.5 && input.render.height > 0.5
      ? input.render
      : input.aabb;
  if (!base || base.width <= 0 || base.height <= 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  let { x, y, width, height } = base;

  const pw = input.pngWidthPx;
  const ph = input.pngHeightPx;
  if (pw && ph && pw > 0 && ph > 0) {
    const boxAspect = width / height;
    const pngAspect = pw / ph;
    if (Math.abs(boxAspect - pngAspect) / pngAspect > 0.01) {
      // Match PNG aspect, keep center of the chosen bounds.
      const cx = x + width / 2;
      const cy = y + height / 2;
      if (boxAspect > pngAspect) {
        // Box too wide → shrink width
        width = height * pngAspect;
      } else {
        // Box too tall → shrink height
        height = width / pngAspect;
      }
      x = cx - width / 2;
      y = cy - height / 2;
    }
  }

  return { x, y, width, height };
}
