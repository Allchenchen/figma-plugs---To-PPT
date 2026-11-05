export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextTransformGeometry {
  rect: Box;
  /** Clockwise degrees in the Figma/PPT screen coordinate system. */
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  /** DrawingML text shapes cannot represent affine shear. */
  skewed: boolean;
}

/**
 * Convert a cumulative Figma affine transform to an unrotated PPT text box.
 * The box is positioned by its transformed center because PPT rotates shapes
 * around their center, not around Figma's local origin.
 */
export function transformedTextRect(
  localWidth: number,
  localHeight: number,
  transform: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
  ],
  rootBox: Box
): TextTransformGeometry {
  const [[a, c, e], [b, d, f]] = transform;
  const scaleX = Math.hypot(a, b);
  const scaleY = Math.hypot(c, d);
  const determinant = a * d - b * c;
  const normalizedDot =
    scaleX > 0 && scaleY > 0 ? (a * c + b * d) / (scaleX * scaleY) : 0;
  const width = localWidth * scaleX;
  const height = localHeight * scaleY;
  const centerX = a * (localWidth / 2) + c * (localHeight / 2) + e;
  const centerY = b * (localWidth / 2) + d * (localHeight / 2) + f;
  const rawRotation = (Math.atan2(b, a) * 180) / Math.PI;
  const rotation = Math.abs(rawRotation) < 1e-10 ? 0 : rawRotation;
  return {
    rect: {
      x: centerX - rootBox.x - width / 2,
      y: centerY - rootBox.y - height / 2,
      width,
      height,
    },
    rotation,
    flipH: false,
    flipV: determinant < 0,
    skewed: Math.abs(normalizedDot) > 1e-6,
  };
}

/**
 * Bounds of a node relative to a root node's top-left corner.
 * Uses absolute bounding boxes, so nesting depth is irrelevant —
 * we never sum local x/y.
 */
export function relativeBounds(
  nodeBox: Box | null,
  rootBox: Box | null
): Box | null {
  if (!nodeBox || !rootBox) return null;
  return {
    x: nodeBox.x - rootBox.x,
    y: nodeBox.y - rootBox.y,
    width: nodeBox.width,
    height: nodeBox.height,
  };
}

/**
 * True when any child AABB extends outside the parent box (Figma px).
 * Used with `clipsContent`: overflow + clip → must rasterize the frame as one
 * unit; decomposing would leak unclipped children into PPT.
 */
export function childrenOverflowParent(
  parent: Box,
  children: readonly Box[],
  eps = 0.5
): boolean {
  for (const c of children) {
    if (
      c.x < parent.x - eps ||
      c.y < parent.y - eps ||
      c.x + c.width > parent.x + parent.width + eps ||
      c.y + c.height > parent.y + parent.height + eps
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Nested Frame/Component/Instance with Clip content ON and overflowing children
 * must export as one local PNG (preserve clip). Non-overflowing clip frames may
 * still recurse — clipping is a no-op when nothing sticks out.
 */
export function shouldRasterizeForClipContent(
  clipsContent: boolean,
  overflows: boolean
): boolean {
  return clipsContent && overflows;
}
