/**
 * Drop opaque solid rects that sit as a thin aligned edge strip *on top of*
 * an image. Portfolio phone mockups often stack a footer/header chrome rect
 * above a full-page screenshot; when the chrome's children (logo/text/icons)
 * are missing or already baked into the screenshot, the bare fill hides the
 * artwork while still looking like a "dark footer bar".
 *
 * Scope is intentionally narrow: same x/width (or y/height), flush to one
 * edge, ≤5% of the image's span on that axis, higher zIndex than the image,
 * solid fill, no stroke, axis-aligned rect. Center badges and bordered cards
 * are untouched.
 */

import type { IRElement, IRImage, IRPictureShape, IRShape, Rect } from './types';

const TOL_PX = 1.5;
/** Max strip thickness as a fraction of the covered image edge length. */
const MAX_STRIP_FRAC = 0.05;

export type ImageLike = Pick<IRImage | IRPictureShape, 'type' | 'rect' | 'zIndex'>;

function nearlyEqual(a: number, b: number, tol = TOL_PX): boolean {
  return Math.abs(a - b) <= tol;
}

/** Thin strip flush with the bottom edge of `image`, same x/width. */
export function isBottomEdgeStrip(shape: Rect, image: Rect): boolean {
  if (shape.height <= 0 || image.height <= 0) return false;
  if (shape.height > image.height * MAX_STRIP_FRAC) return false;
  return (
    nearlyEqual(shape.x, image.x) &&
    nearlyEqual(shape.width, image.width) &&
    nearlyEqual(shape.y + shape.height, image.y + image.height)
  );
}

/** Thin strip flush with the top edge of `image`, same x/width. */
export function isTopEdgeStrip(shape: Rect, image: Rect): boolean {
  if (shape.height <= 0 || image.height <= 0) return false;
  if (shape.height > image.height * MAX_STRIP_FRAC) return false;
  return (
    nearlyEqual(shape.x, image.x) &&
    nearlyEqual(shape.width, image.width) &&
    nearlyEqual(shape.y, image.y)
  );
}

export function isImageEdgeCoverStrip(shape: Rect, image: Rect): boolean {
  return isBottomEdgeStrip(shape, image) || isTopEdgeStrip(shape, image);
}

function isCoverCandidate(el: IRElement): el is IRShape {
  if (el.type !== 'shape') return false;
  if (el.shapeKind !== 'rect') return false;
  if (!el.fill) return false;
  if (el.stroke) return false;
  if (el.rotation !== 0) return false;
  if (el.cornerRadii) {
    const { tl, tr, br, bl } = el.cornerRadii;
    if (tl > 0 || tr > 0 || br > 0 || bl > 0) return false;
  }
  return true;
}

function isImageLike(el: IRElement): el is IRImage | IRPictureShape {
  return el.type === 'image' || el.type === 'pictureShape';
}

/**
 * Remove solid edge-strip shapes that paint above an image and would occlude
 * screenshot footer/header detail already present in the bitmap.
 */
export function dropImageEdgeCoverShapes(elements: readonly IRElement[]): IRElement[] {
  const images = elements.filter(isImageLike);
  if (images.length === 0) return [...elements];

  return elements.filter((el) => {
    if (!isCoverCandidate(el)) return true;
    for (const img of images) {
      if (el.zIndex <= img.zIndex) continue;
      if (isImageEdgeCoverStrip(el.rect, img.rect)) return false;
    }
    return true;
  });
}
