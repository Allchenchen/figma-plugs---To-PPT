import type { Rect } from '../ir/types';

export interface PixelImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export interface TextVisualCase {
  id: string;
  figmaRegion: Rect;
  pptRegion: Rect;
  figmaTextBox: Rect;
  pptTextBox: Rect;
  figmaBaselines?: number[];
  pptBaselines?: number[];
  foreground?: 'light' | 'dark';
}

export interface TextVisualReport {
  id: string;
  textBoxErrorPx: Rect;
  glyphTopErrorPx: number | null;
  glyphBottomErrorPx: number | null;
  baselineErrorsPx: number[];
  figmaVisualLineCount: number;
  pptVisualLineCount: number;
  wrapMatches: boolean;
}

interface GlyphMeasure {
  top: number;
  bottom: number;
  lineCount: number;
}

function foregroundPixel(
  image: PixelImage,
  x: number,
  y: number,
  foreground: 'light' | 'dark'
): boolean {
  const offset = (y * image.width + x) * 4;
  if ((image.data[offset + 3] ?? 0) < 128) return false;
  const luminance =
    image.data[offset] * 0.2126 +
    image.data[offset + 1] * 0.7152 +
    image.data[offset + 2] * 0.0722;
  return foreground === 'light' ? luminance >= 220 : luminance <= 35;
}

function glyphMeasure(
  image: PixelImage,
  region: Rect,
  foreground: 'light' | 'dark'
): GlyphMeasure | null {
  const startX = Math.max(0, Math.floor(region.x));
  const endX = Math.min(image.width, Math.ceil(region.x + region.width));
  const startY = Math.max(0, Math.floor(region.y));
  const endY = Math.min(image.height, Math.ceil(region.y + region.height));
  const occupiedRows: number[] = [];
  for (let y = startY; y < endY; y += 1) {
    let occupied = false;
    for (let x = startX; x < endX; x += 1) {
      if (foregroundPixel(image, x, y, foreground)) {
        occupied = true;
        break;
      }
    }
    if (occupied) occupiedRows.push(y);
  }
  if (occupiedRows.length === 0) return null;
  let lineCount = 1;
  for (let index = 1; index < occupiedRows.length; index += 1) {
    if (occupiedRows[index] > occupiedRows[index - 1] + 1) lineCount += 1;
  }
  return {
    top: occupiedRows[0],
    bottom: occupiedRows[occupiedRows.length - 1] + 1,
    lineCount,
  };
}

function normalizeX(value: number, source: Rect, target: Rect): number {
  return source.x + (value - target.x) * (source.width / target.width);
}

function normalizeY(value: number, source: Rect, target: Rect): number {
  return source.y + (value - target.y) * (source.height / target.height);
}

/** Compare geometry and visible glyph pixels without treating either as equivalent. */
export function compareTextVisualCase(
  figma: PixelImage,
  ppt: PixelImage,
  testCase: TextVisualCase
): TextVisualReport {
  const foreground = testCase.foreground ?? 'light';
  const figmaGlyph = glyphMeasure(figma, testCase.figmaRegion, foreground);
  const pptGlyph = glyphMeasure(ppt, testCase.pptRegion, foreground);
  const normalizedPptBox = {
    x: normalizeX(testCase.pptTextBox.x, testCase.figmaRegion, testCase.pptRegion),
    y: normalizeY(testCase.pptTextBox.y, testCase.figmaRegion, testCase.pptRegion),
    width: testCase.pptTextBox.width * (testCase.figmaRegion.width / testCase.pptRegion.width),
    height:
      testCase.pptTextBox.height * (testCase.figmaRegion.height / testCase.pptRegion.height),
  };
  const baselineCount = Math.min(
    testCase.figmaBaselines?.length ?? 0,
    testCase.pptBaselines?.length ?? 0
  );
  const baselineErrorsPx = Array.from({ length: baselineCount }, (_, index) => {
    const normalized = normalizeY(
      testCase.pptBaselines![index],
      testCase.figmaRegion,
      testCase.pptRegion
    );
    return normalized - testCase.figmaBaselines![index];
  });

  return {
    id: testCase.id,
    textBoxErrorPx: {
      x: normalizedPptBox.x - testCase.figmaTextBox.x,
      y: normalizedPptBox.y - testCase.figmaTextBox.y,
      width: normalizedPptBox.width - testCase.figmaTextBox.width,
      height: normalizedPptBox.height - testCase.figmaTextBox.height,
    },
    glyphTopErrorPx:
      figmaGlyph && pptGlyph
        ? normalizeY(pptGlyph.top, testCase.figmaRegion, testCase.pptRegion) - figmaGlyph.top
        : null,
    glyphBottomErrorPx:
      figmaGlyph && pptGlyph
        ? normalizeY(pptGlyph.bottom, testCase.figmaRegion, testCase.pptRegion) -
          figmaGlyph.bottom
        : null,
    baselineErrorsPx,
    figmaVisualLineCount: figmaGlyph?.lineCount ?? 0,
    pptVisualLineCount: pptGlyph?.lineCount ?? 0,
    wrapMatches: (figmaGlyph?.lineCount ?? 0) === (pptGlyph?.lineCount ?? 0),
  };
}
