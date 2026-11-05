import { describe, it, expect } from 'vitest';
import { shapeRender } from '../src/converter/shape';
import { paintOpacity, solidColorAlpha, topSolidFill } from '../src/reader/colors';
import type { IRShape } from '../src/ir/types';

describe('stroke-only shapes must not invent gray fill', () => {
  it('emits fill type none when fill is null (Research border/divider case)', () => {
    const layer: IRShape = {
      id: 'border',
      type: 'shape',
      rect: { x: 100, y: 100, width: 1200, height: 700 },
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      shapeKind: 'rect',
      fill: null,
      stroke: { color: '#FFFFFF', weight: 1 },
      cornerRadii: null,
    };
    const { options } = shapeRender(layer, '#000000');
    expect(options.fill).toEqual({ type: 'none' });
    expect(JSON.stringify(options)).not.toMatch(/CCCCCC/i);
  });

  it('never uses a gray placeholder for missing solid fill in paint helpers', () => {
    expect(topSolidFill([])).toBeUndefined();
    expect(
      topSolidFill([{ type: 'SOLID', visible: false, color: { r: 0, g: 0, b: 0 } }] as Paint[])
    ).toBeUndefined();
  });
});

describe('solid color.a × paint.opacity', () => {
  it('multiplies color.a into effective paint opacity', () => {
    const paint = {
      type: 'SOLID',
      visible: true,
      opacity: 1,
      color: { r: 0, g: 0, b: 0, a: 0.5 },
    } as SolidPaint;
    expect(solidColorAlpha(paint)).toBe(0.5);
    expect(paintOpacity(paint)).toBeCloseTo(0.5);
    expect(topSolidFill([paint])?.opacity).toBeCloseTo(0.5);
  });

  it('combines paint.opacity with color.a', () => {
    const paint = {
      type: 'SOLID',
      visible: true,
      opacity: 0.5,
      color: { r: 0, g: 0, b: 0, a: 0.5 },
    } as SolidPaint;
    expect(paintOpacity(paint)).toBeCloseTo(0.25);
  });
});

describe('translucent black fill on black slide', () => {
  it('bakes to near-black instead of medium gray via white compositing', () => {
    const layer: IRShape = {
      id: 'card',
      type: 'shape',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      rotation: 0,
      opacity: 0.5,
      zIndex: 0,
      shapeKind: 'rect',
      fill: '#000000',
      stroke: null,
      cornerRadii: null,
    };
    const onBlack = shapeRender(layer, '#000000');
    expect(onBlack.options.fill).toEqual({ color: '000000' });
    // Against white (wrong backdrop) would be #808080 — ensure we do not do that
    // when the slide is black.
    const onWhite = shapeRender(layer, '#FFFFFF');
    expect((onWhite.options.fill as { color: string }).color).toBe('808080');
  });
});
