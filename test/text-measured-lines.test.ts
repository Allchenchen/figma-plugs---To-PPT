import { describe, expect, it } from 'vitest';
import { visualLineBreakKind } from '../src/converter/text-wrap';
import type { IRTextVisualLine } from '../src/ir/types';

function line(
  paragraphIndex: number,
  lineHeightPx?: number
): IRTextVisualLine {
  return {
    start: 0,
    end: 1,
    text: 'a',
    x: 0,
    baselineY: 0,
    paragraphIndex,
    lineHeightPx,
  };
}

describe('visualLineBreakKind', () => {
  it('keeps an automatic wrap as a soft break when the measured gap stays the same', () => {
    const lines = [line(0, 20), line(0, 20), line(0)];
    expect(visualLineBreakKind(lines, 0)).toBe('softBreak');
    expect(visualLineBreakKind(lines, 1)).toBe('softBreak');
  });

  it('starts a paragraph when the author pressed Enter', () => {
    const lines = [line(0, 20), line(1, 20)];
    expect(visualLineBreakKind(lines, 0)).toBe('paragraphBreak');
  });

  it('starts a paragraph when the measured gap changes', () => {
    const lines = [line(0, 20), line(0, 40), line(0)];
    expect(visualLineBreakKind(lines, 0)).toBe('paragraphBreak');
    expect(visualLineBreakKind(lines, 1)).toBe('softBreak');
  });

  it('keeps a wrapped line soft when the last gap already includes the next paragraph', () => {
    const lines = [line(0, 24), line(0, 48), line(1, 24)];
    expect(visualLineBreakKind(lines, 0)).toBe('softBreak');
    expect(visualLineBreakKind(lines, 1)).toBe('paragraphBreak');
  });
});
