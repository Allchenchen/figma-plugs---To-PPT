import { describe, expect, it } from 'vitest';
import {
  compareTextVisualCase,
  type PixelImage,
} from '../src/validation/text-visual-diff';

function image(width: number, height: number, whitePixels: [number, number][]): PixelImage {
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < data.length; index += 4) data[index + 3] = 255;
  for (const [x, y] of whitePixels) {
    const offset = (y * width + x) * 4;
    data[offset] = 255;
    data[offset + 1] = 255;
    data[offset + 2] = 255;
  }
  return { width, height, data };
}

describe('text visual diagnostics', () => {
  it('reports text-box, visible-glyph, baseline and wrap differences separately', () => {
    const figma = image(10, 10, [
      [2, 3],
      [3, 3],
      [2, 4],
      [3, 4],
      [2, 7],
    ]);
    const ppt = image(20, 20, [
      [4, 8],
      [5, 8],
      [4, 9],
      [5, 9],
      [4, 16],
    ]);

    const report = compareTextVisualCase(figma, ppt, {
      id: 'mixed',
      figmaRegion: { x: 0, y: 0, width: 10, height: 10 },
      pptRegion: { x: 0, y: 0, width: 20, height: 20 },
      figmaTextBox: { x: 1, y: 2, width: 8, height: 7 },
      pptTextBox: { x: 2, y: 5, width: 16, height: 14 },
      figmaBaselines: [4, 8],
      pptBaselines: [9, 17],
    });

    expect(report.textBoxErrorPx).toEqual({ x: 0, y: 0.5, width: 0, height: 0 });
    expect(report.glyphTopErrorPx).toBe(1);
    expect(report.glyphBottomErrorPx).toBe(0.5);
    expect(report.baselineErrorsPx).toEqual([0.5, 0.5]);
    expect(report.wrapMatches).toBe(true);
    expect(report.figmaVisualLineCount).toBe(2);
    expect(report.pptVisualLineCount).toBe(2);
  });
});
