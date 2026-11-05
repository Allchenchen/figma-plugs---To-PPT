/**
 * R-TXT-27 — explicit Figma breaks must survive Reader → IR → OOXML.
 */
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createPptx } from '../src/converter/converter';
import { postProcessPptx } from '../src/converter/postprocess';
import { softBreakGroups } from '../src/converter/text-paragraphs';
import { explicitBreakCount, textRuns } from '../src/converter/text';
import {
  buildTextParagraphs,
  formatCharactersForLog,
  normalizeTextWithBoundaries,
} from '../src/reader/text-model';
import type { ExportOptions, IRDocument, IRText, IRTextParagraph, IRTextRun } from '../src/ir/types';

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

function text(overrides: Partial<IRText> = {}): IRText {
  return {
    id: 'b1',
    type: 'text',
    rect: { x: 40, y: 40, width: 600, height: 200 },
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    characters: '',
    fontSize: 16,
    fontFamily: 'PingFang SC',
    fontWeight: 400,
    color: '#111111',
    letterSpacing: 0,
    lineHeight: 24,
    lineHeightUnit: 'PIXELS',
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
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
        backgroundColor: '#FFFFFF',
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

describe('R-TXT-27 explicit break pipeline', () => {
  it('keeps breakLine count equal to boundary count when runs omit newlines', () => {
    const characters = '第一行\n第二行\n第三行';
    const { boundaries } = normalizeTextWithBoundaries(characters);
    // Runs omit `\n` but start/end stay in character space (gaps at newline indexes).
    const runs: IRTextRun[] = [
      {
        text: '第一行',
        start: 0,
        end: 3,
        fontSize: 16,
        fontFamily: 'PingFang SC',
        fontWeight: 400,
        color: '#000',
        letterSpacing: 0,
      },
      {
        text: '第二行',
        start: 4,
        end: 7,
        fontSize: 16,
        fontFamily: 'PingFang SC',
        fontWeight: 400,
        color: '#000',
        letterSpacing: 0,
      },
      {
        text: '第三行',
        start: 8,
        end: 11,
        fontSize: 16,
        fontFamily: 'PingFang SC',
        fontWeight: 400,
        color: '#000',
        letterSpacing: 0,
      },
    ];
    const layer = text({
      characters,
      boundaries,
      runs,
      paragraphs: buildTextParagraphs(characters, [], 'LEFT', boundaries),
    });
    expect(formatCharactersForLog(layer.characters)).toBe('第一行\\n第二行\\n第三行');
    expect(explicitBreakCount(layer)).toBe(2);
    expect(runs.map((r) => r.text).join('')).not.toContain('\n');
    const emitted = textRuns(layer);
    expect(emitted.filter((r) => r.options.breakLine).length).toBe(2);
    expect(emitted.map((r) => r.text).join('|')).toBe('第一行|第二行|第三行');
  });

  it('preserves consecutive and trailing newlines in IR boundaries', () => {
    const raw = 'A\n\nB\n';
    const { characters, boundaries } = normalizeTextWithBoundaries(raw);
    expect(characters).toBe('A\n\nB\n');
    expect(boundaries).toHaveLength(3);
    expect(boundaries.map((b) => b.sourceCharacter)).toEqual(['\\n', '\\n', '\\n']);
    const paragraphs = buildTextParagraphs(characters, [], 'LEFT', boundaries);
    expect(paragraphs.map((p) => [p.start, p.end])).toEqual([
      [0, 1],
      [2, 2],
      [3, 4],
      [5, 5],
    ]);
  });

  it('emits softBreak as <a:br/> and keeps paragraphBreak as separate <a:p> when spacing > 0', async () => {
    const characters = '软换行上\n软换行下\n段落后';
    const { boundaries } = normalizeTextWithBoundaries('软换行上\u2028软换行下\n段落后');
    expect(boundaries.map((b) => b.kind)).toEqual(['softBreak', 'paragraphBreak']);
    const paragraphs = [
      para({ start: 0, end: 4, breakAfter: 'softBreak', paragraphSpacing: 0 }),
      para({ start: 5, end: 9, breakAfter: 'paragraphBreak', paragraphSpacing: 12 }),
      para({ start: 10, end: 13, paragraphSpacing: 0 }),
    ];
    expect(softBreakGroups(paragraphs)).toEqual([[0, 1], [2]]);

    const xml = await slideXml(
      text({
        characters,
        boundaries,
        paragraphs,
      })
    );
    expect(xml).toContain('<a:br/>');
    expect(xml).toContain('<a:t>软换行上</a:t>');
    expect(xml).toContain('<a:t>软换行下</a:t>');
    expect(xml).toContain('<a:t>段落后</a:t>');
    expect(xml).toContain('txBox="1"');
    // paragraphSpacing 12 → spcAft on the soft-break group
    expect(xml).toContain('<a:spcAft>');
  });

  it('does not drop mixed-style runs across an explicit newline', async () => {
    const characters = 'Bold\nNormal';
    const { boundaries } = normalizeTextWithBoundaries(characters);
    const xml = await slideXml(
      text({
        characters,
        boundaries,
        runs: [
          {
            text: 'Bold\n',
            start: 0,
            end: 5,
            fontSize: 20,
            fontFamily: 'Inter',
            fontWeight: 700,
            color: '#000000',
            letterSpacing: 0,
          },
          {
            text: 'Normal',
            start: 5,
            end: 11,
            fontSize: 16,
            fontFamily: 'Inter',
            fontWeight: 400,
            color: '#333333',
            letterSpacing: 0,
          },
        ],
        paragraphs: [
          para({
            start: 0,
            end: 4,
            breakAfter: 'paragraphBreak',
            lineHeight: { unit: 'PIXELS', value: 28 },
          }),
          para({ start: 5, end: 11, lineHeight: { unit: 'PIXELS', value: 28 } }),
        ],
      })
    );
    expect(xml).toContain('<a:t>Bold</a:t>');
    expect(xml).toContain('<a:t>Normal</a:t>');
    expect(xml).toMatch(/sz="2000"/);
    expect(xml).toMatch(/sz="1600"/);
  });

  it('uses character breaks when runs under-count newlines (partial loss)', () => {
    // characters have 2 breaks; runs only embed 1 — must not drop the second.
    const characters = 'AAA\nBBB\nCCC';
    const { boundaries } = normalizeTextWithBoundaries(characters);
    const emitted = textRuns(
      text({
        characters,
        boundaries,
        runs: [
          {
            text: 'AAA\nBBBCCC',
            start: 0,
            end: 10,
            fontSize: 16,
            fontFamily: 'Inter',
            fontWeight: 400,
            color: '#000',
            letterSpacing: 0,
          },
        ],
        paragraphs: buildTextParagraphs(characters, [], 'LEFT', boundaries),
      })
    );
    expect(emitted.filter((r) => r.options.breakLine).length).toBe(2);
    expect(emitted.map((r) => r.text)).toEqual(['AAA', 'BBB', 'CCC']);
  });

  it('preserves blank soft-break rows and leading spaces in OOXML (no trim drop)', async () => {
    const characters = '  首行\n\n  末行';
    const { boundaries } = normalizeTextWithBoundaries(characters);
    const paragraphs = [
      para({
        start: 0,
        end: 4,
        breakAfter: 'softBreak',
        lineHeight: { unit: 'PIXELS', value: 30 },
      }),
      para({
        start: 5,
        end: 5,
        breakAfter: 'softBreak',
        lineHeight: { unit: 'PIXELS', value: 30 },
      }),
      para({ start: 6, end: 10, lineHeight: { unit: 'PIXELS', value: 30 } }),
    ];
    expect(softBreakGroups(paragraphs)).toEqual([[0, 1, 2]]);
    const xml = await slideXml(
      text({
        characters,
        boundaries,
        paragraphs,
        lineHeight: 30,
        lineHeightUnit: 'PIXELS',
      })
    );
    // Two soft breaks → at least two <a:br/>; blank row must not be trimmed away.
    expect((xml.match(/<a:br\/>/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(xml).toContain('<a:t>  首行</a:t>');
    expect(xml).toContain('<a:t>  末行</a:t>');
    // Reconstruct plain text from paragraph + br structure.
    const rebuilt = [...xml.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)]
      .map((m) => m[0])
      .filter((p) => /<a:t>/.test(p) || /<a:br\/>/.test(p))
      .map((p) =>
        p
          .replace(/<a:br\s*\/>/g, '\n')
          .replace(/<a:t>([^<]*)<\/a:t>/g, '$1')
          .replace(/<[^>]+>/g, '')
      )
      .join('\n');
    expect(rebuilt).toContain('  首行');
    expect(rebuilt).toContain('  末行');
    expect(rebuilt.split('\n').length).toBeGreaterThanOrEqual(3);
  });
});
