import type { IRElement, IRShape, Rect } from '../ir/types';
import { combineLeafOpacity } from './colors';

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * A solid shape that covers most of the frame and sits on top of an image is
 * the background veil. Frame layer opacity belongs on that veil.
 */
export function isBackgroundCover(
  shape: IRShape,
  elements: readonly IRElement[],
  frame: { width: number; height: number }
): boolean {
  if (!shape.fill) return false;
  const frameArea = frame.width * frame.height;
  if (!(frameArea > 0)) return false;
  const shapeArea = shape.rect.width * shape.rect.height;
  if (shapeArea < frameArea * 0.5) return false;
  return elements.some(
    (other) =>
      other.type === 'image' &&
      other.zIndex < shape.zIndex &&
      rectsIntersect(other.rect, shape.rect)
  );
}

/**
 * Root-frame layer opacity is not a page background color. Put it on the
 * covering shape so that shape stays above the images and below the text.
 */
export function applyRootCoverOpacity(
  elements: IRElement[],
  frame: { width: number; height: number },
  frameOpacity: number
): IRElement[] {
  if (frameOpacity >= 1 - 1e-6) return elements;
  for (const el of elements) {
    if (el.type !== 'shape') continue;
    if (!isBackgroundCover(el, elements, frame)) continue;
    el.opacity = combineLeafOpacity(frameOpacity, el.opacity);
  }
  return elements;
}

/** True when something already painted sits under this shape. */
export function shapeSitsOnLowerContent(
  shape: IRShape,
  elements: readonly IRElement[]
): boolean {
  return elements.some(
    (other) =>
      other !== shape &&
      other.zIndex < shape.zIndex &&
      other.opacity > 1e-6 &&
      rectsIntersect(other.rect, shape.rect)
  );
}
