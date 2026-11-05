/**
 * Drop image/pictureShape layers that Figma does not show because an opaque
 * co-located image fully covers them.
 *
 * Portfolio phone mockups sometimes stack two RECTANGLE image fills on the
 * exact same box (e.g. JPEG + PNG of the same long screenshot). Figma only
 * shows the top opaque fill; emitting both produces a horizontal ghost/double
 * in PowerPoint when the bitmaps differ slightly.
 *
 * This is placement-and-coverage based — not hash/path/size dedupe. Distinct
 * nodes that share a media asset but sit at different rects are kept. A
 * translucent overlay (opacity < ~1) on the same box is kept.
 */

import type { IRElement, IRImage, IRPictureShape, Rect } from './types';

const TOL_PX = 1.5;
/** Over-image must be at least this opaque to treat as a full visual cover. */
const OPAQUE_MIN = 0.99;

export type ImageLike = IRImage | IRPictureShape;

function nearlyEqual(a: number, b: number, tol = TOL_PX): boolean {
  return Math.abs(a - b) <= tol;
}

/** Same slide placement box (position + size), within tolerance. */
export function samePlacementRect(a: Rect, b: Rect, tol = TOL_PX): boolean {
  return (
    nearlyEqual(a.x, b.x, tol) &&
    nearlyEqual(a.y, b.y, tol) &&
    nearlyEqual(a.width, b.width, tol) &&
    nearlyEqual(a.height, b.height, tol)
  );
}

function isImageLike(el: IRElement): el is ImageLike {
  return el.type === 'image' || el.type === 'pictureShape';
}

function elementKey(el: ImageLike): string {
  return `${el.type}:${el.id}:${el.zIndex}`;
}

/**
 * Among co-located opaque images, keep only the topmost (highest zIndex).
 * Lower layers are fully covered in Figma and must not become a second pic.
 *
 * Returns the filtered list. Does not mutate inputs.
 */
export function dropOccludedCoLocatedImages(elements: readonly IRElement[]): IRElement[] {
  const images = elements.filter(isImageLike);
  if (images.length < 2) return [...elements];

  const drop = new Set<string>();

  for (let i = 0; i < images.length; i++) {
    const under = images[i];
    if (drop.has(elementKey(under))) continue;

    for (let j = 0; j < images.length; j++) {
      if (i === j) continue;
      const over = images[j];
      if (over.zIndex <= under.zIndex) continue;
      if ((over.opacity ?? 1) < OPAQUE_MIN) continue;
      if (!samePlacementRect(under.rect, over.rect)) continue;
      // Same visible region: over paints the whole box; under is invisible.
      drop.add(elementKey(under));
      break;
    }
  }

  if (drop.size === 0) return [...elements];

  return elements.filter((el) => !isImageLike(el) || !drop.has(elementKey(el)));
}
