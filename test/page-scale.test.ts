import { describe, expect, it } from 'vitest';
import { round2, PPT_WIDTH_PT, PPT_HEIGHT_PT, PPT_WIDTH_IN, PPT_HEIGHT_IN } from '../src/converter/units';
import {
  computePageLayout,
  layoutForFrame,
  mapPercentsToSlide,
  mapRectToSlide,
  mapTypographyPt,
  rectToFramePercents,
  slidePtToInch,
} from '../src/converter/page-scale';
import { resolveLayout, createPptx } from '../src/converter/converter';
import { textBoxOptions, textRuns } from '../src/converter/text';
import type { IRDocument, IRSlide, IRText } from '../src/ir/types';
import JSZip from 'jszip';

describe('round2', () => {
  it('keeps two decimal places', () => {
    expect(round2(1.234)).toBe(1.23);
    expect(round2(1.235)).toBe(1.24);
  });
});

describe('1920×1080 pt page layout', () => {
  it('is 1:1 for a 1920×1080 frame', () => {
    const layout = layoutForFrame(1920, 1080);
    expect(layout.width).toBe(PPT_WIDTH_PT);
    expect(layout.height).toBe(PPT_HEIGHT_PT);
    expect(layout.scale).toBe(1);
    expect(layout.offsetX).toBe(0);
    expect(layout.offsetY).toBe(0);
  });

  it('scales 1280×720 frames by 1.5', () => {
    const layout = layoutForFrame(1280, 720);
    expect(layout.scale).toBe(1.5);
    expect(layout.offsetX).toBe(0);
    expect(layout.offsetY).toBe(0);
    expect(mapTypographyPt(16, layout.scale)).toBe(24);
  });

  it('scales 1600×900 frames by 1.2', () => {
    const layout = layoutForFrame(1600, 900);
    expect(layout.scale).toBeCloseTo(1.2);
  });

  it('letterboxes non-16:9 frames without stretching', () => {
    const layout = computePageLayout(800, 1200, 1920, 1080);
    expect(layout.scale).toBeCloseTo(1080 / 1200);
    expect(layout.offsetY).toBe(0);
    expect(layout.offsetX).toBeCloseTo((1920 - 800 * layout.scale) / 2);
    const mapped = mapRectToSlide({ x: 0, y: 0, width: 800, height: 1200 }, layout);
    expect(mapped.width / mapped.height).toBeCloseTo(800 / 1200);
  });

  it('resolveLayout always targets 1920×1080 regardless of preset', () => {
    const slide: IRSlide = {
      id: 's',
      name: 's',
      width: 1920,
      height: 1080,
      backgroundColor: '#000',
      elements: [],
    };
    expect(resolveLayout(slide, 'frame').scale).toBe(1);
    expect(resolveLayout(slide, '16x9').width).toBe(1920);
    expect(resolveLayout(slide, '4x3').height).toBe(1080);
  });
});

describe('percentage coordinates', () => {
  it('round-trips through percents with uniform scale', () => {
    const layout = layoutForFrame(1000, 500);
    const rect = { x: 100, y: 50, width: 200, height: 80 };
    const percents = rectToFramePercents(rect, layout.frameWidth, layout.frameHeight);
    const viaScale = mapRectToSlide(rect, layout);
    const viaPercent = mapPercentsToSlide(percents, layout);
    expect(viaPercent.x).toBeCloseTo(viaScale.x);
    expect(viaPercent.width).toBeCloseTo(viaScale.width);
  });
});

describe('typography 1:1 mapping', () => {
  it('maps Figma sizes to pt at scale 1', () => {
    expect(mapTypographyPt(140, 1)).toBe(140);
    expect(mapTypographyPt(48, 1)).toBe(48);
    expect(mapTypographyPt(24, 1)).toBe(24);
    expect(mapTypographyPt(16, 1)).toBe(16);
  });
});

describe('emission', () => {
  it('converts pt→inch via /72 and keeps text editable', async () => {
    expect(slidePtToInch(72)).toBe(1);
    expect(slidePtToInch(1920)).toBeCloseTo(PPT_WIDTH_IN);

    const text: IRText = {
      id: 't',
      type: 'text',
      rect: { x: 10, y: 20, width: 400, height: 80 },
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      characters: 'Aa',
      fontSize: 18,
      fontFamily: 'SF Pro',
      fontWeight: 400,
      color: '#FFFFFF',
      letterSpacing: 0,
      lineHeight: null,
      textAlignHorizontal: 'CENTER',
      textAlignVertical: 'BOTTOM',
    };
    expect(textBoxOptions(text).x).toBe(slidePtToInch(10));
    expect(textRuns(text)[0].options.fontSize).toBe(18);

    const doc: IRDocument = {
      slides: [
        {
          id: 's1',
          name: 's1',
          width: 1920,
          height: 1080,
          backgroundColor: '#000000',
          elements: [text],
        },
      ],
      report: { entries: [] },
    };
    const pptx = createPptx(doc, { sizePreset: 'frame', strategy: 'editable' });
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
    const zip = await JSZip.loadAsync(buffer);
    const pres = await zip.file('ppt/presentation.xml')!.async('string');
    // 1920pt = 26.666...in → sldSz in EMU: 1920*12700, 1080*12700
    expect(pres).toMatch(/cx="24384000"/); // 1920 * 12700
    expect(pres).toMatch(/cy="13716000"/); // 1080 * 12700
  });
});
