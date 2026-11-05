import { describe, it, expect } from 'vitest';
import { identity, translation, multiply, invert, apply, type Matrix } from '../src/reader/matrix';

const TOL = 1e-9;

function close(a: number, b: number): boolean {
  return Math.abs(a - b) < TOL;
}

describe('multiply', () => {
  it('applies b then a', () => {
    // translate(10, 0) then translate(0, 20) → translate(10, 20)
    const m = multiply(translation(0, 20), translation(10, 0));
    expect(m).toEqual([[1, 0, 10], [0, 1, 20]]);
  });

  it('is associative with identity', () => {
    const t = translation(5, 7);
    expect(multiply(identity(), t)).toEqual(t);
    expect(multiply(t, identity())).toEqual(t);
  });
});

describe('invert', () => {
  it('inverts a translation', () => {
    expect(invert(translation(30, -12))).toEqual([[1, 0, -30], [0, 1, 12]]);
  });

  it('round-trips a general affine', () => {
    const m: Matrix = [[2, 1, 5], [0.5, -1, 3]];
    const inv = invert(m)!;
    const back = multiply(inv, m);
    expect(close(back[0][0], 1)).toBe(true);
    expect(close(back[0][1], 0)).toBe(true);
    expect(close(back[0][2], 0)).toBe(true);
    expect(close(back[1][0], 0)).toBe(true);
    expect(close(back[1][1], 1)).toBe(true);
    expect(close(back[1][2], 0)).toBe(true);
  });

  it('returns null for singular matrices', () => {
    expect(invert([[0, 0, 0], [0, 0, 0]])).toBeNull();
  });
});

describe('apply', () => {
  it('maps points through translation and rotation', () => {
    const rot90: Matrix = [[0, -1, 0], [1, 0, 0]]; // 90° clockwise
    const p = apply(rot90, 1, 0);
    expect(close(p.x, 0)).toBe(true);
    expect(close(p.y, 1)).toBe(true);
  });
});

describe('absolute → relative repositioning (export canvas)', () => {
  it('repositions a nested node into a frame while preserving absolute layout', () => {
    // Original node absolute transform: translated to (130, 240), rotated 90°.
    const abs: Matrix = [[0, -1, 130], [1, 0, 240]];
    // Temp frame at absolute (100, 200) (no rotation).
    const frame = translation(100, 200);
    // relative = frame⁻¹ · abs
    const rel = multiply(invert(frame)!, abs);
    // Re-compose absolute = frame · rel → must equal abs.
    expect(multiply(frame, rel)).toEqual(abs);
  });
});
