import { describe, it, expect } from 'vitest';
import {
  childrenOverflowParent,
  shouldRasterizeForClipContent,
  transformedTextRect,
} from '../src/reader/geometry';
import { decideFallback } from '../src/reader/compat';

describe('childrenOverflowParent', () => {
  const parent = { x: 0, y: 0, width: 100, height: 100 };

  it('false when all children are inside', () => {
    expect(
      childrenOverflowParent(parent, [
        { x: 10, y: 10, width: 20, height: 20 },
        { x: 50, y: 50, width: 40, height: 40 },
      ])
    ).toBe(false);
  });

  it('true when any child extends past an edge', () => {
    expect(
      childrenOverflowParent(parent, [{ x: -5, y: 0, width: 20, height: 20 }])
    ).toBe(true);
    expect(
      childrenOverflowParent(parent, [{ x: 90, y: 0, width: 20, height: 20 }])
    ).toBe(true);
    expect(
      childrenOverflowParent(parent, [{ x: 0, y: 90, width: 20, height: 20 }])
    ).toBe(true);
  });

  it('false for empty children', () => {
    expect(childrenOverflowParent(parent, [])).toBe(false);
  });
});

describe('transformedTextRect', () => {
  it('converts a cumulative 90-degree text transform to PPT center geometry', () => {
    expect(
      transformedTextRect(
        100,
        40,
        [
          [0, -1, 200],
          [1, 0, 100],
        ],
        { x: 10, y: 20, width: 500, height: 500 }
      )
    ).toEqual({
      rect: { x: 120, y: 110, width: 100, height: 40 },
      rotation: 90,
      flipH: false,
      flipV: false,
      skewed: false,
    });
  });

  it('preserves cumulative scale without using the axis-aligned bounding box', () => {
    expect(
      transformedTextRect(
        80,
        20,
        [
          [2, 0, 30],
          [0, 1.5, 50],
        ],
        { x: 0, y: 0, width: 500, height: 500 }
      )
    ).toEqual({
      rect: { x: 30, y: 50, width: 160, height: 30 },
      rotation: 0,
      flipH: false,
      flipV: false,
      skewed: false,
    });
  });

  it('marks affine shear as unsupported by a native PPT text shape', () => {
    expect(
      transformedTextRect(
        100,
        40,
        [
          [1, 0.25, 0],
          [0, 1, 0],
        ],
        { x: 0, y: 0, width: 500, height: 500 }
      ).skewed
    ).toBe(true);
  });
});

describe('shouldRasterizeForClipContent', () => {
  it('only when both clip is on and children overflow', () => {
    expect(shouldRasterizeForClipContent(true, true)).toBe(true);
    expect(shouldRasterizeForClipContent(true, false)).toBe(false);
    expect(shouldRasterizeForClipContent(false, true)).toBe(false);
    expect(shouldRasterizeForClipContent(false, false)).toBe(false);
  });
});

describe('decideFallback + clipsContent', () => {
  it('rasterizes nested frame with clipsContent and overflow', () => {
    expect(
      decideFallback({
        type: 'FRAME',
        clipsContent: true,
        childrenOverflow: true,
        children: [{ type: 'RECTANGLE' }],
      })
    ).toEqual({ strategy: 'image', reason: 'clipsContent with overflow' });
  });

  it('does not force PNG for clipsContent without overflow (may recurse)', () => {
    const d = decideFallback({
      type: 'FRAME',
      clipsContent: true,
      childrenOverflow: false,
      children: [{ type: 'RECTANGLE' }],
    });
    expect(d.strategy).toBe('native');
  });

  it('INSTANCE / COMPONENT follow the same clip rule', () => {
    expect(
      decideFallback({
        type: 'INSTANCE',
        clipsContent: true,
        childrenOverflow: true,
        children: [{ type: 'ELLIPSE' }],
      }).reason
    ).toBe('clipsContent with overflow');
  });
});
