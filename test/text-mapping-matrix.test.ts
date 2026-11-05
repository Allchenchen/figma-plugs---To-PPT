/**
 * Global text conversion matrix — property mapping, layout, OOXML, editability.
 * No page/font/content hardcoding beyond representative samples.
 */
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createPptx } from '../src/converter/converter';
import { postProcessPptx } from '../src/converter/postprocess';
import {
  applyDisplayTextCase,
  drawingMlCap,
  requiresCharacterCaseTransform,
} from '../src/converter/text-case';
import {
  normalizeLineHeight,
  paragraphBoundarySpaceAfterPx,
  paragraphSpaceAfterPx,
  pptFontSize,
  pptLangForFace,
  pptLineSpacing,
} from '../src/converter/text-layout';
import { textBoxOptions, textRuns } from '../src/converter/text';
import { softBreakGroups } from '../src/converter/text-paragraphs';
import { normalizeFigmaNewlines, buildTextParagraphs } from '../src/reader/text-model';
import type { ExportOptions, IRDocument, IRText, IRTextParagraph } from '../src/ir/types';

function text(overrides: Partial<IRText> = {}): IRText {
  return {
    id: 't1',
    type: 'text',
    rect: { x: 10, y: 20, width: 400, height: 100 },
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    characters: 'Sample',
    fontSize: 20,
    fontFamily: 'Inter',
    fontWeight: 400,
    color: '#FFFFFF',
    letterSpacing: 0,
    lineHeight: null,
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    ...overrides,
  };
}

function para(overrides: Partial<IRTextParagraph> & { start: number; end: number }): IRTextParagraph {
  return {
    lineHeight: { unit: 'PIXELS', value: 30 },
    mixedLineHeight: false,
    paragraphSpacing: 0,
    paragraphIndent: 0,
    ...overrides,
  };
}

async function slideXml(layer: IRText): Promise<string> {
  const doc: IRDocument = {
    slides: [
      {
        id: 's1',
        name: 's1',
        width: 1920,
        height: 1080,
        backgroundColor: '#000000',
        elements: [layer],
      },
    ],
    report: { entries: [] },
  };
  const options: ExportOptions = { sizePreset: 'frame', strategy: 'editable' };
  const pptx = createPptx(doc, options);
  const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
  const out = await postProcessPptx(buffer, doc, options);
  const zip = await JSZip.loadAsync(out);
  return zip.file('ppt/slides/slide1.xml')!.async('string');
}

describe('matrix: font size / weight / family', () => {
  it('maps Figma size number → PPT pt (100% default) and preserves typeface', () => {
    expect(pptFontSize(20)).toBe(20);
    expect(pptFontSize(18)).toBe(18);
    const runs = textRuns(
      text({
        runs: [
          {
            text: 'A',
            fontSize: 20,
            fontFamily: 'SF Pro',
            fontWeight: 700,
            color: '#000000',
            letterSpacing: 0,
          },
        ],
      })
    );
    expect(runs[0].options.fontSize).toBe(20);
    expect(runs[0].options.fontFace).toBe('SF Pro');
    expect(runs[0].options.bold).toBe(true);
  });

  it('hints zh-CN for CJK faces without renaming them', () => {
    expect(pptLangForFace('PingFang SC')).toEqual({ lang: 'zh-CN', altLang: 'en-US' });
    expect(pptLangForFace('Microsoft YaHei')).toEqual({ lang: 'zh-CN', altLang: 'en-US' });
    expect(pptLangForFace('Inter')).toEqual({});
  });
});

describe('matrix: CJK / mixed script', () => {
  it('keeps mixed runs editable with distinct faces', async () => {
    const xml = await slideXml(
      text({
        characters: '中文EN',
        runs: [
          {
            start: 0,
            end: 2,
            text: '中文',
            fontSize: 20,
            fontFamily: 'PingFang SC',
            fontWeight: 400,
            color: '#FFFFFF',
            letterSpacing: 0,
          },
          {
            start: 2,
            end: 4,
            text: 'EN',
            fontSize: 20,
            fontFamily: 'Inter',
            fontWeight: 700,
            color: '#FFFFFF',
            letterSpacing: 0,
          },
        ],
      })
    );
    expect(xml).toContain('<a:t>中文</a:t>');
    expect(xml).toContain('<a:t>EN</a:t>');
    expect(xml).toContain('typeface="PingFang SC"');
    expect(xml).toContain('typeface="Inter"');
    expect(xml).toContain('txBox="1"');
  });
});

describe('matrix: line height units', () => {
  it('keeps AUTO / PIXELS / PERCENT distinct', () => {
    expect(normalizeLineHeight({ unit: 'AUTO' }, 16)).toEqual({ px: null, unit: 'AUTO' });
    expect(normalizeLineHeight({ unit: 'PIXELS', value: 40 }, 16)).toEqual({
      px: 40,
      unit: 'PIXELS',
    });
    expect(normalizeLineHeight({ unit: 'PERCENT', value: 150 }, 20)).toEqual({
      px: 30,
      unit: 'PERCENT',
      percent: 150,
    });
    expect(pptLineSpacing({ px: null, unit: 'AUTO' })).toEqual({});
    expect(pptLineSpacing({ px: 40, unit: 'PIXELS' })).toEqual({ lineSpacing: 40 });
    expect(pptLineSpacing({ px: 30, unit: 'PERCENT', percent: 150 })).toEqual({
      lineSpacing: 30,
    });
  });

  it('writes OOXML spcPts / spcPct / omits AUTO', async () => {
    const pixels = await slideXml(
      text({
        lineHeight: 40,
        lineHeightUnit: 'PIXELS',
        paragraphs: [para({ start: 0, end: 6, lineHeight: { unit: 'PIXELS', value: 40 } })],
      })
    );
    expect(pixels).toContain('<a:spcPts val="4000"/>');
    expect(pixels).toContain('sz="2000"'); // default fontSize 20 → 20pt
    const percent = await slideXml(
      text({
        lineHeight: 30,
        lineHeightUnit: 'PERCENT',
        lineHeightPercent: 150,
        paragraphs: [para({ start: 0, end: 6, lineHeight: { unit: 'PERCENT', value: 150 } })],
      })
    );
    expect(percent).toContain('<a:spcPts val="3000"/>');
    const auto = await slideXml(
      text({
        lineHeight: null,
        lineHeightUnit: 'AUTO',
        paragraphs: [para({ start: 0, end: 6, lineHeight: { unit: 'AUTO' } })],
      })
    );
    expect(auto).not.toContain('<a:lnSpc>');
  });
});

describe('matrix: soft break vs real paragraphs', () => {
  it('normalizes U+2028 and soft-merges equal PIXELS rows', () => {
    expect(normalizeFigmaNewlines('a\u2028b')).toBe('a\nb');
    const source = 'one\ntwo\nthree';
    const paragraphs = buildTextParagraphs(source, [
      {
        start: 0,
        end: source.length,
        text: source,
        fontSize: 16,
        fontFamily: 'Arial',
        fontWeight: 400,
        color: '#000',
        letterSpacing: 0,
        lineHeight: { unit: 'PIXELS', value: 30 },
        paragraphSpacing: 0,
        paragraphIndent: 0,
      },
    ]);
    expect(paragraphs).toHaveLength(3);
    expect(softBreakGroups(paragraphs)).toEqual([[0], [1], [2]]);
  });

  it('keeps paragraphs separate when spacing or list differs', () => {
    const groups = softBreakGroups([
      para({ start: 0, end: 3, paragraphSpacing: 8 }),
      para({ start: 4, end: 7 }),
    ]);
    expect(groups).toEqual([[0], [1]]);
    expect(
      softBreakGroups([
        para({ start: 0, end: 3, listType: 'UNORDERED' }),
        para({ start: 4, end: 7, listType: 'UNORDERED' }),
      ])
    ).toEqual([[0], [1]]);
  });
});

describe('matrix: letter / paragraph / list spacing', () => {
  it('maps letterSpacing and listSpacing→spcAft', async () => {
    expect(paragraphSpaceAfterPx({ paragraphSpacing: 12 })).toBe(12);
    // Different LH, no SVG: explicit only (Exact on next <a:p> owns next LH).
    expect(
      paragraphBoundarySpaceAfterPx(
        { paragraphSpacing: 0, lineHeight: { unit: 'PIXELS', value: 24 } },
        { lineHeight: { unit: 'PIXELS', value: 18 } }
      )
    ).toBe(0);
    // SVG: residual = gap − nextLH (48 − 30), at least explicit 10.
    expect(
      paragraphBoundarySpaceAfterPx(
        { paragraphSpacing: 10, lineHeight: { unit: 'PIXELS', value: 30 } },
        { lineHeight: { unit: 'PIXELS', value: 30 } },
        48
      )
    ).toBe(10);
    expect(
      paragraphSpaceAfterPx({
        paragraphSpacing: 0,
        listType: 'UNORDERED',
        listSpacing: 10,
      })
    ).toBe(10);
    const xml = await slideXml(
      text({
        characters: 'Item',
        letterSpacing: 2,
        paragraphs: [
          para({
            start: 0,
            end: 4,
            listType: 'ORDERED',
            listSpacing: 16,
            paragraphSpacing: 0,
            indentation: 24,
          }),
        ],
      })
    );
    expect(xml).toContain('<a:buAutoNum type="arabicPeriod"');
    expect(xml).toContain('<a:spcAft><a:spcPts val="1600"/></a:spcAft>');
  });
});

describe('matrix: alignment and box geometry', () => {
  it('maps H/V alignment and keeps measured box + zero insets + noAutofit', async () => {
    const opts = textBoxOptions(
      text({ textAlignHorizontal: 'JUSTIFIED', textAlignVertical: 'CENTER' })
    );
    expect(opts.align).toBe('justify');
    expect(opts.valign).toBe('middle');
    expect(opts.fit).toBe('none');

    const xml = await slideXml(
      text({
        textAlignVertical: 'BOTTOM',
        textAutoResize: 'HEIGHT',
        paragraphs: [para({ start: 0, end: 6, textAlignHorizontal: 'CENTER' })],
      })
    );
    expect(xml).toContain('anchor="b"');
    expect(xml).toContain('algn="ctr"');
    expect(xml).toMatch(/lIns="0"[^>]*tIns="0"[^>]*rIns="0"[^>]*bIns="0"/);
    expect(xml).toContain('<a:noAutofit');
    expect(xml).not.toContain('<a:spAutoFit');
    // 400×100 pt → EMU (×12700)
    expect(xml).toContain('cx="5080000"');
    expect(xml).toContain('cy="1270000"');
  });
});

describe('matrix: decoration and text case', () => {
  it('maps underline / strike and case rules', async () => {
    expect(drawingMlCap('UPPER')).toBe('all');
    expect(drawingMlCap('SMALL_CAPS')).toBe('small');
    expect(requiresCharacterCaseTransform('LOWER')).toBe(true);
    expect(applyDisplayTextCase('AbC', 'LOWER')).toBe('abc');
    expect(applyDisplayTextCase('hello world', 'TITLE')).toBe('Hello World');

    const upper = await slideXml(text({ textCase: 'UPPER', characters: 'Ab' }));
    expect(upper).toMatch(/cap="all"/);
    expect(upper).toContain('<a:t>Ab</a:t>');

    const lower = await slideXml(text({ textCase: 'LOWER', characters: 'AbC' }));
    expect(lower).toContain('<a:t>abc</a:t>');
  });

  it('emits underline and italic from style name', () => {
    const runs = textRuns(
      text({
        runs: [
          {
            text: 'x',
            fontSize: 16,
            fontFamily: 'Arial',
            fontStyle: 'Bold Italic',
            fontWeight: 700,
            color: '#000',
            letterSpacing: 0,
            underline: true,
            strikethrough: true,
          },
        ],
      })
    );
    expect(runs[0].options.underline).toBe(true);
    expect(runs[0].options.strike).toBe(true);
    expect(runs[0].options.italic).toBe(true);
  });
});

describe('matrix: opacity / color', () => {
  it('keeps source RGB and maps opacity to run transparency', () => {
    const runs = textRuns(text({ opacity: 0.5, color: '#FFFFFF', characters: 'x' }), '#000000');
    expect(runs[0].options.color).toBe('FFFFFF');
    expect(runs[0].options.transparency).toBe(50);
  });
});

describe('matrix: native editability', () => {
  it('produces a single editable text box for soft-broken multi-line body', async () => {
    const characters = 'line1\nline2\nline3';
    const xml = await slideXml(
      text({
        characters,
        paragraphs: [
          para({ start: 0, end: 5 }),
          para({ start: 6, end: 11 }),
          para({ start: 12, end: 17 }),
        ],
      })
    );
    expect(xml.match(/<p:cNvSpPr txBox="1"\/>/g)).toHaveLength(1);
    expect(xml).not.toContain('<a:br/>');
    expect(xml).not.toContain('<p:pic>');
  });
});
