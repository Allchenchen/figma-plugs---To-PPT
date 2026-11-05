import { describe, it, expect } from 'vitest';
import { rgbToHex, topSolidFillColor } from '../src/reader/colors';
import { stripHash, opacityToTransparency, compositeColorOverBackground } from '../src/converter/colors';

describe('reader/colors', () => {
  it('formats rgb to uppercase hex', () => {
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
    expect(rgbToHex({ r: 1, g: 1, b: 1 })).toBe('#FFFFFF');
    expect(rgbToHex({ r: 1, g: 0.5, b: 0 })).toBe('#FF8000');
  });

  it('clamps out-of-range channels', () => {
    expect(rgbToHex({ r: 2, g: -1, b: 0 })).toBe('#FF0000');
  });

  it('picks topmost visible solid fill', () => {
    const fills = [
      { type: 'SOLID', visible: true, color: { r: 0, g: 0, b: 1 } },
      { type: 'SOLID', visible: true, color: { r: 1, g: 0, b: 0 } },
    ] as Paint[];
    expect(topSolidFillColor(fills)).toBe('#FF0000');
  });

  it('skips invisible fills', () => {
    const fills = [
      { type: 'SOLID', visible: false, color: { r: 1, g: 0, b: 0 } },
      { type: 'SOLID', visible: true, color: { r: 0, g: 1, b: 0 } },
    ] as Paint[];
    expect(topSolidFillColor(fills)).toBe('#00FF00');
  });

  it('returns undefined when no solid fill', () => {
    expect(topSolidFillColor([])).toBeUndefined();
  });
});

describe('converter/colors', () => {
  it('strips hash', () => {
    expect(stripHash('#1A2E1A')).toBe('1A2E1A');
    expect(stripHash('1A2E1A')).toBe('1A2E1A');
  });

  it('maps opacity to transparency percent', () => {
    expect(opacityToTransparency(1)).toBe(0);
    expect(opacityToTransparency(0.5)).toBe(50);
    expect(opacityToTransparency(0)).toBe(100);
  });

  it('composites white@80% over black to #CCCCCC', () => {
    expect(compositeColorOverBackground('#FFFFFF', 0.8, '#000000')).toBe('#CCCCCC');
  });
});
