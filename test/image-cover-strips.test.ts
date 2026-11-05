import { describe, it, expect } from 'vitest';
import {
  dropImageEdgeCoverShapes,
  isBottomEdgeStrip,
  isTopEdgeStrip,
} from '../src/ir/image-cover-strips';
import type { IRElement, IRImage, IRShape } from '../src/ir/types';

function img(partial: Partial<IRImage> & Pick<IRImage, 'id' | 'rect' | 'zIndex'>): IRImage {
  return {
    type: 'image',
    rotation: 0,
    opacity: 1,
    data: '',
    mimeType: 'image/png',
    ...partial,
  };
}

function shape(partial: Partial<IRShape> & Pick<IRShape, 'id' | 'rect' | 'zIndex' | 'fill'>): IRShape {
  return {
    type: 'shape',
    shapeKind: 'rect',
    rotation: 0,
    opacity: 1,
    stroke: null,
    cornerRadii: null,
    ...partial,
  };
}

describe('isBottomEdgeStrip / isTopEdgeStrip', () => {
  const image = { x: 1454, y: 61, width: 230, height: 958 };

  it('detects the slide6 phone-footer cover strip', () => {
    expect(isBottomEdgeStrip({ x: 1454, y: 998, width: 230, height: 21 }, image)).toBe(true);
  });

  it('rejects a center badge (not flush to an edge)', () => {
    expect(isBottomEdgeStrip({ x: 1500, y: 400, width: 40, height: 20 }, image)).toBe(false);
  });

  it('rejects a tall overlay (>5% of image height)', () => {
    expect(isBottomEdgeStrip({ x: 1454, y: 800, width: 230, height: 219 }, image)).toBe(false);
  });

  it('detects a top edge strip', () => {
    expect(isTopEdgeStrip({ x: 1454, y: 61, width: 230, height: 20 }, image)).toBe(true);
  });
});

describe('dropImageEdgeCoverShapes', () => {
  it('removes a solid footer strip painted above a screenshot', () => {
    const screenshot = img({
      id: '58:542',
      rect: { x: 1454, y: 61, width: 230, height: 958 },
      zIndex: 3,
    });
    const footerChrome = shape({
      id: 'footer:chrome',
      rect: { x: 1454, y: 998, width: 230, height: 21 },
      zIndex: 19,
      fill: '#322A2B',
    });
    const kept = dropImageEdgeCoverShapes([screenshot, footerChrome]);
    expect(kept.map((e) => e.id)).toEqual(['58:542']);
  });

  it('keeps a strip that is behind the image (lower zIndex)', () => {
    const screenshot = img({
      id: 'img',
      rect: { x: 0, y: 0, width: 200, height: 800 },
      zIndex: 5,
    });
    const behind = shape({
      id: 'behind',
      rect: { x: 0, y: 780, width: 200, height: 20 },
      zIndex: 2,
      fill: '#000000',
    });
    const kept = dropImageEdgeCoverShapes([behind, screenshot]);
    expect(kept.map((e) => e.id)).toEqual(['behind', 'img']);
  });

  it('keeps bordered or rounded chrome', () => {
    const screenshot = img({
      id: 'img',
      rect: { x: 0, y: 0, width: 200, height: 800 },
      zIndex: 1,
    });
    const stroked = shape({
      id: 'stroked',
      rect: { x: 0, y: 780, width: 200, height: 20 },
      zIndex: 2,
      fill: '#322A2B',
      stroke: { color: '#FFFFFF', weight: 1 },
    });
    const rounded = shape({
      id: 'rounded',
      rect: { x: 0, y: 780, width: 200, height: 20 },
      zIndex: 3,
      fill: '#322A2B',
      cornerRadii: { tl: 4, tr: 4, br: 4, bl: 4 },
    });
    const kept = dropImageEdgeCoverShapes([screenshot, stroked, rounded]);
    expect(kept.map((e) => e.id)).toEqual(['img', 'stroked', 'rounded']);
  });

  it('does not drop unrelated shapes or notebook images', () => {
    const notebook = img({
      id: 'notebook',
      rect: { x: 0, y: 155, width: 1259, height: 770 },
      zIndex: 1,
    });
    const card = shape({
      id: 'card',
      rect: { x: 100, y: 200, width: 400, height: 300 },
      zIndex: 2,
      fill: '#290E0F',
    });
    const elements: IRElement[] = [notebook, card];
    expect(dropImageEdgeCoverShapes(elements).map((e) => e.id)).toEqual(['notebook', 'card']);
  });
});
