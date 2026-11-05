import { describe, it, expect } from 'vitest';
import { polygonVertices, starVertices } from '../src/converter/polygon';

describe('polygonVertices', () => {
  it('produces N vertices', () => {
    expect(polygonVertices(100, 100, 5)).toHaveLength(5);
    expect(polygonVertices(100, 100, 3)).toHaveLength(3);
  });

  it('centers vertices and points the first vertex up', () => {
    const v = polygonVertices(100, 100, 4);
    expect(v[0].x).toBeCloseTo(50);
    expect(v[0].y).toBeCloseTo(0);
    expect(v[1].x).toBeCloseTo(100);
    expect(v[1].y).toBeCloseTo(50);
  });

  it('uses min(w,h) so non-square boxes stay centered', () => {
    const v = polygonVertices(200, 100, 4);
    const ys = v.map((p) => p.y);
    expect(Math.min(...ys)).toBeCloseTo(0);
    expect(Math.max(...ys)).toBeCloseTo(100);
  });
});

describe('starVertices', () => {
  it('produces 2N vertices (outer + inner)', () => {
    expect(starVertices(100, 100, 5, 0.5)).toHaveLength(10);
  });

  it('places the first outer point up and inner point on the inner radius', () => {
    const v = starVertices(100, 100, 5, 0.5);
    expect(v[0].x).toBeCloseTo(50);
    expect(v[0].y).toBeCloseTo(0);
    // inner radius = outer radius (50) * 0.5 = 25
    const innerR = Math.hypot(v[1].x - 50, v[1].y - 50);
    expect(innerR).toBeCloseTo(25);
  });

  it('clamps innerRadius into 0..1', () => {
    const v = starVertices(100, 100, 5, 2);
    const innerR = Math.hypot(v[1].x - 50, v[1].y - 50);
    expect(innerR).toBeCloseTo(50); // clamped to 1 → equals outer radius
  });
});
