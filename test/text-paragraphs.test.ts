import { describe, it, expect } from 'vitest';
import {
  canJoinAsSoftBreak,
  collapsedParagraphMetrics,
  paragraphMetricsForInjection,
  resolveTextParagraphs,
  softBreakGroups,
} from '../src/converter/text-paragraphs';
import type { IRText, IRTextParagraph } from '../src/ir/types';

function para(overrides: Partial<IRTextParagraph> & Pick<IRTextParagraph, 'start' | 'end'>): IRTextParagraph {
  return {
    lineHeight: { unit: 'PIXELS', value: 40 },
    mixedLineHeight: false,
    paragraphSpacing: 0,
    paragraphIndent: 0,
    textAlignHorizontal: 'LEFT',
    ...overrides,
  };
}

describe('soft-break paragraph grouping', () => {
  it('joins auto-wrapped lines marked as soft breaks', () => {
    const paragraphs = [
      para({ start: 0, end: 21, breakAfter: 'softBreak' }),
      para({ start: 22, end: 37 }),
    ];
    expect(canJoinAsSoftBreak(paragraphs[0], paragraphs[1])).toBe(true);
    expect(softBreakGroups(paragraphs)).toEqual([[0, 1]]);
    expect(collapsedParagraphMetrics(paragraphs)).toEqual([
      expect.objectContaining({
        start: 0,
        end: 37,
        lineHeight: { unit: 'PIXELS', value: 40 },
        // Single soft-break group — no following group, space-after stays 0.
        paragraphSpacing: 0,
      }),
    ]);
  });

  it('does not fold next PIXELS LH into spcAft (avoids Exact double-count / overflow)', () => {
    const paragraphs = [
      para({ start: 0, end: 3, lineHeight: { unit: 'PIXELS', value: 22.5 }, paragraphSpacing: 0 }),
      para({ start: 4, end: 7, lineHeight: { unit: 'PIXELS', value: 15 }, paragraphSpacing: 8 }),
      para({ start: 8, end: 11, lineHeight: { unit: 'PIXELS', value: 22.5 }, paragraphSpacing: 0 }),
    ];
    expect(softBreakGroups(paragraphs)).toEqual([[0], [1], [2]]);
    const metrics = collapsedParagraphMetrics(paragraphs);
    // Each <a:p> keeps Exact lnSpc; spcAft is Figma paragraphSpacing only.
    expect(metrics[0].paragraphSpacing).toBe(0);
    expect(metrics[1].paragraphSpacing).toBe(8);
    expect(metrics[2].paragraphSpacing).toBe(0);
  });

  it('keeps Enter as its own paragraph even when paragraph spacing is 0', () => {
    const paragraphs = [
      para({ start: 0, end: 3, breakAfter: 'paragraphBreak', paragraphSpacing: 0 }),
      para({ start: 4, end: 7, paragraphSpacing: 0 }),
    ];
    expect(canJoinAsSoftBreak(paragraphs[0], paragraphs[1])).toBe(false);
    expect(softBreakGroups(paragraphs)).toEqual([[0], [1]]);
  });

  it('does not fold the visual gap into paragraph spacing', () => {
    const paragraphs = [
      para({ start: 0, end: 3, lineHeight: { unit: 'PIXELS', value: 20 }, paragraphSpacing: 0 }),
      para({ start: 4, end: 7, lineHeight: { unit: 'PIXELS', value: 40 }, paragraphSpacing: 0 }),
    ];
    const metrics = collapsedParagraphMetrics(paragraphs, [
      { start: 0, end: 3, text: 'AAA', x: 0, baselineY: 10, paragraphIndex: 0 },
      { start: 4, end: 7, text: 'BBB', x: 0, baselineY: 55, paragraphIndex: 1 },
    ]);
    expect(metrics[0].paragraphSpacing).toBe(0);
  });

  it('does not soft-join when paragraphSpacing is null (mixed/unknown)', () => {
    expect(
      canJoinAsSoftBreak(
        para({ start: 0, end: 3, paragraphSpacing: null }),
        para({ start: 4, end: 7 })
      )
    ).toBe(false);
  });

  it('does not soft-join softBreak rows with different line heights', () => {
    expect(
      canJoinAsSoftBreak(
        para({
          start: 0,
          end: 3,
          breakAfter: 'softBreak',
          lineHeight: { unit: 'PIXELS', value: 30 },
        }),
        para({ start: 4, end: 7, lineHeight: { unit: 'PIXELS', value: 20 } })
      )
    ).toBe(false);
  });

  it('zero paragraphSpacing + same LH soft-joins only when marked softBreak', () => {
    const paragraphs = [
      para({ start: 0, end: 5, paragraphSpacing: 0, breakAfter: 'softBreak' }),
      para({ start: 6, end: 11, paragraphSpacing: 0, breakAfter: 'softBreak' }),
      para({ start: 12, end: 17, paragraphSpacing: 0, breakAfter: 'softBreak' }),
      para({ start: 18, end: 23, paragraphSpacing: 0 }),
    ];
    expect(softBreakGroups(paragraphs)).toEqual([[0, 1, 2, 3]]);
    const metrics = collapsedParagraphMetrics(paragraphs);
    expect(metrics).toHaveLength(1);
    expect(metrics[0].paragraphSpacing).toBe(0);
    expect(metrics[0].lineHeight).toEqual({ unit: 'PIXELS', value: 40 });
  });

  it('non-zero paragraphSpacing keeps separate groups and maps explicit spacing only', () => {
    const paragraphs = [
      para({ start: 0, end: 3, paragraphSpacing: 12 }),
      para({ start: 4, end: 7, paragraphSpacing: 0 }),
    ];
    expect(softBreakGroups(paragraphs)).toEqual([[0], [1]]);
    expect(collapsedParagraphMetrics(paragraphs)[0].paragraphSpacing).toBe(12);
  });

  it('unmerged injection keeps per-paragraph line heights without nextLH fold', () => {
    const paragraphs = [
      para({ start: 0, end: 3, lineHeight: { unit: 'PIXELS', value: 30 }, paragraphSpacing: 10 }),
      para({ start: 4, end: 7, lineHeight: { unit: 'PIXELS', value: 20 }, paragraphSpacing: 10 }),
      para({ start: 8, end: 11, lineHeight: { unit: 'PIXELS', value: 30 }, paragraphSpacing: 0 }),
    ];
    const unmerged = paragraphMetricsForInjection(paragraphs, undefined, false);
    expect(unmerged).toHaveLength(3);
    expect(unmerged.map((p) => p.lineHeight)).toEqual([
      { unit: 'PIXELS', value: 30 },
      { unit: 'PIXELS', value: 20 },
      { unit: 'PIXELS', value: 30 },
    ]);
    expect(unmerged[0].paragraphSpacing).toBe(10);
    expect(unmerged[1].paragraphSpacing).toBe(10);
    expect(unmerged[2].paragraphSpacing).toBe(0);
  });

  it('keeps real paragraph breaks for spacing, lists, empty lines and mixed metrics', () => {
    expect(
      canJoinAsSoftBreak(
        para({ start: 0, end: 3, paragraphSpacing: 12 }),
        para({ start: 4, end: 7 })
      )
    ).toBe(false);
    expect(
      canJoinAsSoftBreak(
        para({ start: 0, end: 3, listType: 'UNORDERED' }),
        para({ start: 4, end: 7 })
      )
    ).toBe(false);
    expect(
      canJoinAsSoftBreak(para({ start: 0, end: 0 }), para({ start: 1, end: 4 }))
    ).toBe(false);
    expect(
      softBreakGroups([
        para({ start: 0, end: 3, lineHeight: { unit: 'PIXELS', value: 24 } }),
        para({ start: 4, end: 7, lineHeight: { unit: 'PERCENT', value: 150 }, paragraphSpacing: 6 }),
      ])
    ).toEqual([[0], [1]]);
  });
});

describe('resolveTextParagraphs fallback', () => {
  it('splits on newlines when Paragraph IR is absent', () => {
    const layer = {
      characters: 'a\nb',
      fontSize: 16,
      lineHeight: 24,
      lineHeightUnit: 'PIXELS' as const,
      paragraphSpacing: 0,
      paragraphIndent: 0,
      textAlignHorizontal: 'LEFT' as const,
    } as IRText;
    const paragraphs = resolveTextParagraphs(layer);
    expect(paragraphs.map((p) => [p.start, p.end])).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(softBreakGroups(paragraphs)).toEqual([[0], [1]]);
  });

  it('prefers explicit Paragraph IR', () => {
    const paragraphs = resolveTextParagraphs({
      characters: 'a\nb',
      paragraphs: [para({ start: 0, end: 1 }), para({ start: 2, end: 3, paragraphSpacing: 8 })],
    } as IRText);
    expect(paragraphs[1].paragraphSpacing).toBe(8);
  });
});
