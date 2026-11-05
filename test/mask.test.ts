import { describe, it, expect } from 'vitest';
import {
  partitionChildren,
  unionRect,
  intersectRect,
  rectContains,
  subRectSrcRect,
  decideMask,
  chooseExportPlacement,
  maskSegmentMustRasterize,
} from '../src/reader/mask';

describe('partitionChildren', () => {
  it('keeps plain children in one segment', () => {
    const segs = partitionChildren([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ]);
    expect(segs).toEqual([{ kind: 'plain', nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }]);
  });

  it('groups a mask with all following siblings', () => {
    const segs = partitionChildren([
      { id: 'a' },
      { id: 'm', isMask: true },
      { id: 'b' },
      { id: 'c' },
    ]);
    expect(segs).toEqual([
      { kind: 'plain', nodes: [{ id: 'a' }] },
      { kind: 'masked', nodes: [{ id: 'm', isMask: true }, { id: 'b' }, { id: 'c' }] },
    ]);
  });

  it('stops a mask segment at the next mask node', () => {
    const segs = partitionChildren([
      { id: 'm1', isMask: true },
      { id: 'a' },
      { id: 'm2', isMask: true },
      { id: 'b' },
      { id: 'c' },
    ]);
    expect(segs).toEqual([
      { kind: 'masked', nodes: [{ id: 'm1', isMask: true }, { id: 'a' }] },
      { kind: 'masked', nodes: [{ id: 'm2', isMask: true }, { id: 'b' }, { id: 'c' }] },
    ]);
  });

  it('handles a lone trailing mask', () => {
    const segs = partitionChildren([{ id: 'a' }, { id: 'm', isMask: true }]);
    expect(segs).toEqual([
      { kind: 'plain', nodes: [{ id: 'a' }] },
      { kind: 'masked', nodes: [{ id: 'm', isMask: true }] },
    ]);
  });

  it('handles a leading mask with no siblings', () => {
    expect(partitionChildren([{ id: 'm', isMask: true }])).toEqual([
      { kind: 'masked', nodes: [{ id: 'm', isMask: true }] },
    ]);
  });

  it('preserves order across mixed segments', () => {
    const segs = partitionChildren([
      { id: 'a' },
      { id: 'm', isMask: true },
      { id: 'b' },
      { id: 'd' },
    ]);
    expect(segs[0].nodes.map((n) => n.id)).toEqual(['a']);
    expect(segs[1].nodes.map((n) => n.id)).toEqual(['m', 'b', 'd']);
  });
});

describe('unionRect', () => {
  it('computes the bounding union', () => {
    expect(
      unionRect([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 5, y: 20, width: 10, height: 5 },
      ])
    ).toEqual({ x: 0, y: 0, width: 15, height: 25 });
  });

  it('returns null for empty input', () => {
    expect(unionRect([])).toBeNull();
  });
});

describe('intersectRect', () => {
  it('computes the overlapping region', () => {
    expect(intersectRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }))
      .toEqual({ x: 5, y: 5, width: 5, height: 5 });
  });

  it('returns null for disjoint rects', () => {
    expect(intersectRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 0, width: 5, height: 5 }))
      .toBeNull();
  });
});

describe('rectContains', () => {
  it('true when inner is fully inside outer', () => {
    expect(rectContains({ x: 0, y: 0, width: 100, height: 100 }, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
  });

  it('false when inner pokes out', () => {
    expect(rectContains({ x: 0, y: 0, width: 50, height: 50 }, { x: 40, y: 0, width: 20, height: 20 })).toBe(false);
  });
});

describe('subRectSrcRect', () => {
  it('returns null when mask and content coincide', () => {
    expect(subRectSrcRect({ x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: 100, height: 100 })).toBeNull();
  });

  it('computes crop fractions for a centered sub-rect', () => {
    expect(subRectSrcRect({ x: 0, y: 0, width: 200, height: 200 }, { x: 50, y: 50, width: 100, height: 100 }))
      .toEqual({ l: 25000, r: 25000, t: 25000, b: 25000 });
  });

  it('computes asymmetric crop fractions', () => {
    expect(subRectSrcRect({ x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 25, width: 100, height: 50 }))
      .toEqual({ l: 0, r: 0, t: 25000, b: 25000 });
  });
});

describe('decideMask', () => {
  const box = { x: 0, y: 0, width: 100, height: 100 };

  it('drops a mask with no intersection', () => {
    expect(decideMask({
      maskType: 'RECTANGLE',
      maskBox: { x: 0, y: 0, width: 10, height: 10 },
      contentBox: { x: 100, y: 100, width: 10, height: 10 },
      hasCornerRadii: false,
      hasCompoundVector: false,
    })).toEqual({ kind: 'drop' });
  });

  it('is a no-op when content is fully inside the mask', () => {
    expect(decideMask({
      maskType: 'RECTANGLE',
      maskBox: { x: 0, y: 0, width: 100, height: 100 },
      contentBox: { x: 10, y: 10, width: 20, height: 20 },
      hasCornerRadii: false,
      hasCompoundVector: false,
    })).toEqual({ kind: 'no-op' });
  });

  it('uses a native rect crop when a rect mask is fully covered by content', () => {
    expect(decideMask({
      maskType: 'RECTANGLE',
      maskBox: { x: 50, y: 50, width: 50, height: 50 },
      contentBox: { x: 0, y: 0, width: 100, height: 100 },
      hasCornerRadii: false,
      hasCompoundVector: false,
    })).toEqual({
      kind: 'picture-shape',
      shapeKind: 'rect',
      srcRect: { l: 50000, r: 0, t: 50000, b: 0 },
    });
  });

  it('maps a rounded-rect mask to a roundRect picture-shape', () => {
    expect(decideMask({
      maskType: 'RECTANGLE',
      maskBox: { x: 0, y: 0, width: 100, height: 100 },
      contentBox: { x: 0, y: 0, width: 100, height: 100 },
      hasCornerRadii: true,
      hasCompoundVector: false,
    })).toEqual({ kind: 'picture-shape', shapeKind: 'roundRect', srcRect: null });
  });

  it('maps ellipse/star/polygon masks to picture-shapes', () => {
    expect(decideMask({
      maskType: 'ELLIPSE',
      maskBox: box,
      contentBox: box,
      hasCornerRadii: false,
      hasCompoundVector: false,
    })).toEqual({ kind: 'picture-shape', shapeKind: 'ellipse', srcRect: null });

    expect(decideMask({
      maskType: 'STAR',
      maskBox: box,
      contentBox: box,
      hasCornerRadii: false,
      hasCompoundVector: false,
    })).toEqual({ kind: 'picture-shape', shapeKind: 'star', srcRect: null });

    expect(decideMask({
      maskType: 'POLYGON',
      maskBox: box,
      contentBox: box,
      hasCornerRadii: false,
      hasCompoundVector: false,
    })).toEqual({ kind: 'picture-shape', shapeKind: 'polygon', srcRect: null });
  });

  it('falls back to png for unsupported mask geometry', () => {
    expect(decideMask({
      maskType: 'VECTOR',
      maskBox: box,
      contentBox: box,
      hasCornerRadii: false,
      hasCompoundVector: false,
    })).toEqual({ kind: 'png' });
  });

  it('falls back to png when the mask extends beyond the content', () => {
    expect(decideMask({
      maskType: 'RECTANGLE',
      maskBox: { x: -10, y: 0, width: 100, height: 100 },
      contentBox: box,
      hasCornerRadii: false,
      hasCompoundVector: false,
    })).toEqual({ kind: 'png' });
  });

  it('falls back to png for a compound star/polygon vector mask', () => {
    expect(decideMask({
      maskType: 'STAR',
      maskBox: box,
      contentBox: box,
      hasCornerRadii: false,
      hasCompoundVector: true,
    })).toEqual({ kind: 'png' });
  });

  it('falls back to png for LUMINANCE masks (not geometric outline)', () => {
    expect(decideMask({
      maskType: 'RECTANGLE',
      maskBox: box,
      contentBox: box,
      hasCornerRadii: false,
      hasCompoundVector: false,
      figmaMaskType: 'LUMINANCE',
    })).toEqual({ kind: 'png' });
  });

  it('falls back to png when content has nested masks', () => {
    expect(decideMask({
      maskType: 'ELLIPSE',
      maskBox: box,
      contentBox: box,
      hasCornerRadii: false,
      hasCompoundVector: false,
      contentHasNestedMask: true,
    })).toEqual({ kind: 'png' });
  });

  it('falls back to png for multi-child / complex content under a mask', () => {
    expect(decideMask({
      maskType: 'ELLIPSE',
      maskBox: box,
      contentBox: box,
      hasCornerRadii: false,
      hasCompoundVector: false,
      contentCount: 3,
      contentHasComplexType: true,
    })).toEqual({ kind: 'png' });
  });
});

describe('chooseExportPlacement', () => {
  it('prefers the measured export box over the unclipped AABB union', () => {
    // Classic mask bug: union of mask+content AABBs is larger than the clipped PNG.
    const unclippedUnion = { x: 0, y: 0, width: 200, height: 200 };
    const clippedExport = { x: 40, y: 40, width: 80, height: 80 };
    expect(chooseExportPlacement(unclippedUnion, clippedExport)).toEqual(clippedExport);
  });

  it('falls back to the AABB union when export box is missing', () => {
    const unclippedUnion = { x: 10, y: 20, width: 30, height: 40 };
    expect(chooseExportPlacement(unclippedUnion, null)).toEqual(unclippedUnion);
  });

  it('returns null when neither box is usable', () => {
    expect(chooseExportPlacement(null, null)).toBeNull();
    expect(chooseExportPlacement(null, { x: 0, y: 0, width: 0, height: 10 })).toBeNull();
  });
});

describe('maskSegmentMustRasterize', () => {
  it('requires a local PNG for vector/boolean masks (logo / penguin silhouettes)', () => {
    expect(maskSegmentMustRasterize({ maskType: 'VECTOR', contentCount: 2 })).toBe(true);
    expect(maskSegmentMustRasterize({ maskType: 'BOOLEAN_OPERATION', contentCount: 1 })).toBe(true);
  });

  it('requires a local PNG for multi-child mask groups', () => {
    expect(maskSegmentMustRasterize({
      maskType: 'ELLIPSE',
      contentCount: 4,
      contentHasComplexType: true,
    })).toBe(true);
  });

  it('allows native clip for a simple geometric mask over a single simple content', () => {
    expect(maskSegmentMustRasterize({
      maskType: 'ELLIPSE',
      contentCount: 1,
      contentHasComplexType: false,
      contentHasNestedMask: false,
      figmaMaskType: 'ALPHA',
    })).toBe(false);
  });
});
