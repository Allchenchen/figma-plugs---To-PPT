import { describe, it, expect } from 'vitest';
import {
  dropOccludedCoLocatedImages,
  samePlacementRect,
} from '../src/ir/image-occlusion';
import { dropImageEdgeCoverShapes } from '../src/ir/image-cover-strips';
import type { IRElement, IRImage, IRShape } from '../src/ir/types';

function img(partial: Partial<IRImage> & Pick<IRImage, 'id' | 'rect' | 'zIndex'>): IRImage {
  return {
    type: 'image',
    rotation: 0,
    opacity: 1,
    data: `data-${partial.id}`,
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

describe('samePlacementRect', () => {
  it('matches the slide6 phone long-image box', () => {
    const a = { x: 1454, y: 61, width: 230, height: 958 };
    const b = { x: 1454, y: 61, width: 230, height: 958 };
    expect(samePlacementRect(a, b)).toBe(true);
  });

  it('rejects notebook chassis vs screen (different boxes)', () => {
    expect(
      samePlacementRect(
        { x: -143, y: 155, width: 1259, height: 770 },
        { x: 0, y: 178.63, width: 986.04, height: 649.81 }
      )
    ).toBe(false);
  });
});

describe('dropOccludedCoLocatedImages', () => {
  it('keeps only the top opaque image when two share one placement', () => {
    const under = img({
      id: '58:541',
      rect: { x: 1454, y: 61, width: 230, height: 958 },
      zIndex: 5,
      mimeType: 'image/jpeg',
      sizing: { mode: 'cover', srcRect: { l: 0, r: 0, t: 19, b: 19 } },
    });
    const over = img({
      id: '58:542',
      rect: { x: 1454, y: 61, width: 230, height: 958 },
      zIndex: 6,
      mimeType: 'image/png',
      sizing: { mode: 'cover', srcRect: { l: 0, r: 0, t: 19, b: 19 } },
    });
    const kept = dropOccludedCoLocatedImages([under, over]);
    expect(kept.map((e) => e.id)).toEqual(['58:542']);
  });

  it('does not drop a child when only the parent background was emitted (different rect)', () => {
    const parentBg = img({
      id: 'parent-bg',
      rect: { x: 0, y: 0, width: 400, height: 300 },
      zIndex: 1,
    });
    const child = img({
      id: 'child',
      rect: { x: 40, y: 40, width: 120, height: 80 },
      zIndex: 2,
    });
    expect(dropOccludedCoLocatedImages([parentBg, child]).map((e) => e.id)).toEqual([
      'parent-bg',
      'child',
    ]);
  });

  it('keeps the same asset used at two different placements', () => {
    const a = img({
      id: 'left',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      zIndex: 1,
      data: 'same-bytes',
    });
    const b = img({
      id: 'right',
      rect: { x: 200, y: 0, width: 100, height: 100 },
      zIndex: 2,
      data: 'same-bytes',
    });
    expect(dropOccludedCoLocatedImages([a, b]).map((e) => e.id)).toEqual(['left', 'right']);
  });

  it('does not share crop params across instances (independent IR objects kept)', () => {
    const a = img({
      id: 'crop-a',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      zIndex: 1,
      sizing: { mode: 'crop', srcRect: { l: 10000, r: 0, t: 0, b: 0 } },
    });
    const b = img({
      id: 'crop-b',
      rect: { x: 150, y: 0, width: 100, height: 100 },
      zIndex: 2,
      sizing: { mode: 'crop', srcRect: { l: 0, r: 10000, t: 0, b: 0 } },
    });
    const kept = dropOccludedCoLocatedImages([a, b]) as IRImage[];
    expect(kept).toHaveLength(2);
    expect(kept[0].sizing).toEqual(a.sizing);
    expect(kept[1].sizing).toEqual(b.sizing);
  });

  it('keeps a translucent overlay on the same box', () => {
    const under = img({
      id: 'photo',
      rect: { x: 0, y: 0, width: 200, height: 200 },
      zIndex: 1,
    });
    const wash = img({
      id: 'wash',
      rect: { x: 0, y: 0, width: 200, height: 200 },
      zIndex: 2,
      opacity: 0.4,
    });
    expect(dropOccludedCoLocatedImages([under, wash]).map((e) => e.id)).toEqual([
      'photo',
      'wash',
    ]);
  });

  it('is idempotent when run twice (no cumulative drop beyond the cover)', () => {
    const under = img({
      id: '58:541',
      rect: { x: 1454, y: 61, width: 230, height: 958 },
      zIndex: 5,
    });
    const over = img({
      id: '58:542',
      rect: { x: 1454, y: 61, width: 230, height: 958 },
      zIndex: 6,
    });
    const once = dropOccludedCoLocatedImages([under, over]);
    const twice = dropOccludedCoLocatedImages(once);
    expect(twice.map((e) => e.id)).toEqual(['58:542']);
  });

  it('keeps notebook chassis + screen (non-colocated) and unrelated shapes', () => {
    const chassis = img({
      id: '58:536',
      rect: { x: -143, y: 155, width: 1259, height: 770 },
      zIndex: 1,
    });
    const screen = img({
      id: 'screen',
      rect: { x: 0, y: 178.63, width: 986.04, height: 649.81 },
      zIndex: 2,
    });
    const card = shape({
      id: 'card',
      rect: { x: 100, y: 200, width: 400, height: 300 },
      zIndex: 3,
      fill: '#290E0F',
    });
    const elements: IRElement[] = [chassis, screen, card];
    expect(dropOccludedCoLocatedImages(elements).map((e) => e.id)).toEqual([
      '58:536',
      'screen',
      'card',
    ]);
  });

  it('simulates parent whole-raster covering a colocated child bitmap', () => {
    // Whole-container PNG and a child native fill that landed on the same box
    // (failure mode: container raster + still emitting the child).
    const container = img({
      id: 'container-png',
      rect: { x: 10, y: 10, width: 300, height: 500 },
      zIndex: 4,
    });
    const child = img({
      id: 'child-fill',
      rect: { x: 10, y: 10, width: 300, height: 500 },
      zIndex: 3,
    });
    expect(dropOccludedCoLocatedImages([child, container]).map((e) => e.id)).toEqual([
      'container-png',
    ]);
  });

  it('readSlide pipeline: footer strip drop then co-located image occlusion', () => {
    const under = img({
      id: '58:541',
      rect: { x: 1454, y: 61, width: 230, height: 958 },
      zIndex: 5,
      mimeType: 'image/jpeg',
    });
    const over = img({
      id: '58:542',
      rect: { x: 1454, y: 61, width: 230, height: 958 },
      zIndex: 6,
      mimeType: 'image/png',
    });
    const footerChrome = shape({
      id: 'footer:chrome',
      rect: { x: 1454, y: 998, width: 230, height: 21 },
      zIndex: 19,
      fill: '#322A2B',
    });
    const kept = dropOccludedCoLocatedImages(
      dropImageEdgeCoverShapes([under, over, footerChrome])
    );
    expect(kept.map((e) => e.id)).toEqual(['58:542']);
  });
});
