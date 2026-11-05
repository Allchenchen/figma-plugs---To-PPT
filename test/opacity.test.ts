import { describe, it, expect } from 'vitest';
import {
  paintOpacity,
  paintOpacityExplicit,
  combineLeafOpacity,
  shouldRasterizeForGroupOpacity,
  topSolidFill,
  resolveTextSolidFill,
} from '../src/reader/colors';
import { textOptions, textRuns } from '../src/converter/text';
import { opacityToTransparency, compositeColorOverBackground } from '../src/converter/colors';
import type { IRText } from '../src/ir/types';
import JSZip from 'jszip';
import { createPptx } from '../src/converter/converter';
import type { IRDocument } from '../src/ir/types';

describe('paintOpacity', () => {
  it('reads SOLID paint opacity (default 1)', () => {
    expect(paintOpacity({ type: 'SOLID', visible: true, opacity: 0.4, color: { r: 1, g: 0, b: 0 } } as Paint)).toBe(0.4);
    expect(paintOpacity({ type: 'SOLID', visible: true, color: { r: 1, g: 0, b: 0 } } as Paint)).toBe(1);
  });
});

describe('combineLeafOpacity', () => {
  it('multiplies node opacity with paint opacity on the same leaf', () => {
    expect(combineLeafOpacity(0.8, 0.5)).toBeCloseTo(0.4);
  });

  it('clamps each factor to 0..1 before multiplying', () => {
    expect(combineLeafOpacity(2, 0.5)).toBe(0.5); // 1 * 0.5
    expect(combineLeafOpacity(-1, 0.5)).toBe(0);
  });
});

describe('shouldRasterizeForGroupOpacity', () => {
  it('rasterizes multi-child groups with opacity < 1 (no per-child multiply)', () => {
    expect(shouldRasterizeForGroupOpacity(0.5, 3)).toBe(true);
  });

  it('allows decomposing a fully opaque group', () => {
    expect(shouldRasterizeForGroupOpacity(1, 5)).toBe(false);
  });

  it('allows multiplying onto a single child (no overlap compositing issue)', () => {
    expect(shouldRasterizeForGroupOpacity(0.5, 1)).toBe(false);
  });
});

describe('topSolidFill', () => {
  it('returns color and paint opacity together', () => {
    const fills = [
      { type: 'SOLID', visible: true, opacity: 0.6, color: { r: 1, g: 0, b: 0 } },
    ] as Paint[];
    expect(topSolidFill(fills)).toEqual({ color: '#FF0000', opacity: 0.6 });
  });
});

describe('resolveTextSolidFill (Figma Insight body case)', () => {
  it('uses node.fills opacity when segment paints omit opacity', () => {
    // getStyledTextSegments often returns {type:'SOLID', color:{…}} with NO opacity.
    const segmentFills = [
      { type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1 } },
    ] as Paint[];
    const nodeFills = [
      { type: 'SOLID', visible: true, opacity: 0.8, color: { r: 1, g: 1, b: 1 } },
    ] as Paint[];
    expect(resolveTextSolidFill(segmentFills, nodeFills)).toEqual({
      color: '#FFFFFF',
      opacity: 0.8,
    });
  });

  it('prefers explicit segment opacity over node fills', () => {
    const segmentFills = [
      { type: 'SOLID', visible: true, opacity: 0.5, color: { r: 1, g: 1, b: 1 } },
    ] as Paint[];
    const nodeFills = [
      { type: 'SOLID', visible: true, opacity: 0.8, color: { r: 1, g: 1, b: 1 } },
    ] as Paint[];
    expect(resolveTextSolidFill(segmentFills, nodeFills)?.opacity).toBe(0.5);
  });

  it('paintOpacityExplicit returns undefined when opacity field is absent', () => {
    expect(
      paintOpacityExplicit({ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1 } } as Paint)
    ).toBeUndefined();
    expect(
      paintOpacityExplicit({
        type: 'SOLID',
        visible: true,
        opacity: 0.8,
        color: { r: 1, g: 1, b: 1 },
      } as Paint)
    ).toBe(0.8);
  });
});

describe('text opacity → PPTX', () => {
  function text(overrides: Partial<IRText> = {}): IRText {
    return {
      id: 't1',
      type: 'text',
      rect: { x: 0, y: 0, width: 200, height: 40 },
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      characters: 'Hi',
      fontSize: 16,
      fontFamily: 'Arial',
      fontWeight: 400,
      color: '#000000',
      letterSpacing: 0,
      lineHeight: null,
      textAlignHorizontal: 'LEFT',
      textAlignVertical: 'TOP',
      ...overrides,
    };
  }

  it('maps opacity to transparency percent (helper)', () => {
    expect(opacityToTransparency(1)).toBe(0);
    expect(opacityToTransparency(0.8)).toBe(20);
    expect(opacityToTransparency(0.64)).toBe(36);
    expect(opacityToTransparency(0)).toBe(100);
  });

  it('keeps shape-fill bake helper available (not used for text glyphs)', () => {
    expect(compositeColorOverBackground('#FFFFFF', 0.8, '#000000')).toBe('#CCCCCC');
  });

  // Simple path matrix: IR.opacity is already paint × node (applied once).
  it.each([
    { op: 1, color: 'FFFFFF', transparency: undefined as number | undefined },
    { op: 0.8, color: 'FFFFFF', transparency: 20 },
    { op: 0.64, color: 'FFFFFF', transparency: 36 },
    { op: 0, color: 'FFFFFF', transparency: 100 },
  ])('paint×node effective $op → color $color transparency $transparency', ({ op, color, transparency }) => {
    const runs = textRuns(text({ opacity: op, color: '#FFFFFF', characters: 'body' }), '#000000');
    expect(runs[0].options.color).toBe(color);
    expect(runs[0].options.transparency).toBe(transparency);
  });

  it('maps per-run opacity without rewriting source RGB', () => {
    const runs = textRuns(
      text({
        runs: [
          { text: 'a', fontSize: 16, fontFamily: 'Arial', fontWeight: 400, color: '#FFFFFF', letterSpacing: 0, opacity: 0.8 },
          { text: 'b', fontSize: 16, fontFamily: 'Arial', fontWeight: 400, color: '#FF0000', letterSpacing: 0, opacity: 1 },
        ],
      }),
      '#000000'
    );
    expect(runs[0].options.color).toBe('FFFFFF');
    expect(runs[0].options.transparency).toBe(20);
    expect(runs[1].options.color).toBe('FF0000');
    expect(runs[1].options.transparency).toBeUndefined();
  });

  it('emits original RGB + DrawingML alpha (not baked grey)', async () => {
    const doc: IRDocument = {
      slides: [
        {
          id: 's1',
          name: 'S',
          width: 800,
          height: 600,
          backgroundColor: '#000000',
          elements: [text({ opacity: 0.8, color: '#FFFFFF', characters: 'Fade' })],
        },
      ],
      report: { entries: [] },
    };
    const pptx = createPptx(doc, { sizePreset: 'frame', strategy: 'editable' });
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(xml).toMatch(/srgbClr val="FFFFFF"><a:alpha val="80000"\/>/);
    expect(xml).not.toMatch(/srgbClr val="CCCCCC"/);
  });

  it('postProcess re-run does not accumulate transparency', async () => {
    const { postProcessPptx } = await import('../src/converter/postprocess');
    const doc: IRDocument = {
      slides: [
        {
          id: 's1',
          name: 'S',
          width: 800,
          height: 600,
          backgroundColor: '#000000',
          elements: [text({ id: 'fade', opacity: 0.8, color: '#FFFFFF', characters: 'Fade' })],
        },
      ],
      report: { entries: [] },
    };
    const pptx = createPptx(doc, { sizePreset: 'frame', strategy: 'editable' });
    const once = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
    const twice = await postProcessPptx(once, doc, { sizePreset: 'frame', strategy: 'editable' });
    const thrice = await postProcessPptx(twice, doc, { sizePreset: 'frame', strategy: 'editable' });
    const zip = await JSZip.loadAsync(thrice);
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const alphas = xml.match(/srgbClr val="FFFFFF"><a:alpha val="80000"\/>/g) ?? [];
    expect(alphas.length).toBeGreaterThanOrEqual(1);
    // No second alpha nested / no grey bake after repeated postprocess.
    expect(xml).not.toMatch(/<a:alpha[^>]*>\s*<a:alpha/);
    expect(xml).not.toContain('CCCCCC');
  });
});
