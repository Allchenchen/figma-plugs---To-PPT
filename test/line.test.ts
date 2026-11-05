import { describe, it, expect } from 'vitest';
import { classifyLine } from '../src/reader/line';

describe('classifyLine', () => {
  it('detects a horizontal line (height == stroke weight)', () => {
    expect(classifyLine(200, 2, 2)).toBe('horizontal');
  });

  it('detects a vertical line (width == stroke weight)', () => {
    expect(classifyLine(2, 200, 2)).toBe('vertical');
  });

  it('detects a diagonal line', () => {
    expect(classifyLine(100, 80, 2)).toBe('diagonal');
  });

  it('tolerates rounding on the stroke axis', () => {
    expect(classifyLine(200, 2.4, 2)).toBe('horizontal');
    expect(classifyLine(2.3, 200, 2)).toBe('vertical');
  });

  it('treats a degenerate square as horizontal', () => {
    expect(classifyLine(2, 2, 2)).toBe('horizontal');
  });
});
