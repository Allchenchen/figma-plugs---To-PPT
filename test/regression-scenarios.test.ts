/**
 * Minimal scenario regressions derived from conversion-rules.md.
 * Each case encodes a design feature, not a page-specific node id.
 */
import { describe, it, expect } from 'vitest';
import { decideFallback } from '../src/reader/compat';
import {
  decideMask,
  maskSegmentMustRasterize,
  partitionChildren,
  chooseExportPlacement,
} from '../src/reader/mask';
import { shouldRasterizeForGroupOpacity } from '../src/reader/colors';
import { textBoxLayout, textRuns } from '../src/converter/text';
import { compositeColorOverBackground } from '../src/converter/colors';
import { imagePlacementRect } from '../src/reader/image-placement';

describe('scenario: Mask + image / vector cluster', () => {
  it('keeps mask+siblings as one masked segment (never demask)', () => {
    const segs = partitionChildren([
      { id: 'mask', isMask: true, type: 'VECTOR' },
      { id: 'img', type: 'RECTANGLE' },
      { id: 'vec', type: 'VECTOR' },
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0].kind).toBe('masked');
    expect(segs[0].nodes.map((n) => n.id)).toEqual(['mask', 'img', 'vec']);
  });

  it('forces PNG for vector mask over multi complex content', () => {
    expect(
      maskSegmentMustRasterize({
        maskType: 'VECTOR',
        contentCount: 2,
        contentHasComplexType: true,
      })
    ).toBe(true);
    expect(
      decideMask({
        maskType: 'VECTOR',
        maskBox: { x: 0, y: 0, width: 80, height: 80 },
        contentBox: { x: 0, y: 0, width: 80, height: 80 },
        hasCornerRadii: false,
        hasCompoundVector: false,
        contentCount: 2,
        contentHasComplexType: true,
      }).kind
    ).toBe('png');
  });

  it('container owning a mask is whole-group image in compat', () => {
    expect(
      decideFallback({
        type: 'GROUP',
        children: [
          { type: 'BOOLEAN_OPERATION', isMask: true },
          { type: 'RECTANGLE', fills: [{ type: 'SOLID', visible: true }] },
        ],
      }).reason
    ).toMatch(/mask group/);
  });
});

describe('scenario: Mask + nested Group', () => {
  it('detects nested mask via compat', () => {
    expect(
      decideFallback({
        type: 'GROUP',
        children: [
          {
            type: 'GROUP',
            children: [{ type: 'ELLIPSE', isMask: true }, { type: 'VECTOR' }],
          },
        ],
      }).strategy
    ).toBe('image');
  });
});

describe('scenario: Group + rotation / scale (rotation → PNG)', () => {
  it('rasterizes rotated native-looking rects', () => {
    expect(decideFallback({ type: 'RECTANGLE', rotation: 15 }).strategy).toBe('image');
  });
});

describe('scenario: Frame + Clip Content', () => {
  it('rasterizes when clipsContent + overflow and no TEXT', () => {
    expect(
      decideFallback({
        type: 'FRAME',
        clipsContent: true,
        childrenOverflow: true,
        children: [{ type: 'RECTANGLE' }, { type: 'ELLIPSE' }],
      }).reason
    ).toBe('clipsContent with overflow');
  });

  it('keeps editable text-bearing clip frames recursive', () => {
    expect(
      decideFallback({
        type: 'FRAME',
        clipsContent: true,
        childrenOverflow: true,
        children: [{ type: 'RECTANGLE' }, { type: 'TEXT' }],
      }).strategy
    ).toBe('native');
  });
});

describe('scenario: bordered card Frame + text + mask avatars (Research page)', () => {
  it('does not flatten the whole card when nested masks exist', () => {
    const d = decideFallback({
      type: 'FRAME',
      fills: [{ type: 'SOLID', visible: true }],
      strokes: [{ type: 'SOLID', visible: true }],
      children: [
        { type: 'TEXT' },
        {
          type: 'GROUP',
          children: [{ type: 'ELLIPSE', isMask: true }, { type: 'RECTANGLE' }],
        },
      ],
    });
    expect(d.strategy).toBe('native');
  });

  it('still flattens the avatar mask GROUP itself', () => {
    expect(
      decideFallback({
        type: 'GROUP',
        children: [{ type: 'ELLIPSE', isMask: true }, { type: 'RECTANGLE' }],
      }).reason
    ).toMatch(/mask group/);
  });

  it('FigDeck: ELLIPSE + IMAGE fill → PNG (circular clip via exportAsync)', () => {
    expect(
      decideFallback({
        type: 'ELLIPSE',
        fills: [{ type: 'IMAGE', visible: true }],
      }).strategy
    ).toBe('image');
  });

  it('FigDeck: GROUP with avatar ellipse + quote TEXT → recurse (not merge)', () => {
    expect(
      decideFallback({
        type: 'GROUP',
        children: [
          { type: 'ELLIPSE', fills: [{ type: 'IMAGE', visible: true }] },
          { type: 'TEXT' },
        ],
      }).strategy
    ).toBe('native');
  });
});

describe('scenario: text opacity + wrap geometry', () => {
  it('keeps white@80% as FFFFFF + 20% transparency (no grey bake)', () => {
    // Shape-fill helper still composites; text glyphs do not use it.
    expect(compositeColorOverBackground('#FFFFFF', 0.8, '#000000')).toBe('#CCCCCC');
    const runs = textRuns(
      {
        id: 't',
        type: 'text',
        rect: { x: 40, y: 100, width: 400, height: 80 },
        rotation: 0,
        opacity: 0.8,
        zIndex: 0,
        characters: 'body',
        fontSize: 16,
        fontFamily: 'Inter',
        fontWeight: 400,
        color: '#FFFFFF',
        letterSpacing: 0,
        lineHeight: null,
        textAlignHorizontal: 'LEFT',
        textAlignVertical: 'TOP',
      },
      '#000000'
    );
    expect(runs[0].options.color).toBe('FFFFFF');
    expect(runs[0].options.transparency).toBe(20);
  });

  it('keeps text box geometry exact (no width fudge)', () => {
    const rect = { x: 100, y: 200, width: 320, height: 48 };
    expect(textBoxLayout(rect, 'CENTER')).toEqual(rect);
    expect(textBoxLayout(rect, 'RIGHT')).toEqual(rect);
  });
});

describe('scenario: layered nesting + paint order placement', () => {
  it('prefers clipped export box over unclipped AABB union', () => {
    expect(
      chooseExportPlacement(
        { x: 0, y: 0, width: 200, height: 200 },
        { x: 40, y: 40, width: 80, height: 80 }
      )
    ).toEqual({ x: 40, y: 40, width: 80, height: 80 });
  });

  it('places PNG using render bounds when AABB is larger', () => {
    const placed = imagePlacementRect({
      aabb: { x: 0, y: 0, width: 200, height: 200 },
      render: { x: 50, y: 50, width: 100, height: 100 },
      frame: { width: 800, height: 600 },
      pngWidthPx: 200,
      pngHeightPx: 200,
    });
    expect(placed.width).toBeCloseTo(100);
    expect(placed.height).toBeCloseTo(100);
    expect(placed.x).toBeCloseTo(50);
  });
});

describe('scenario: semi-transparent multi-child group', () => {
  it('rasterizes instead of multiplying opacity onto each child', () => {
    expect(shouldRasterizeForGroupOpacity(0.7, 4)).toBe(true);
    expect(shouldRasterizeForGroupOpacity(0.7, 1)).toBe(false);
  });
});
