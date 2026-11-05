import { describe, it, expect } from 'vitest';
import { imagePlacementRect } from '../src/reader/image-placement';

describe('imagePlacementRect', () => {
  const frame = { x: 0, y: 0, width: 1920, height: 1080 };

  it('prefers render bounds over AABB (mask clip vs unclipped union)', () => {
    // Classic Mask Group bug: AABB is larger / different aspect than the clipped PNG.
    const aabb = { x: -40, y: 600, width: 520, height: 520 };
    const render = { x: 0, y: 700, width: 360, height: 380 };
    const placed = imagePlacementRect({ aabb, render, frame });
    expect(placed).toEqual({ x: 0, y: 700, width: 360, height: 380 });
  });

  it('keeps negative coords when the graphic hangs off the frame (no stretch-to-fit)', () => {
    // Clipping must be done by the slide edge — shrinking the box would deform the PNG.
    const aabb = { x: -80, y: 900, width: 400, height: 300 };
    const render = { x: -80, y: 900, width: 400, height: 300 };
    const placed = imagePlacementRect({ aabb, render, frame });
    expect(placed.x).toBe(-80);
    expect(placed.width).toBe(400);
    expect(placed.height).toBe(300);
  });

  it('falls back to AABB when render bounds are missing', () => {
    const aabb = { x: 10, y: 20, width: 100, height: 50 };
    expect(imagePlacementRect({ aabb, render: null, frame })).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
  });

  it('corrects placement aspect to match PNG pixel ratio when they diverge', () => {
    // Placement box 2:1 but PNG is 1:1 → keep area center, match PNG aspect.
    const box = { x: 0, y: 0, width: 200, height: 100 };
    const placed = imagePlacementRect({
      aabb: box,
      render: box,
      frame,
      pngWidthPx: 200,
      pngHeightPx: 200,
    });
    expect(placed.width).toBeCloseTo(placed.height);
    // Center of placement stays near center of original box
    expect(placed.x + placed.width / 2).toBeCloseTo(100);
    expect(placed.y + placed.height / 2).toBeCloseTo(50);
  });
});
