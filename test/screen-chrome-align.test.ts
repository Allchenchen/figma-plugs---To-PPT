import { describe, it, expect } from 'vitest';
import { alignScreenRasterToChrome } from '../src/ir/screen-chrome-align';
import type { IRImage, IRShape } from '../src/ir/types';

function photo(partial: Partial<IRImage> & Pick<IRImage, 'id' | 'rect' | 'zIndex'>): IRImage {
  return {
    type: 'image',
    rotation: 0,
    opacity: 1,
    data: 'chassis',
    mimeType: 'image/png',
    sizing: { mode: 'cover', srcRect: { l: 31, r: 31, t: 0, b: 0 } },
    ...partial,
  };
}

function raster(partial: Partial<IRImage> & Pick<IRImage, 'id' | 'rect' | 'zIndex'>): IRImage {
  return {
    type: 'image',
    rotation: 0,
    opacity: 1,
    data: 'screen',
    mimeType: 'image/png',
    ...partial,
  };
}

function chrome(partial: Partial<IRShape> & Pick<IRShape, 'id' | 'rect' | 'zIndex' | 'fill'>): IRShape {
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

describe('alignScreenRasterToChrome', () => {
  it('expands inset slide6-style screen raster to browser chrome width', () => {
    const chassis = photo({
      id: '58:536',
      rect: { x: -143, y: 155, width: 1259, height: 770 },
      zIndex: 1,
    });
    const screen = raster({
      id: 'screen',
      rect: { x: 0, y: 178.63, width: 986.04, height: 649.81 },
      zIndex: 2,
    });
    const bar = chrome({
      id: 'chrome',
      rect: { x: -14, y: 178.1, width: 1001, height: 32.9 },
      zIndex: 3,
      fill: '#290E0F',
    });
    const bar2 = chrome({
      id: 'chrome2',
      rect: { x: -12, y: 210.9, width: 1001, height: 28.9 },
      zIndex: 4,
      fill: '#431A1C',
    });

    const kept = alignScreenRasterToChrome([chassis, screen, bar, bar2]);
    const out = kept.find((e) => e.id === 'screen') as IRImage;
    expect(out.rect.x).toBe(-14);
    expect(out.rect.width).toBe(1003); // -14 .. 989
    expect(out.rect.y).toBe(178.63);
    expect(out.rect.height).toBe(649.81);
    // Chassis unchanged.
    expect(kept.find((e) => e.id === '58:536')).toEqual(chassis);
  });

  it('does not move a full-bleed screen already matching chrome', () => {
    const chassis = photo({
      id: 'chassis',
      rect: { x: 0, y: 0, width: 1200, height: 800 },
      zIndex: 1,
    });
    const screen = raster({
      id: 'screen',
      rect: { x: 100, y: 40, width: 1000, height: 600 },
      zIndex: 2,
    });
    const bar = chrome({
      id: 'chrome',
      rect: { x: 100, y: 40, width: 1000, height: 28 },
      zIndex: 3,
      fill: '#111111',
    });
    const kept = alignScreenRasterToChrome([chassis, screen, bar]);
    expect(kept.find((e) => e.id === 'screen')).toEqual(screen);
  });

  it('keeps two placements of the same asset when only one is inset', () => {
    const chassis = photo({
      id: 'chassis',
      rect: { x: 0, y: 0, width: 800, height: 500 },
      zIndex: 1,
    });
    const a = raster({
      id: 'a',
      rect: { x: 40, y: 40, width: 700, height: 400 },
      zIndex: 2,
      data: 'same',
    });
    const b = raster({
      id: 'b',
      rect: { x: 900, y: 40, width: 200, height: 400 },
      zIndex: 3,
      data: 'same',
    });
    const bar = chrome({
      id: 'chrome',
      rect: { x: 30, y: 40, width: 720, height: 24 },
      zIndex: 4,
      fill: '#000000',
    });
    const kept = alignScreenRasterToChrome([chassis, a, b, bar]);
    expect((kept.find((e) => e.id === 'a') as IRImage).rect.width).toBe(720);
    expect(kept.find((e) => e.id === 'b')).toEqual(b);
  });

  it('does not align a lone image without device photo + chrome', () => {
    const screen = raster({
      id: 'phone',
      rect: { x: 1454, y: 61, width: 230, height: 958 },
      zIndex: 1,
    });
    expect(alignScreenRasterToChrome([screen])).toEqual([screen]);
  });

  it('does not stretch page content into a large intentional chrome overhang', () => {
    const chassis = photo({
      id: '58:581',
      rect: { x: 489.9, y: 163, width: 1715.2, height: 1049 },
      zIndex: 1,
    });
    const screen = raster({
      id: 'screen',
      rect: { x: 667, y: 195.2, width: 1253, height: 884.8 },
      zIndex: 2,
    });
    const bar = chrome({
      id: 'chrome',
      rect: { x: 665.7, y: 194.5, width: 1363.7, height: 44.8 },
      zIndex: 3,
      fill: '#060304',
    });
    const kept = alignScreenRasterToChrome([chassis, screen, bar]);
    expect(kept.find((e) => e.id === 'screen')).toEqual(screen);
  });
});
