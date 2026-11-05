import { describe, it, expect } from 'vitest';
import {
  decideFallback,
  hasFrameChrome,
  subtreeHasText,
  subtreeIsIllustrationOnly,
  type NodeDesc,
} from '../src/reader/compat';
import { shapeRender } from '../src/converter/shape';
import type { IRShape } from '../src/ir/types';

describe('hasFrameChrome / layout frame decomposition', () => {
  it('detects solid fill or stroke as chrome', () => {
    expect(
      hasFrameChrome({
        type: 'FRAME',
        fills: [{ type: 'SOLID', visible: true }],
      })
    ).toBe(true);
    expect(
      hasFrameChrome({
        type: 'FRAME',
        strokes: [{ type: 'SOLID', visible: true }],
      })
    ).toBe(true);
    expect(hasFrameChrome({ type: 'FRAME', children: [{ type: 'TEXT' }] })).toBe(false);
    expect(hasFrameChrome({ type: 'GROUP', fills: [{ type: 'SOLID', visible: true }] })).toBe(false);
  });

  it('Research-card pattern: bordered frame + text + avatar mask group → native', () => {
    const card: NodeDesc = {
      type: 'FRAME',
      fills: [{ type: 'SOLID', visible: true }],
      strokes: [{ type: 'SOLID', visible: true }],
      children: [
        { type: 'TEXT' },
        {
          type: 'GROUP',
          children: [
            { type: 'ELLIPSE', isMask: true },
            { type: 'RECTANGLE', fills: [{ type: 'IMAGE', visible: true }] },
          ],
        },
        { type: 'GROUP', children: [{ type: 'VECTOR' }, { type: 'VECTOR' }] },
      ],
    };
    expect(subtreeHasText(card)).toBe(true);
    expect(decideFallback(card).strategy).toBe('native');
    // Avatar cluster still flattens as its own group:
    expect(decideFallback(card.children![1]).strategy).toBe('image');
  });

  it('illustration-only detection', () => {
    expect(
      subtreeIsIllustrationOnly({
        type: 'FRAME',
        children: [{ type: 'VECTOR' }, { type: 'STAR' }],
      })
    ).toBe(true);
    expect(
      subtreeIsIllustrationOnly({
        type: 'FRAME',
        children: [{ type: 'VECTOR' }, { type: 'TEXT' }],
      })
    ).toBe(false);
  });
});

describe('stroke-only chrome shape', () => {
  it('emits fill type none when fill is null', () => {
    const layer: IRShape = {
      id: 'chrome',
      type: 'shape',
      rect: { x: 100, y: 200, width: 800, height: 500 },
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      shapeKind: 'rect',
      fill: null,
      stroke: { color: '#FFFFFF', weight: 2 },
      cornerRadii: null,
    };
    const { options } = shapeRender(layer);
    expect(options.fill).toEqual({ type: 'none' });
    expect(options.line).toMatchObject({ color: 'FFFFFF', width: expect.any(Number) });
  });
});
