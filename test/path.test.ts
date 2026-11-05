import { describe, it, expect } from 'vitest';
import { parseSvgPath, svgPathToPoints } from '../src/converter/polygon';

describe('parseSvgPath', () => {
  it('parses move/line/close', () => {
    expect(parseSvgPath('M 0 0 L 10 0 L 10 10 Z')).toEqual([
      { cmd: 'M', x: 0, y: 0 },
      { cmd: 'L', x: 10, y: 0 },
      { cmd: 'L', x: 10, y: 10 },
      { cmd: 'Z' },
    ]);
  });

  it('parses commands without spaces (M0 0 L10 0)', () => {
    expect(parseSvgPath('M0 0 L10 0 Z')).toEqual([
      { cmd: 'M', x: 0, y: 0 },
      { cmd: 'L', x: 10, y: 0 },
      { cmd: 'Z' },
    ]);
  });

  it('parses cubic beziers with all six control/end coords', () => {
    expect(parseSvgPath('M 0 0 C 1 2 3 4 5 6')).toEqual([
      { cmd: 'M', x: 0, y: 0 },
      { cmd: 'C', x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 },
    ]);
  });

  it('parses quadratic beziers', () => {
    expect(parseSvgPath('M 0 0 Q 2 4 8 8')).toEqual([
      { cmd: 'M', x: 0, y: 0 },
      { cmd: 'Q', x1: 2, y1: 4, x: 8, y: 8 },
    ]);
  });

  it('treats a second moveTo as moveTo, then implicit lineto', () => {
    expect(parseSvgPath('M 0 0 L 5 0 M 10 0 L 15 0')).toEqual([
      { cmd: 'M', x: 0, y: 0 },
      { cmd: 'L', x: 5, y: 0 },
      { cmd: 'M', x: 10, y: 0 },
      { cmd: 'L', x: 15, y: 0 },
    ]);
  });

  it('handles negative and decimal numbers', () => {
    expect(parseSvgPath('M -1.5 0 L 2.25 -3.75')).toEqual([
      { cmd: 'M', x: -1.5, y: 0 },
      { cmd: 'L', x: 2.25, y: -3.75 },
    ]);
  });
});

describe('svgPathToPoints', () => {
  it('emits moveTo/lineTo/close custGeom points in inches', () => {
    const pts = svgPathToPoints('M 0 0 L 96 0 L 96 96 Z') as Array<Record<string, unknown>>;
    expect(pts[0]).toMatchObject({ x: 0, y: 0, moveTo: true });
    expect(pts[1]).toMatchObject({ x: 96 / 72, y: 0 }); // 96pt → inch
    expect(pts[2]).toMatchObject({ x: 96 / 72, y: 96 / 72 });
    expect(pts[3]).toEqual({ close: true });
  });

  it('emits cubic curve points', () => {
    const pts = svgPathToPoints('M 0 0 C 96 0 96 96 0 96') as Array<Record<string, unknown>>;
    expect(pts[1]).toMatchObject({
      x: 0,
      y: 96 / 72,
      curve: { type: 'cubic', x1: 96 / 72, y1: 0, x2: 96 / 72, y2: 96 / 72 },
    });
  });
});
