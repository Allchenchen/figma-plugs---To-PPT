/**
 * Mixed line-height conversion — plan acceptance (structure layer).
 *
 * Constraints under test:
 * - No average / max / first-char line height or fixed Y compensation
 * - SVG visual lines only when UTF-16-aligned with source
 * - Uniform paragraph line height → one native text box
 * - Intra-paragraph mixed line height → ordered native line boxes
 * - SVG mismatch: editable keeps one box; fidelity local PNG decision
 *
 * Visual pixel parity in PowerPoint is out of scope for this suite.
 */
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createPptx } from '../src/converter/converter';
import { postProcessPptx } from '../src/converter/postprocess';
import { textRenderFragments, textBoxOptions } from '../src/converter/text';
import {
  buildTextParagraphs,
  decideMixedLineHeightRender,
  parseSvgVisualLines,
  sliceTextRuns,
  type TextSegmentInput,
} from '../src/reader/text-model';
import type { ExportOptions, IRDocument, IRElement, IRText, IRTextParagraph } from '../src/ir/types';

function text(overrides: Partial<IRText> = {}): IRText {
  return {
    id: 'mixed',
    type: 'text',
    rect: { x: 40, y: 80, width: 360, height: 120 },
    rotation: 0,
    opacity: 1,
    zIndex: 2,
    characters: 'Sample',
    fontSize: 16,
    fontFamily: 'Inter',
    fontWeight: 400,
    color: '#111111',
    letterSpacing: 0,
    lineHeight: null,
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    ...overrides,
  };
}

function para(
  overrides: Partial<IRTextParagraph> & { start: number; end: number }
): IRTextParagraph {
  return {
    lineHeight: { unit: 'PIXELS', value: 24 },
    mixedLineHeight: false,
    paragraphSpacing: 0,
    paragraphIndent: 0,
    textAlignHorizontal: 'LEFT',
    ...overrides,
  };
}

function segment(
  start: number,
  end: number,
  body: string,
  lineHeight: TextSegmentInput['lineHeight'],
  extra: Partial<TextSegmentInput> = {}
): TextSegmentInput {
  return {
    start,
    end,
    text: body,
    fontSize: 16,
    fontFamily: 'Inter',
    fontWeight: 400,
    color: '#111111',
    letterSpacing: 0,
    lineHeight,
    paragraphSpacing: 0,
    paragraphIndent: 0,
    ...extra,
  };
}

async function slideArtifacts(
  elements: IRElement[],
  strategy: 'editable' | 'fidelity' = 'editable'
): Promise<{ xml: string; hasPic: boolean; textNames: string[] }> {
  const doc: IRDocument = {
    slides: [
      {
        id: 's1',
        name: 's1',
        width: 1920,
        height: 1080,
        backgroundColor: '#FFFFFF',
        elements,
      },
    ],
    report: { entries: [] },
  };
  const options: ExportOptions = { sizePreset: 'frame', strategy };
  const pptx = createPptx(doc, options);
  const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
  const out = await postProcessPptx(buffer, doc, options);
  const zip = await JSZip.loadAsync(out);
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
  const textNames = [...xml.matchAll(/name="(F2P_TXT_[^"]+)"/g)].map((m) => m[1]);
  return { xml, hasPic: xml.includes('<p:pic>'), textNames };
}

describe('paragraph split + UTF-16 / emoji / CJK', () => {
  it('splits logical paragraphs on manual newlines without inventing line heights', () => {
    const source = '中文\nEnglish\n😀尾';
    const paragraphs = buildTextParagraphs(
      source,
      [
        segment(0, 2, '中文', { unit: 'PIXELS', value: 28 }),
        segment(3, 10, 'English', { unit: 'PERCENT', value: 150 }),
        segment(11, 14, '😀尾', { unit: 'AUTO' }),
      ],
      'LEFT'
    );
    expect(paragraphs.map((p) => source.slice(p.start, p.end))).toEqual([
      '中文',
      'English',
      '😀尾',
    ]);
    expect(paragraphs[0].lineHeight).toEqual({ unit: 'PIXELS', value: 28 });
    expect(paragraphs[1].lineHeight).toEqual({ unit: 'PERCENT', value: 150 });
    expect(paragraphs[2].lineHeight).toEqual({ unit: 'AUTO' });
    expect(paragraphs.every((p) => p.mixedLineHeight === false)).toBe(true);
  });

  it('keeps emoji on UTF-16 boundaries when slicing runs for visual lines', () => {
    const runs = [
      {
        start: 0,
        end: 1,
        text: 'A',
        fontSize: 20,
        fontFamily: 'Inter',
        fontWeight: 700,
        color: '#000',
        letterSpacing: 0,
      },
      {
        start: 1,
        end: 3,
        text: '😀',
        fontSize: 24,
        fontFamily: 'Inter',
        fontWeight: 400,
        color: '#000',
        letterSpacing: 0,
      },
      {
        start: 3,
        end: 4,
        text: '中',
        fontSize: 18,
        fontFamily: 'PingFang SC',
        fontWeight: 400,
        color: '#000',
        letterSpacing: 0,
      },
    ];
    const sliced = sliceTextRuns(runs, 1, 4);
    expect(sliced.map((r) => r.text).join('')).toBe('😀中');
    expect(sliced[0].text).toBe('😀');
  });

  it('aligns SVG visual lines containing emoji with source UTF-16 ranges', () => {
    const source = 'A😀中Next';
    const svg =
      '<svg viewBox="0 0 200 80"><text>' +
      '<tspan x="0" y="20">A😀中</tspan>' +
      '<tspan x="0" y="48">Next</tspan>' +
      '</text></svg>';
    const result = parseSvgVisualLines(svg, source);
    expect(result.status).toBe('exact');
    expect(result.lines.map((l) => [l.start, l.end, l.text])).toEqual([
      [0, 4, 'A😀中'],
      [4, 8, 'Next'],
    ]);
    expect(source.slice(0, 4)).toBe('A😀中');
  });
});

describe('uniform vs intra-paragraph mixed line height', () => {
  it('keeps one fragment when each paragraph has a single line-height', () => {
    const layer = text({
      characters: '甲\n乙',
      paragraphs: [
        para({ start: 0, end: 1, lineHeight: { unit: 'PIXELS', value: 30 } }),
        para({ start: 2, end: 3, lineHeight: { unit: 'PERCENT', value: 160 } }),
      ],
      visualLineStatus: 'exact',
      visualLines: [
        { start: 0, end: 1, text: '甲', x: 0, baselineY: 20, paragraphIndex: 0 },
        { start: 2, end: 3, text: '乙', x: 0, baselineY: 50, paragraphIndex: 1 },
      ],
    });
    expect(textRenderFragments(layer)).toHaveLength(1);
    expect(decideMixedLineHeightRender(layer, 'editable').kind).toBe('native');
  });

  it('splits only for mixed line-height inside one paragraph using baseline deltas', () => {
    const characters = 'A😀中Next';
    const layer = text({
      characters,
      rect: { x: 100, y: 200, width: 400, height: 90 },
      runs: [
        {
          start: 0,
          end: 3,
          text: 'A😀',
          fontSize: 20,
          fontFamily: 'Inter',
          fontWeight: 700,
          color: '#000000',
          letterSpacing: 0,
        },
        {
          start: 3,
          end: 8,
          text: '中Next',
          fontSize: 16,
          fontFamily: 'Arial',
          fontWeight: 400,
          color: '#000000',
          letterSpacing: 0,
        },
      ],
      paragraphs: [
        para({
          start: 0,
          end: 8,
          lineHeight: null,
          mixedLineHeight: true,
        }),
      ],
      visualLineStatus: 'exact',
      visualLines: [
        { start: 0, end: 4, text: 'A😀中', x: 12, baselineY: 20, paragraphIndex: 0 },
        { start: 4, end: 8, text: 'Next', x: 0, baselineY: 48, paragraphIndex: 0 },
      ],
    });

    const fragments = textRenderFragments(layer);
    expect(fragments).toHaveLength(1);
    expect(fragments[0].characters).toBe(characters);
    expect(fragments[0].id).toBe(layer.id);
  });

  it('editable keeps one box when SVG mismatches; fidelity chooses local image', () => {
    const base = {
      characters: 'AB',
      paragraphs: [para({ start: 0, end: 2, lineHeight: null, mixedLineHeight: true })],
      visualLineStatus: 'mismatch' as const,
      visualLineReason: 'SVG/source text mismatch at UTF-16 offset 0',
    };
    expect(decideMixedLineHeightRender(base, 'editable')).toEqual({
      kind: 'native',
      reason: 'mixed line-height kept editable: SVG/source text mismatch at UTF-16 offset 0',
    });
    expect(decideMixedLineHeightRender(base, 'fidelity').kind).toBe('image');
  });
});

describe('PPTX structure: geometry, z-order, editable, no full-page raster', () => {
  it('emits distinct <a:lnSpc> per paragraph in one editable box (uniform-within-para)', async () => {
    const layer = text({
      id: 'multi-para',
      characters: 'One\nTwo',
      zIndex: 1,
      paragraphs: [
        para({
          start: 0,
          end: 3,
          lineHeight: { unit: 'PIXELS', value: 24 },
          paragraphSpacing: 8,
        }),
        para({
          start: 4,
          end: 7,
          lineHeight: { unit: 'PERCENT', value: 150 },
          paragraphSpacing: 0,
        }),
      ],
    });
    const shape = {
      id: 'behind',
      type: 'shape' as const,
      shapeKind: 'rect' as const,
      rect: { x: 0, y: 0, width: 50, height: 50 },
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      fill: '#FF0000',
      stroke: null,
      cornerRadii: null,
    };
    const { xml, hasPic, textNames } = await slideArtifacts([shape, layer]);
    expect(hasPic).toBe(false);
    expect(textNames).toEqual(['F2P_TXT_multi-para']);
    expect(xml).toContain('<a:spcPts val="2400"/>');
    expect(xml).toContain('<a:spcPts val="2400"/>');
    expect(xml).toContain('<a:spcAft><a:spcPts val="800"/></a:spcAft>');
    expect(xml).toContain('txBox="1"');
    // Shape appears before text in paint order (zIndex 0 then 1)
    expect(xml.indexOf('FF0000')).toBeLessThan(xml.indexOf('F2P_TXT_multi-para'));
  });

  it('emits ordered editable line boxes for intra-paragraph mixed split', async () => {
    const fixed = text({
      id: 'split-mixed',
      characters: 'HiLo',
      zIndex: 3,
      rect: { x: 10, y: 20, width: 200, height: 60 },
      paragraphs: [para({ start: 0, end: 4, lineHeight: null, mixedLineHeight: true })],
      visualLineStatus: 'exact',
      visualLines: [
        { start: 0, end: 2, text: 'Hi', x: 0, baselineY: 16, paragraphIndex: 0 },
        { start: 2, end: 4, text: 'Lo', x: 0, baselineY: 40, paragraphIndex: 0 },
      ],
      runs: [
        {
          start: 0,
          end: 2,
          text: 'Hi',
          fontSize: 20,
          fontFamily: 'Inter',
          fontWeight: 700,
          color: '#000000',
          letterSpacing: 0,
        },
        {
          start: 2,
          end: 4,
          text: 'Lo',
          fontSize: 14,
          fontFamily: 'Inter',
          fontWeight: 400,
          color: '#000000',
          letterSpacing: 0,
        },
      ],
    });

    const fragments = textRenderFragments(fixed);
    expect(fragments.map((f) => f.id)).toEqual(['split-mixed']);
    const { xml, hasPic, textNames } = await slideArtifacts(fragments);
    expect(hasPic).toBe(false);
    expect(textNames).toEqual(['F2P_TXT_split-mixed']);
    expect(xml).toContain('<a:t>Hi</a:t>');
    expect(xml).toContain('<a:t>Lo</a:t>');
    expect(textBoxOptions(fragments[0]).y).toBe(textBoxOptions(fixed).y);
  });
});
