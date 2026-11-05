export type LineOrientation = 'horizontal' | 'vertical' | 'diagonal';

/**
 * Classify a Figma LINE node by its bounding box vs stroke weight.
 * A straight (horizontal/vertical) line has one bounding-box dimension equal
 * to the stroke thickness; a diagonal line spans both dimensions.
 *
 * Pure function so it can be unit-tested without a Figma sandbox.
 */
export function classifyLine(
  width: number,
  height: number,
  strokeWeight: number
): LineOrientation {
  const w = Math.max(0, strokeWeight);
  const tol = 1.5; // px, absorbs absoluteBoundingBox rounding
  const isHorizontal = Math.abs(height - w) <= tol;
  const isVertical = Math.abs(width - w) <= tol;
  if (isHorizontal) return 'horizontal';
  if (isVertical) return 'vertical';
  return 'diagonal';
}
