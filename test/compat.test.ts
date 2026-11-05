import { describe, it, expect } from 'vitest';
import {
  decideFallback,
  isContainerType,
  isNativeShapeType,
  nodeHasMask,
} from '../src/reader/compat';

describe('decideFallback', () => {
  it('keeps text native', () => {
    expect(decideFallback({ type: 'TEXT' }).strategy).toBe('native');
  });

  it('keeps plain rect/ellipse native', () => {
    expect(decideFallback({ type: 'RECTANGLE' }).strategy).toBe('native');
    expect(decideFallback({ type: 'ELLIPSE' }).strategy).toBe('native');
  });

  it('rasterizes vectors and boolean ops', () => {
    expect(decideFallback({ type: 'VECTOR' }).strategy).toBe('image');
    expect(decideFallback({ type: 'BOOLEAN_OPERATION' }).strategy).toBe('image');
  });

  it('rasterizes star/polygon', () => {
    expect(decideFallback({ type: 'STAR' }).strategy).toBe('image');
    expect(decideFallback({ type: 'POLYGON' }).strategy).toBe('image');
  });

  it('rasterizes a mask node reached directly', () => {
    expect(decideFallback({ type: 'RECTANGLE', isMask: true }).strategy).toBe('image');
  });

  it('rasterizes GROUPs that hold a mask', () => {
    expect(
      decideFallback({
        type: 'GROUP',
        children: [{ type: 'RECTANGLE', isMask: true }, { type: 'RECTANGLE' }],
      }).strategy
    ).toBe('image');
  });

  it('keeps layout FRAMEs with nested masks decomposable', () => {
    expect(
      decideFallback({
        type: 'FRAME',
        fills: [{ type: 'SOLID', visible: true }],
        strokes: [{ type: 'SOLID', visible: true }],
        children: [
          { type: 'TEXT' },
          { type: 'GROUP', children: [{ type: 'ELLIPSE', isMask: true }, { type: 'RECTANGLE' }] },
        ],
      }).strategy
    ).toBe('native');
  });

  it('FigDeck: multi-child GROUP with TEXT stays native (recurse, do not merge)', () => {
    expect(
      decideFallback({
        type: 'GROUP',
        children: [{ type: 'ELLIPSE' }, { type: 'TEXT' }],
      }).strategy
    ).toBe('native');
  });

  it('rasterizes illustration-only multi-child GROUP (no text)', () => {
    expect(
      decideFallback({
        type: 'GROUP',
        children: [{ type: 'VECTOR' }, { type: 'BOOLEAN_OPERATION' }, { type: 'POLYGON' }],
      }).reason
    ).toBe('illustration cluster (no text)');
  });

  it('rasterizes illustration-only multi-child FRAME', () => {
    expect(
      decideFallback({
        type: 'FRAME',
        children: [{ type: 'VECTOR' }, { type: 'BOOLEAN_OPERATION' }],
      }).reason
    ).toBe('illustration cluster (no text)');
  });

  it('keeps multi-child layout FRAME with text native', () => {
    expect(
      decideFallback({
        type: 'FRAME',
        fills: [{ type: 'SOLID', visible: true }],
        strokes: [{ type: 'SOLID', visible: true }],
        children: [{ type: 'TEXT' }, { type: 'TEXT' }, { type: 'RECTANGLE' }],
      }).strategy
    ).toBe('native');
  });

  it('rasterizes ELLIPSE with image fill (circular avatar → PNG like FigDeck)', () => {
    expect(
      decideFallback({
        type: 'ELLIPSE',
        fills: [{ type: 'IMAGE', visible: true }],
      }).reason
    ).toBe('image/gradient/complex fill');
  });

  it('rasterizes rotated nodes', () => {
    expect(decideFallback({ type: 'RECTANGLE', rotation: 45 }).strategy).toBe('image');
  });

  it('rasterizes image/gradient fills on rect', () => {
    expect(
      decideFallback({ type: 'RECTANGLE', fills: [{ type: 'IMAGE', visible: true }] }).strategy
    ).toBe('image');
  });

  it('rasterizes multiple fills', () => {
    expect(
      decideFallback({
        type: 'RECTANGLE',
        fills: [
          { type: 'SOLID', visible: true },
          { type: 'SOLID', visible: true },
        ],
      }).strategy
    ).toBe('image');
  });

  it('rasterizes non-default blend modes', () => {
    expect(decideFallback({ type: 'RECTANGLE', blendMode: 'MULTIPLY' }).strategy).toBe('image');
  });

  it('keeps single-child containers native', () => {
    expect(decideFallback({ type: 'GROUP', children: [{ type: 'RECTANGLE' }] }).strategy).toBe(
      'native'
    );
  });

  it('rasterizes effects', () => {
    expect(decideFallback({ type: 'RECTANGLE', hasEffects: true }).strategy).toBe('image');
  });

  it('keeps Auto Layout / FRAME with TEXT native despite effects', () => {
    expect(
      decideFallback({
        type: 'FRAME',
        hasEffects: true,
        children: [
          { type: 'ELLIPSE', fills: [{ type: 'IMAGE', visible: true }] },
          { type: 'TEXT' },
        ],
      }).strategy
    ).toBe('native');
  });

  it('keeps GROUP with mask + TEXT native (recurse; peel text later)', () => {
    expect(
      decideFallback({
        type: 'GROUP',
        children: [
          { type: 'ELLIPSE', isMask: true },
          { type: 'RECTANGLE', fills: [{ type: 'IMAGE', visible: true }] },
          { type: 'TEXT' },
        ],
      }).strategy
    ).toBe('native');
  });

  it('rasterizes mask GROUP without TEXT', () => {
    expect(
      decideFallback({
        type: 'GROUP',
        children: [
          { type: 'ELLIPSE', isMask: true },
          { type: 'RECTANGLE', fills: [{ type: 'IMAGE', visible: true }] },
        ],
      }).reason
    ).toBe('mask group (local PNG, intact)');
  });

  it('keeps text-bearing FRAME with clipsContent+overflow native in editable', () => {
    expect(
      decideFallback({
        type: 'FRAME',
        clipsContent: true,
        childrenOverflow: true,
        children: [{ type: 'TEXT' }],
      }).strategy
    ).toBe('native');
  });

  it('rasterizes text-bearing FRAME with clipsContent+overflow in fidelity', () => {
    expect(
      decideFallback(
        {
          type: 'FRAME',
          clipsContent: true,
          childrenOverflow: true,
          children: [{ type: 'TEXT' }],
        },
        'fidelity'
      ).reason
    ).toBe('clipsContent with overflow');
  });

  it('rasterizes strokes on non-native shapes', () => {
    expect(
      decideFallback({ type: 'VECTOR', strokes: [{ type: 'SOLID', visible: true }] }).strategy
    ).toBe('image');
  });

  it('keeps strokes native on rect/ellipse', () => {
    expect(
      decideFallback({ type: 'RECTANGLE', strokes: [{ type: 'SOLID', visible: true }] }).strategy
    ).toBe('native');
  });

  it('allows stroke on layout FRAME', () => {
    expect(
      decideFallback({
        type: 'FRAME',
        strokes: [{ type: 'SOLID', visible: true }],
        children: [{ type: 'TEXT' }],
      }).strategy
    ).toBe('native');
  });
});

describe('nodeHasMask', () => {
  it('detects masks on the node or any descendant', () => {
    expect(nodeHasMask({ type: 'RECTANGLE', isMask: true })).toBe(true);
    expect(nodeHasMask({ type: 'GROUP', children: [{ type: 'ELLIPSE' }] })).toBe(false);
    expect(
      nodeHasMask({
        type: 'GROUP',
        children: [{ type: 'GROUP', children: [{ type: 'VECTOR', isMask: true }] }],
      })
    ).toBe(true);
  });
});

describe('type helpers', () => {
  it('identifies container types', () => {
    expect(isContainerType('FRAME')).toBe(true);
    expect(isContainerType('GROUP')).toBe(true);
    expect(isContainerType('RECTANGLE')).toBe(false);
  });

  it('identifies native shape types', () => {
    expect(isNativeShapeType('RECTANGLE')).toBe(true);
    expect(isNativeShapeType('ELLIPSE')).toBe(true);
    expect(isNativeShapeType('STAR')).toBe(false);
  });
});
