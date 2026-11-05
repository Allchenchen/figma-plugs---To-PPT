import { describe, it, expect } from 'vitest';
import { letterSpacingPx, lineHeightPx, styleToWeight } from '../src/reader/text';

describe('letterSpacingPx', () => {
  it('returns pixel value as-is', () => {
    expect(letterSpacingPx({ unit: 'PIXELS', value: 2 }, 20)).toBe(2);
  });

  it('converts percent against font size', () => {
    expect(letterSpacingPx({ unit: 'PERCENT', value: 10 }, 20)).toBe(2);
  });
});

describe('lineHeightPx', () => {
  it('returns pixel value as-is', () => {
    expect(lineHeightPx({ unit: 'PIXELS', value: 24 }, 16)).toBe(24);
  });

  it('converts percent against font size', () => {
    expect(lineHeightPx({ unit: 'PERCENT', value: 150 }, 16)).toBe(24);
  });

  it('returns null for AUTO', () => {
    expect(lineHeightPx(null, 16)).toBeNull();
  });
});

describe('styleToWeight', () => {
  it('maps common style names to weights', () => {
    expect(styleToWeight('Regular')).toBe(400);
    expect(styleToWeight('Bold')).toBe(700);
    expect(styleToWeight('Medium')).toBe(500);
    expect(styleToWeight('Light')).toBe(300);
    expect(styleToWeight('Black')).toBe(900);
    expect(styleToWeight('SemiBold')).toBe(600);
  });
});
