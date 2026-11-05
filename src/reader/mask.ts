import type { Rect, SrcRect } from '../ir/types';
import { clampSrcRect } from './image';

/**
 * Mask scope partitioning. Pure (no Figma global) so it can be unit-tested.
 *
 * Figma's rule: a node with `isMask` clips every subsequent sibling in the
 * same parent (paint order) until the next mask node or the end of the list.
 * The mask node itself is not rendered — it only defines the clip.
 */

export type ChildSegment<T> =
  | { kind: 'masked'; nodes: T[] }
  | { kind: 'plain'; nodes: T[] };

function isMaskNode<T>(n: T): boolean {
  return Boolean((n as { isMask?: boolean }).isMask);
}

/**
 * Split an ordered sibling list into masked segments (a mask node followed by
 * its masked siblings) and plain segments (everything else). The original
 * order is preserved.
 */
export function partitionChildren<T>(children: readonly T[]): ChildSegment<T>[] {
  const segments: ChildSegment<T>[] = [];
  let i = 0;
  while (i < children.length) {
    const child = children[i];
    if (isMaskNode(child)) {
      const nodes: T[] = [child];
      i++;
      while (i < children.length && !isMaskNode(children[i])) {
        nodes.push(children[i]);
        i++;
      }
      segments.push({ kind: 'masked', nodes });
    } else {
      const nodes: T[] = [child];
      i++;
      while (i < children.length && !isMaskNode(children[i])) {
        nodes.push(children[i]);
        i++;
      }
      segments.push({ kind: 'plain', nodes });
    }
  }
  return segments;
}

/** Axis-aligned union of the given boxes (Figma px). */
export function unionRect(boxes: readonly Rect[]): Rect | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (!isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Axis-aligned intersection of two rects, or null when they don't overlap. */
export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** Whether `outer` fully contains `inner` (within `eps` px tolerance). */
export function rectContains(outer: Rect, inner: Rect, eps = 0.5): boolean {
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.width <= outer.x + outer.width + eps &&
    inner.y + inner.height <= outer.y + outer.height + eps
  );
}

/**
 * Crop fractions (as a `<a:srcRect>`) that select the `maskBox` sub-region of
 * the `contentBox`. Assumes `maskBox ⊆ contentBox` (caller checks). Returns
 * null when the two boxes coincide (no crop needed).
 */
export function subRectSrcRect(contentBox: Rect, maskBox: Rect): SrcRect | null {
  const dx = maskBox.x - contentBox.x;
  const dy = maskBox.y - contentBox.y;
  const same =
    Math.abs(dx) < 0.5 &&
    Math.abs(dy) < 0.5 &&
    Math.abs(maskBox.width - contentBox.width) < 0.5 &&
    Math.abs(maskBox.height - contentBox.height) < 0.5;
  if (same) return null;

  if (contentBox.width <= 0 || contentBox.height <= 0) return null;
  return clampSrcRect({
    l: (dx / contentBox.width) * 100000,
    r: (1 - (dx + maskBox.width) / contentBox.width) * 100000,
    t: (dy / contentBox.height) * 100000,
    b: (1 - (dy + maskBox.height) / contentBox.height) * 100000,
  });
}

/** Clip geometry the mask can be expressed as natively. */
export type MaskShapeKind = 'rect' | 'roundRect' | 'ellipse' | 'star' | 'polygon';

export type MaskDecision =
  | { kind: 'drop' } // no visible intersection
  | { kind: 'no-op' } // content fully inside mask → mask clips nothing
  | { kind: 'picture-shape'; srcRect: SrcRect | null; shapeKind: MaskShapeKind }
  | { kind: 'png' }; // partial overlap / unsupported geometry → local raster

export interface MaskDecisionInput {
  maskType: string;
  maskBox: Rect | null;
  contentBox: Rect | null;
  /** RECTANGLE mask with a non-zero corner radius. */
  hasCornerRadii: boolean;
  /** STAR/POLYGON mask whose vector has multiple sub-paths (holes). */
  hasCompoundVector: boolean;
  /** Figma `maskType` (ALPHA / VECTOR / LUMINANCE). Defaults to ALPHA. */
  figmaMaskType?: 'ALPHA' | 'VECTOR' | 'LUMINANCE' | string;
  /** Number of content nodes clipped by this mask (excluding the mask itself). */
  contentCount?: number;
  /** True when any content descendant is itself a mask. */
  contentHasNestedMask?: boolean;
  /** True when content includes VECTOR / BOOLEAN / star-polygon compound paths. */
  contentHasComplexType?: boolean;
}

/**
 * Whether a masked segment must be exported as one localized PNG (never split
 * into mask shape + unclipped content). Visual fidelity beats native editability.
 */
export function maskSegmentMustRasterize(input: {
  maskType: string;
  contentCount?: number;
  contentHasNestedMask?: boolean;
  contentHasComplexType?: boolean;
  figmaMaskType?: string;
}): boolean {
  if (input.figmaMaskType === 'LUMINANCE') return true;
  if (input.contentHasNestedMask) return true;
  if (input.maskType === 'VECTOR' || input.maskType === 'BOOLEAN_OPERATION') return true;
  if (input.maskType === 'GROUP' || input.maskType === 'FRAME' || input.maskType === 'COMPONENT' || input.maskType === 'INSTANCE') {
    return true;
  }
  // Multi-child / complex content under a mask: keep the clip intact as one PNG.
  if ((input.contentCount ?? 0) > 1 && input.contentHasComplexType) return true;
  if ((input.contentCount ?? 0) > 1 && input.maskType !== 'RECTANGLE' && input.maskType !== 'ELLIPSE') {
    return true;
  }
  return false;
}

/**
 * Prefer the measured export group's box (matches PNG pixels after mask clip)
 * over the union of unclipped node AABBs — otherwise the image is stretched /
 * shifted into a larger frame.
 */
export function chooseExportPlacement(
  unclippedUnion: Rect | null,
  measuredExportBox: Rect | null
): Rect | null {
  if (
    measuredExportBox &&
    measuredExportBox.width > 0.5 &&
    measuredExportBox.height > 0.5
  ) {
    return measuredExportBox;
  }
  if (unclippedUnion && unclippedUnion.width > 0 && unclippedUnion.height > 0) {
    return unclippedUnion;
  }
  return null;
}

/**
 * Decide how to reproduce a masked segment (mask node + its content) natively,
 * falling back to a localized PNG only when a faithful native clip is not
 * possible. The mask node itself never renders; it only defines the clip.
 */
export function decideMask(input: MaskDecisionInput): MaskDecision {
  const { maskType, maskBox, contentBox } = input;
  if (!maskBox || !contentBox) return { kind: 'png' };

  const inter = intersectRect(maskBox, contentBox);
  if (!inter) return { kind: 'drop' };

  // Complex / multi-child / luminance / nested → one local PNG. Never split.
  if (
    maskSegmentMustRasterize({
      maskType,
      contentCount: input.contentCount,
      contentHasNestedMask: input.contentHasNestedMask,
      contentHasComplexType: input.contentHasComplexType,
      figmaMaskType: input.figmaMaskType,
    })
  ) {
    return { kind: 'png' };
  }

  // A compound star/polygon vector (holes) cannot be a single editable custGeom.
  if (
    (maskType === 'STAR' || maskType === 'POLYGON') &&
    input.hasCompoundVector
  ) {
    return { kind: 'png' };
  }

  // Only a plain rectangular mask clips to its bounding box, so "content fully
  // inside the mask" is a genuine no-op there. Rounded/elliptical/star masks
  // clip their bounding-box corners, so they are never a no-op.
  // Also refuse no-op when content is complex (would unclip vectors incorrectly).
  const isPlainRect = maskType === 'RECTANGLE' && !input.hasCornerRadii;
  if (
    isPlainRect &&
    rectContains(maskBox, contentBox) &&
    !input.contentHasComplexType &&
    !input.contentHasNestedMask
  ) {
    return { kind: 'no-op' };
  }

  // Otherwise the mask must be fully covered by content for a native
  // picture-shape; otherwise the fill would show content where Figma shows
  // empty space.
  if (!rectContains(contentBox, maskBox)) return { kind: 'png' };

  const srcRect = subRectSrcRect(contentBox, maskBox);
  switch (maskType) {
    case 'RECTANGLE':
      return { kind: 'picture-shape', srcRect, shapeKind: input.hasCornerRadii ? 'roundRect' : 'rect' };
    case 'ELLIPSE':
      return { kind: 'picture-shape', srcRect, shapeKind: 'ellipse' };
    case 'STAR':
      return { kind: 'picture-shape', srcRect, shapeKind: 'star' };
    case 'POLYGON':
      return { kind: 'picture-shape', srcRect, shapeKind: 'polygon' };
    default:
      return { kind: 'png' };
  }
}
