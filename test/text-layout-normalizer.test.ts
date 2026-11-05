import { describe, it, expect } from 'vitest';
import {
  normalizeLineHeight,
  pptLineSpacing,
  pptParaSpaceAfter,
  pptFontSize,
  pptBold,
  mapFontFace,
  pptTextMargin,
} from '../src/converter/text-layout';
import { textBoxOptions, textOptions, textRenderFragments, textRuns } from '../src/converter/text';
import type { IRText } from '../src/ir/types';

function text(overrides: Partial<IRText> = {}): IRText {
  return {
    id: 't',
    type: 'text',
    rect: { x: 10, y: 20, width: 400, height: 200 },
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    characters: 'a\nb\nc',
    fontSize: 16,
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

describe('normalizeLineHeight', () => {
  it('AUTO → null px', () => {
    expect(normalizeLineHeight({ unit: 'AUTO' }, 16)).toEqual({ px: null, unit: 'AUTO' });
  });

  it('PERCENT preserves percent and computes px', () => {
    expect(normalizeLineHeight({ unit: 'PERCENT', value: 150 }, 16)).toEqual({
      px: 24,
      unit: 'PERCENT',
      percent: 150,
    });
  });

  it('PIXELS keeps absolute px', () => {
    expect(normalizeLineHeight({ unit: 'PIXELS', value: 28 }, 16)).toEqual({
      px: 28,
      unit: 'PIXELS',
    });
  });
});

describe('pptLineSpacing (Exact points)', () => {
  it('PERCENT → Exact pt from fontSize × percent', () => {
    const ir = normalizeLineHeight({ unit: 'PERCENT', value: 160 }, 14);
    expect(pptLineSpacing(ir)).toEqual({ lineSpacing: 22.4 });
  });

  it('PIXELS → Exact lineSpacing in pt (1:1)', () => {
    expect(pptLineSpacing({ px: 24, unit: 'PIXELS' })).toEqual({ lineSpacing: 24 });
  });

  it('AUTO → no invented numeric spacing', () => {
    expect(pptLineSpacing({ px: null, unit: 'AUTO' })).toEqual({});
  });

  it('MIXED → no invalid global spacing', () => {
    expect(pptLineSpacing({ px: null, unit: 'MIXED' })).toEqual({});
  });
});

describe('paragraph / font / margin helpers', () => {
  it('maps paragraphSpacing px → paraSpaceAfter pt', () => {
    expect(pptParaSpaceAfter(24)).toBe(24);
    expect(pptParaSpaceAfter(0)).toBeUndefined();
    expect(pptParaSpaceAfter(null)).toBeUndefined();
  });

  it('maps fontSize 1:1 after page scale (panel number as pt)', () => {
    expect(pptFontSize(32)).toBe(32);
    expect(pptFontSize(18)).toBe(18);
    expect(pptFontSize(16)).toBe(16);
  });

  it('bold threshold ≥600', () => {
    expect(pptBold(400)).toBe(false);
    expect(pptBold(500)).toBe(false);
    expect(pptBold(600)).toBe(true);
    expect(pptBold(700)).toBe(true);
  });

  it('margin tuple is [left, right, bottom, top] in points', () => {
    expect(pptTextMargin()).toEqual([0, 0, 0, 0]);
    expect(pptTextMargin(12, 0, 0, 0)).toEqual([0, 0, 0, 12]);
  });

  it('preserves source font names instead of silently substituting metrics', () => {
    expect(mapFontFace('Inter')).toBe('Inter');
    expect(mapFontFace('PingFang SC')).toBe('PingFang SC');
    expect(mapFontFace('Arial')).toBe('Arial');
  });
});

describe('textBoxOptions uses Normalizer', () => {
  it('never writes percentage line height at TextBox level', () => {
    const opts = textBoxOptions(
      text({
        lineHeight: 24,
        lineHeightUnit: 'PERCENT',
        lineHeightPercent: 150,
        fontSize: 16,
      })
    );
    expect(opts.lineSpacingMultiple).toBeUndefined();
    expect(opts.lineSpacing).toBeUndefined();
  });

  it('does not emit legacy text-box spacing when Paragraph IR is present', () => {
    const opts = textBoxOptions(
      text({
        lineHeight: 24,
        lineHeightUnit: 'PIXELS',
        paragraphSpacing: 12,
        paragraphs: [
          {
            start: 0,
            end: 1,
            lineHeight: { unit: 'PIXELS', value: 24 },
            mixedLineHeight: false,
            paragraphSpacing: 12,
            paragraphIndent: 0,
            textAlignHorizontal: 'LEFT',
          },
        ],
      })
    );
    expect(opts.lineSpacing).toBeUndefined();
    expect(opts.lineSpacingMultiple).toBeUndefined();
    expect(opts.paraSpaceAfter).toBeUndefined();
  });

  it('never writes exact line height at TextBox level', () => {
    const opts = textBoxOptions(
      text({ lineHeight: 24, lineHeightUnit: 'PIXELS', fontSize: 16 })
    );
    expect(opts.lineSpacing).toBeUndefined();
    expect(opts.lineSpacingMultiple).toBeUndefined();
  });

  it('sets zero margin and isTextBox', () => {
    const opts = textBoxOptions(text());
    expect(opts.margin).toEqual([0, 0, 0, 0]);
    expect(opts.isTextBox).toBe(true);
    expect(opts.fit).toBe('none');
    expect(opts.shrinkText).toBeUndefined();
  });

  it('never writes paragraph spacing at TextBox level', () => {
    expect(textBoxOptions(text({ paragraphSpacing: 16 })).paraSpaceAfter).toBeUndefined();
  });

  it('align / valign', () => {
    expect(textOptions(text({ textAlignHorizontal: 'RIGHT' })).align).toBe('right');
    expect(textOptions(text({ textAlignVertical: 'CENTER' })).valign).toBe('middle');
  });

  it('maps cumulative text rotation to the native PowerPoint text shape', () => {
    expect(textBoxOptions(text({ rotation: 32 })).rotate).toBe(32);
  });

  it('expands newlines to breakLine items (pptxgenjs paragraph splits)', () => {
    const runs = textRuns(text({ characters: '一\n二\n三' }));
    expect(runs).toHaveLength(3);
    expect(runs.map((r) => r.text)).toEqual(['一', '二', '三']);
    expect(runs[0].options.breakLine).toBe(true);
    expect(runs[1].options.breakLine).toBe(true);
    expect(runs[2].options.breakLine).toBeUndefined();
  });

  it('preserves Inter fontFace via Normalizer', () => {
    const runs = textRuns(text({ fontFamily: 'Inter' }));
    expect(runs[0].options.fontFace).toBe('Inter');
  });

  it('preserves italic at run level', () => {
    const runs = textRuns(
      text({
        runs: [
          {
            start: 0,
            end: 1,
            text: 'a',
            fontSize: 16,
            fontFamily: 'Inter',
            fontWeight: 400,
            color: '#000000',
            letterSpacing: 0,
            italic: true,
          },
        ],
      })
    );
    expect(runs[0].options.italic).toBe(true);
  });

  it('preserves Figma geometry instead of enabling PowerPoint shape autofit', () => {
    expect(textBoxOptions(text({ textAutoResize: 'WIDTH_AND_HEIGHT' })).fit).toBe('none');
    expect(textBoxOptions(text({ textAutoResize: 'HEIGHT' })).fit).toBe('none');
    expect(textBoxOptions(text({ textAutoResize: 'NONE' })).fit).toBe('none');
  });
});

describe('mixed line-height layout policy (plan constraints)', () => {
  it('does not invent box-level lineSpacing from paragraph IR', () => {
    const opts = textBoxOptions(
      text({
        characters: '甲\n乙',
        lineHeight: 24,
        lineHeightUnit: 'PIXELS',
        paragraphs: [
          {
            start: 0,
            end: 1,
            lineHeight: { unit: 'PIXELS', value: 30 },
            mixedLineHeight: false,
            paragraphSpacing: 0,
            paragraphIndent: 0,
          },
          {
            start: 2,
            end: 3,
            lineHeight: { unit: 'PERCENT', value: 150 },
            mixedLineHeight: false,
            paragraphSpacing: 0,
            paragraphIndent: 0,
          },
        ],
      })
    );
    expect(opts.lineSpacing).toBeUndefined();
    expect(opts.lineSpacingMultiple).toBeUndefined();
  });

  it('keeps a single fragment for cross-paragraph different line heights', () => {
    const layer = text({
      characters: 'A\nB',
      paragraphs: [
        {
          start: 0,
          end: 1,
          lineHeight: { unit: 'PIXELS', value: 24 },
          mixedLineHeight: false,
          paragraphSpacing: 0,
          paragraphIndent: 0,
        },
        {
          start: 2,
          end: 3,
          lineHeight: { unit: 'PIXELS', value: 40 },
          mixedLineHeight: false,
          paragraphSpacing: 0,
          paragraphIndent: 0,
        },
      ],
    });
    expect(textRenderFragments(layer)).toHaveLength(1);
  });
});
