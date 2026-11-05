/**
 * Pure 2D affine matrix helpers (no Figma sandbox dependency) so coordinate
 * transforms can be unit-tested.
 *
 * A matrix is stored as a 2×3 array matching Figma's `Transform`:
 *   [ [m00, m01, m02], [m10, m11, m12] ]
 * interpreted as the homogeneous 3×3 affine
 *   [ m00 m01 m02 ]
 *   [ m10 m11 m12 ]
 *   [  0   0   1  ]
 * mapping a point (x, y) → (m00·x + m01·y + m02, m10·x + m11·y + m12).
 */

export type Matrix = [[number, number, number], [number, number, number]];

export function identity(): Matrix {
  return [[1, 0, 0], [0, 1, 0]];
}

export function translation(tx: number, ty: number): Matrix {
  return [[1, 0, tx], [0, 1, ty]];
}

/** Apply `b` first, then `a` (returns a·b). */
export function multiply(a: Matrix, b: Matrix): Matrix {
  const a00 = a[0][0], a01 = a[0][1], a02 = a[0][2];
  const a10 = a[1][0], a11 = a[1][1], a12 = a[1][2];
  const b00 = b[0][0], b01 = b[0][1], b02 = b[0][2];
  const b10 = b[1][0], b11 = b[1][1], b12 = b[1][2];
  return [
    [a00 * b00 + a01 * b10, a00 * b01 + a01 * b11, a00 * b02 + a01 * b12 + a02],
    [a10 * b00 + a11 * b10, a10 * b01 + a11 * b11, a10 * b02 + a11 * b12 + a12],
  ];
}

/** Normalize `-0` to `0` so affine results compare stably. */
function nz(n: number): number {
  return Object.is(n, -0) ? 0 : n;
}

/** Invert an affine matrix, or null when singular (det ≈ 0). */
export function invert(m: Matrix): Matrix | null {
  const a = m[0][0], b = m[0][1], c = m[0][2];
  const d = m[1][0], e = m[1][1], f = m[1][2];
  const det = a * e - b * d;
  if (Math.abs(det) < 1e-12) return null;
  const ia = e / det;
  const ib = -b / det;
  const ic = (b * f - e * c) / det;
  const id = -d / det;
  const ie = a / det;
  const iff = (d * c - a * f) / det;
  return [
    [nz(ia), nz(ib), nz(ic)],
    [nz(id), nz(ie), nz(iff)],
  ];
}

/** Apply a matrix to a point. */
export function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  return {
    x: m[0][0] * x + m[0][1] * y + m[0][2],
    y: m[1][0] * x + m[1][1] * y + m[1][2],
  };
}
