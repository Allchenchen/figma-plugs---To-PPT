import { describe, it, expect } from 'vitest';
import {
  extractCornerRadii,
  maxCornerRadii,
  scaleCornerSource,
} from '../src/reader/corners';

describe('extractCornerRadii', () => {
  it('returns null when all corners are zero', () => {
    expect(extractCornerRadii({ cornerRadius: 0 }, 100, 100)).toBeNull();
  });

  it('uniform radius is shared across corners', () => {
    expect(extractCornerRadii({ cornerRadius: 10 }, 100, 100)).toEqual({
      tl: 10,
      tr: 10,
      br: 10,
      bl: 10,
    });
  });

  it('reads independent corner radii', () => {
    const r = extractCornerRadii(
      { topLeftRadius: 4, topRightRadius: 8, bottomRightRadius: 12, bottomLeftRadius: 16 },
      100,
      100
    );
    expect(r).toEqual({ tl: 4, tr: 8, br: 12, bl: 16 });
  });

  it('clamps radius to half the shorter side', () => {
    const r = extractCornerRadii({ cornerRadius: 1000 }, 100, 20);
    expect(r?.tl).toBe(10);
  });

  it('scales adjacent corners so their sum fits the edge', () => {
    // width = 10, tl = 8, tr = 8 → must scale to 5 + 5
    const r = extractCornerRadii(
      { topLeftRadius: 8, topRightRadius: 8, bottomRightRadius: 0, bottomLeftRadius: 0 },
      10,
      100
    );
    expect(r).toEqual({ tl: 5, tr: 5, br: 0, bl: 0 });
  });

  it('keeps absolute-space radius after instance scale (local r × scale)', () => {
    // Local r=10 under 4× Instance → absolute r=40 on a 400×400 box.
    const scaled = scaleCornerSource({ cornerRadius: 10 }, 4);
    const r = extractCornerRadii(scaled, 400, 400);
    expect(r).toEqual({ tl: 40, tr: 40, br: 40, bl: 40 });
  });
});

describe('scaleCornerSource', () => {
  it('is a no-op near scale=1', () => {
    const src = { cornerRadius: 10 };
    expect(scaleCornerSource(src, 1)).toBe(src);
  });

  it('scales independent corners', () => {
    expect(
      scaleCornerSource(
        { topLeftRadius: 4, topRightRadius: 8, bottomRightRadius: 12, bottomLeftRadius: 16 },
        2
      )
    ).toEqual({
      topLeftRadius: 8,
      topRightRadius: 16,
      bottomRightRadius: 24,
      bottomLeftRadius: 32,
    });
  });
});

describe('maxCornerRadii', () => {
  it('returns the non-null side', () => {
    expect(maxCornerRadii(null, { tl: 1, tr: 2, br: 3, bl: 4 })).toEqual({
      tl: 1,
      tr: 2,
      br: 3,
      bl: 4,
    });
    expect(maxCornerRadii({ tl: 5, tr: 5, br: 5, bl: 5 }, null)).toEqual({
      tl: 5,
      tr: 5,
      br: 5,
      bl: 5,
    });
  });

  it('takes per-corner max for parent clip inheritance', () => {
    expect(
      maxCornerRadii(
        { tl: 10, tr: 10, br: 10, bl: 10 },
        { tl: 40, tr: 40, br: 40, bl: 40 }
      )
    ).toEqual({ tl: 40, tr: 40, br: 40, bl: 40 });
  });
});
