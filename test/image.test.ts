import { describe, it, expect } from 'vitest';
import {
  detectMime,
  pngPixelSize,
  imageFillMode,
  hasImageFilters,
  coverSrcRect,
  containFit,
  cropSrcRect,
  tileScale,
} from '../src/reader/image';

describe('detectMime', () => {
  it('detects PNG', () => {
    expect(detectMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
  });

  it('detects JPEG', () => {
    expect(detectMime(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
  });

  it('detects GIF', () => {
    expect(detectMime(new Uint8Array([0x47, 0x49, 0x46]))).toBe('image/gif');
  });

  it('returns null for unknown bytes', () => {
    expect(detectMime(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});

describe('pngPixelSize', () => {
  it('reads IHDR width/height from a 1×1 PNG', () => {
    // Minimal valid 1×1 PNG (base64)
    const b64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
    const bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
    expect(pngPixelSize(bytes)).toEqual({ width: 1, height: 1 });
  });

  it('returns null for non-PNG', () => {
    expect(pngPixelSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
  });
});

describe('imageFillMode', () => {
  it('maps FILL → cover and FIT → contain', () => {
    expect(imageFillMode({ scaleMode: 'FILL' })).toBe('cover');
    expect(imageFillMode({ scaleMode: 'FIT' })).toBe('contain');
  });

  it('maps CROP/TILE (rasterized upstream, kept here for reporting)', () => {
    expect(imageFillMode({ scaleMode: 'CROP' })).toBe('crop');
    expect(imageFillMode({ scaleMode: 'TILE' })).toBe('tile');
  });

  it('rejects non-zero image filters', () => {
    expect(imageFillMode({ scaleMode: 'FILL', filters: { exposure: 0.1 } })).toBeNull();
  });

  it('rejects a rotation cover/contain cannot express', () => {
    expect(imageFillMode({ scaleMode: 'FILL', rotation: 90 })).toBeNull();
  });

  it('accepts zero filters and zero rotation', () => {
    expect(imageFillMode({ scaleMode: 'FILL', rotation: 0, filters: { exposure: 0 } })).toBe('cover');
  });
});

describe('hasImageFilters', () => {
  it('false for undefined or all-zero, true for any non-zero', () => {
    expect(hasImageFilters(undefined)).toBe(false);
    expect(hasImageFilters({ exposure: 0, contrast: 0 })).toBe(false);
    expect(hasImageFilters({ saturation: 0.2 })).toBe(true);
  });
});

describe('coverSrcRect', () => {
  it('square image in square box → no crop', () => {
    expect(coverSrcRect({ width: 100, height: 100 }, 100, 100)).toEqual({
      l: 0,
      r: 0,
      t: 0,
      b: 0,
    });
  });

  it('portrait image in square box → crop top/bottom', () => {
    expect(coverSrcRect({ width: 100, height: 200 }, 100, 100)).toEqual({
      l: 0,
      r: 0,
      t: 25000,
      b: 25000,
    });
  });

  it('landscape image in square box → crop left/right', () => {
    expect(coverSrcRect({ width: 200, height: 100 }, 100, 100)).toEqual({
      l: 25000,
      r: 25000,
      t: 0,
      b: 0,
    });
  });
});

describe('containFit', () => {
  it('fits a landscape image letterboxed', () => {
    expect(containFit({ width: 200, height: 100 }, 100, 100)).toEqual({ w: 100, h: 50 });
  });

  it('fits a portrait image letterboxed', () => {
    expect(containFit({ width: 100, height: 200 }, 100, 100)).toEqual({ w: 50, h: 100 });
  });
});

describe('cropSrcRect', () => {
  it('identity transform shows the whole image (unit space)', () => {
    const t = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };
    expect(cropSrcRect({ width: 100, height: 100 }, 100, 100, t)).toEqual({
      l: 0,
      r: 0,
      t: 0,
      b: 0,
    });
  });

  it('does not treat identity as a top-left pixel crop on tall screenshots', () => {
    // Regression: 1920×3384 form JPEG in a 369×615 phone frame with identity
    // CROP must show the full page, not the logo corner (old px math → ~3.7% area).
    const t = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };
    expect(cropSrcRect({ width: 1920, height: 3384 }, 369, 615, t)).toEqual({
      l: 0,
      r: 0,
      t: 0,
      b: 0,
    });
  });

  it('maps a unit-space crop window to srcRect fractions', () => {
    // Container→image: ix = 0.5*nx + 0.125 → image unit [0.125, 0.625]
    // (= pixels 25..125 on a 200×200 source).
    const t = { a: 0.5, b: 0, c: 0.125, d: 0, e: 0.5, f: 0.125 };
    expect(cropSrcRect({ width: 200, height: 200 }, 100, 100, t)).toEqual({
      l: 12500,
      r: 37500,
      t: 12500,
      b: 37500,
    });
  });

  it('returns null for shear/rotation transforms', () => {
    expect(cropSrcRect({ width: 100, height: 100 }, 100, 100, { a: 1, b: 0.5, c: 0, d: 0, e: 1, f: 0 })).toBeNull();
  });

  it('returns null when the crop reveals empty space', () => {
    // ix = nx + 0.5 → image unit [0.5, 1.5] overhangs the right edge.
    expect(cropSrcRect({ width: 100, height: 100 }, 100, 100, { a: 1, b: 0, c: 0.5, d: 0, e: 1, f: 0 })).toBeNull();
  });
});

describe('tileScale', () => {
  it('maps scalingFactor 1 to 100%', () => {
    expect(tileScale(1)).toEqual({ scaleX: 100000, scaleY: 100000 });
  });

  it('maps a fractional scalingFactor to 1000ths of a percent', () => {
    expect(tileScale(0.5)).toEqual({ scaleX: 50000, scaleY: 50000 });
    expect(tileScale(0.25)).toEqual({ scaleX: 25000, scaleY: 25000 });
  });

  it('defaults to 1 when scalingFactor is absent', () => {
    expect(tileScale(undefined)).toEqual({ scaleX: 100000, scaleY: 100000 });
  });

  it('returns null for upscaled or non-positive tiles (not natively expressible)', () => {
    expect(tileScale(1.5)).toBeNull();
    expect(tileScale(0)).toBeNull();
    expect(tileScale(-0.5)).toBeNull();
  });

  it('clamps a tiny positive factor to at least 1 (0.001%)', () => {
    expect(tileScale(0.000001)).toEqual({ scaleX: 1, scaleY: 1 });
  });
});
