import { describe, it, expect } from 'vitest';
import { textBoxLayout } from '../src/converter/text';
import type { Rect } from '../src/ir/types';

const box: Rect = { x: 100, y: 50, width: 200, height: 80 };

describe('textBoxLayout', () => {
  it('default scale keeps Figma box exact (no anti-wrap fudge)', () => {
    // Insight body: x=972 y=568 w=748 h=80 must not be widened.
    const figmaBox = { x: 972, y: 568, width: 748, height: 80 };
    expect(textBoxLayout(figmaBox, 'LEFT')).toEqual(figmaBox);
  });

  it('keeps left-aligned origin and only widens to the right when scaled', () => {
    const layout = textBoxLayout(box, 'LEFT', 1.08);
    expect(layout.x).toBe(100);
    expect(layout.y).toBe(50);
    expect(layout.width).toBeCloseTo(216);
    expect(layout.height).toBe(80);
  });

  it('expands width symmetrically for CENTER so the visual center stays put', () => {
    const layout = textBoxLayout(box, 'CENTER', 1.08);
    // Extra 16px → 8px each side → x moves left by 8
    expect(layout.x).toBeCloseTo(92);
    expect(layout.width).toBeCloseTo(216);
    expect(layout.x + layout.width / 2).toBeCloseTo(100 + 100); // center of original
  });

  it('expands width to the left for RIGHT so the right edge stays put', () => {
    const layout = textBoxLayout(box, 'RIGHT', 1.08);
    expect(layout.x + layout.width).toBeCloseTo(300);
    expect(layout.width).toBeCloseTo(216);
  });

  it('does not invent a fixed vertical offset', () => {
    const layout = textBoxLayout(box, 'LEFT', 1.08);
    expect(layout.y).toBe(box.y);
  });

  it('scale=1 is identity', () => {
    expect(textBoxLayout(box, 'CENTER', 1)).toEqual(box);
  });
});
