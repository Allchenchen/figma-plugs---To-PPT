import { describe, expect, it } from 'vitest';
import {
  buildTextParagraphs,
  decideMixedLineHeightRender,
  formatCharactersForLog,
  normalizeFigmaNewlines,
  normalizeTextWithBoundaries,
  parseSvgVisualLines,
  sliceTextRuns,
  textRunsFromSegments,
  type TextSegmentInput,
} from '../src/reader/text-model';
import { softBreakGroups } from '../src/converter/text-paragraphs';
import type { IRTextLineHeight } from '../src/ir/types';

function run(
  start: number,
  end: number,
  text: string,
  lineHeight: IRTextLineHeight
): TextSegmentInput {
  return {
    start,
    end,
    text,
    fontSize: 16,
    fontFamily: 'Inter',
    fontWeight: 400,
    color: '#000000',
    letterSpacing: 0,
    lineHeight,
    paragraphSpacing: 0,
    paragraphIndent: 0,
  };
}

describe('three-level text model', () => {
  it('normalizes U+2028/U+2029 to LF', () => {
    expect(normalizeFigmaNewlines('a\u2028b\u2029c')).toBe('a\nb\nc');
  });

  it('records explicit boundaries with escaped source characters', () => {
    const { characters, boundaries } = normalizeTextWithBoundaries('a\u2028b\r\nc\n');
    expect(characters).toBe('a\nb\nc\n');
    expect(formatCharactersForLog(characters)).toBe('a\\nb\\nc\\n');
    expect(boundaries).toEqual([
      expect.objectContaining({
        index: 1,
        sourceIndex: 1,
        kind: 'softBreak',
        sourceCharacter: '\\u2028',
      }),
      expect.objectContaining({
        index: 3,
        sourceIndex: 3,
        sourceLength: 2,
        kind: 'paragraphBreak',
        sourceCharacter: '\\r\\n',
      }),
      expect.objectContaining({
        index: 5,
        kind: 'paragraphBreak',
        sourceCharacter: '\\n',
      }),
    ]);
  });

  it('builds logical paragraphs without including newline characters', () => {
    const source = '第一段\nSecond';
    const runs = [run(0, 4, '第一段\n', { unit: 'PIXELS', value: 24 }), run(4, 10, 'Second', { unit: 'PERCENT', value: 150 })];

    expect(buildTextParagraphs(source, runs)).toEqual([
      expect.objectContaining({
        start: 0,
        end: 3,
        lineHeight: { unit: 'PIXELS', value: 24 },
        mixedLineHeight: false,
        breakAfter: 'paragraphBreak',
      }),
      expect.objectContaining({ start: 4, end: 10, lineHeight: { unit: 'PERCENT', value: 150 }, mixedLineHeight: false }),
    ]);
  });

  it('marks U+2028 as softBreak and joins equal-metric rows to <a:br/>', () => {
    const source = 'line1\u2028line2\u2028line3';
    const runs = [run(0, source.length, source, { unit: 'PIXELS', value: 40 })];
    const paragraphs = buildTextParagraphs(source, runs);
    const normalized = normalizeFigmaNewlines(source);
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs.map((p) => normalized.slice(p.start, p.end))).toEqual([
      'line1',
      'line2',
      'line3',
    ]);
    expect(paragraphs.map((p) => p.breakAfter)).toEqual(['softBreak', 'softBreak', undefined]);
    expect(softBreakGroups(paragraphs)).toEqual([[0, 1, 2]]);
  });

  it('uses UTF-16 ranges so emoji is never split into invalid halves', () => {
    const source = 'A😀中';
    const runs = [
      run(0, 1, 'A', { unit: 'PIXELS', value: 20 }),
      run(1, 3, '😀', { unit: 'PIXELS', value: 24 }),
      run(3, 4, '中', { unit: 'PIXELS', value: 20 }),
    ];

    const sliced = sliceTextRuns(runs, 1, 4);
    expect(sliced.map((item) => item.text).join('')).toBe('😀中');
    expect(sliced).toEqual([
      expect.objectContaining({ start: 0, end: 2, text: '😀' }),
      expect.objectContaining({ start: 2, end: 3, text: '中' }),
    ]);
  });

  it('keeps paragraph metrics out of persisted TextRun IR', () => {
    const [textRun] = textRunsFromSegments([
      run(0, 1, 'A', { unit: 'PIXELS', value: 24 }),
    ]);
    expect(textRun).not.toHaveProperty('lineHeight');
    expect(textRun).not.toHaveProperty('paragraphSpacing');
    expect(textRun).not.toHaveProperty('paragraphIndent');
  });

  it('keeps alignment, indentation and list metadata at Paragraph level', () => {
    const segment = {
      ...run(0, 4, 'Item', { unit: 'PERCENT', value: 140 }),
      listType: 'UNORDERED' as const,
      listSpacing: 8,
      indentation: 24,
      paragraphIndent: 6,
    };
    expect(buildTextParagraphs('Item', [segment], 'RIGHT')[0]).toEqual(
      expect.objectContaining({
        textAlignHorizontal: 'RIGHT',
        listType: 'UNORDERED',
        listSpacing: 8,
        indentation: 24,
        paragraphIndent: 6,
      })
    );
  });

  it('preserves Figma leading trim as paragraph layout metadata', () => {
    const segment = {
      ...run(0, 4, 'Trim', { unit: 'PIXELS', value: 24 }),
      leadingTrim: 'CAP_HEIGHT' as const,
    };
    expect(buildTextParagraphs('Trim', [segment])[0].leadingTrim).toBe('CAP_HEIGHT');
    expect(textRunsFromSegments([segment])[0]).not.toHaveProperty('leadingTrim');
  });

  it('extracts and groups styled tspans into exact visual lines', () => {
    const svg = `<svg viewBox="0 0 200 80"><text x="4" y="18"><tspan x="4" y="18">Hello </tspan><tspan>世界</tspan><tspan x="4" y="46">Next</tspan></text></svg>`;
    const result = parseSvgVisualLines(svg, 'Hello 世界Next');

    expect(result.status).toBe('exact');
    expect(result.viewBox).toEqual({ x: 0, y: 0, width: 200, height: 80 });
    expect(result.lines).toEqual([
      expect.objectContaining({
        start: 0,
        end: 8,
        text: 'Hello 世界',
        x: 4,
        baselineY: 18,
        lineHeightPx: 28,
      }),
      expect.objectContaining({ start: 8, end: 12, text: 'Next', x: 4, baselineY: 46 }),
    ]);
  });

  it('keeps Insight soft-wrap rows when SVG emits distinct baselines', () => {
    const a = '慥螎谥頠纄愚奃、嬅掹嘔澁奷嘓嘚暦';
    const b = '纄箯悃琛廴，';
    const c = '港尸朕睜弨堙頉嚺纄漀瀸柃廠蔠';
    const source = `${a}${b}\n${c}`;
    const svg = `<svg viewBox="0 0 400 100"><text>
      <tspan x="0" y="20">${a}</tspan>
      <tspan x="0" y="48">${b}</tspan>
      <tspan x="0" y="88">${c}</tspan>
    </text></svg>`;
    const result = parseSvgVisualLines(svg, source);
    expect(result.status).toBe('exact');
    expect(result.lines.map((line) => line.text)).toEqual([a, b, c]);
    expect(result.lines[0]!.paragraphIndex).toBe(0);
    expect(result.lines[1]!.paragraphIndex).toBe(0);
    expect(result.lines[2]!.paragraphIndex).toBe(1);
  });

  it('does not turn the break drawn at the end of a tspan into a blank row', () => {
    const lines = [
      '囥“揻橾舀漉媨穩”嘺娛椏嘻亘，',
      '樑囬搆甞揟娰纄峁穌穹锨曶摕嘺嚔嘪瀸柃囷堼釂，',
      '晶嘺珏嘀臍囷堼镋嚈嘀嘪奨涰纄“舀漉媨穩”杢鑡，坜嘺釆釉麐嶻。',
      '鎩実漬檽鑡纄涇嬖寘林寯釁、寯椟，囎蠌尸朕缟獣慑專纄嚺媠奥奶嘭。',
    ];
    const raw = `${lines[0]}\u2028${lines[1]}\u2028${lines[2]}\n${lines[3]}`;
    const { characters, boundaries } = normalizeTextWithBoundaries(raw);
    const svg = `<svg viewBox="0 0 748 160"><text>
      <tspan x="0" y="20">${lines[0]}&#x2028;</tspan>
      <tspan x="0" y="60">${lines[1]}&#x2028;</tspan>
      <tspan x="0" y="100">${lines[2]}&#10;</tspan>
      <tspan x="0" y="140">${lines[3]}</tspan>
    </text></svg>`;
    const result = parseSvgVisualLines(svg, characters, boundaries);
    expect(result.status).toBe('exact');
    expect(result.lines.map((line) => line.text)).toEqual(lines);
    expect(result.lines.map((line) => line.paragraphIndex)).toEqual([0, 0, 0, 1]);
    expect(result.lines.map((line) => line.lineHeightPx)).toEqual([40, 40, 40, undefined]);
  });

  it('keeps a real blank row when two breaks have no glyphs between them', () => {
    const source = '甲\n\n乙';
    const svg = `<svg viewBox="0 0 100 90"><text>
      <tspan x="0" y="20">甲&#10;&#10;</tspan>
      <tspan x="0" y="80">乙</tspan>
    </text></svg>`;
    const result = parseSvgVisualLines(svg, source);
    expect(result.status).toBe('exact');
    expect(result.lines.map((line) => line.text)).toEqual(['甲', '', '乙']);
  });

  it('does not insert a blank row when Enter is drawn at the end of the first tspan', () => {
    const source = '慥螎谥頠纄愚奃、嬅掹嘔澁奷嘓嘚暦纄箯悃琛廴，\n港尸朕睜弨堙頉嚺纄漀瀸柃廠蔠';
    const svg = `<svg viewBox="0 0 425 80"><text>
      <tspan x="0" y="16.74">慥螎谥頠纄愚奃、嬅掹嘔澁奷嘓嘚暦纄箯悃琛廴，&#10;</tspan>
      <tspan x="0" y="56.74">港尸朕睜弨堙頉嚺纄漀瀸柃廠蔠</tspan>
    </text></svg>`;
    const result = parseSvgVisualLines(svg, source);
    expect(result.status).toBe('exact');
    expect(result.lines.map((line) => line.text)).toEqual([
      '慥螎谥頠纄愚奃、嬅掹嘔澁奷嘓嘚暦纄箯悃琛廴，',
      '港尸朕睜弨堙頉嚺纄漀瀸柃廠蔠',
    ]);
    expect(result.lines.map((line) => line.paragraphIndex)).toEqual([0, 1]);
  });

  it('does not advance the paragraph index on U+2028', () => {
    const lines = [
      '囥“揻橾舀漉媨穩”嘺娛椏嘻亘，',
      '樑囬搆甞揟娰纄峁穌穹锨曶摕嘺嚔嘪瀸柃囷堼釂，',
      '晶嘺珏嘀臍囷堼镋嚈嘀嘪奨涰纄“舀漉媨穩”杢鑡，坜嘺釆釉麐嶻。',
      '鎩実漬檽鑡纄涇嬖寘林寯釁、寯椟，囎蠌尸朕缟獣慑專纄嚺媠奥奶嘭。',
    ];
    const raw = `${lines[0]}\u2028${lines[1]}\u2028${lines[2]}\n${lines[3]}`;
    const { characters, boundaries } = normalizeTextWithBoundaries(raw);
    const svg = `<svg viewBox="0 0 748 160"><text>
      <tspan x="0" y="20">${lines[0]}</tspan>
      <tspan x="0" y="60">${lines[1]}</tspan>
      <tspan x="0" y="100">${lines[2]}</tspan>
      <tspan x="0" y="140">${lines[3]}</tspan>
    </text></svg>`;
    const result = parseSvgVisualLines(svg, characters, boundaries);
    expect(result.status).toBe('exact');
    expect(result.lines.map((line) => line.paragraphIndex)).toEqual([0, 0, 0, 1]);
  });

  it('measures a single-line title baseline instead of limiting diagnostics to mixed line height', () => {
    const svg = `<svg viewBox="0 0 796 167"><text><tspan x="0" y="135">Insight &amp; Idea</tspan></text></svg>`;
    const result = parseSvgVisualLines(svg, 'Insight & Idea');

    expect(result).toEqual({
      status: 'exact',
      viewBox: { x: 0, y: 0, width: 796, height: 167 },
      lines: [
        {
          start: 0,
          end: 14,
          text: 'Insight & Idea',
          x: 0,
          baselineY: 135,
          paragraphIndex: 0,
        },
      ],
    });
  });

  it('consumes explicit newlines between SVG visual lines without losing text', () => {
    const svg = `<svg viewBox="0 0 200 80"><text><tspan x="0" y="20">中文</tspan><tspan x="0" y="44">English</tspan></text></svg>`;
    const result = parseSvgVisualLines(svg, '中文\nEnglish');

    expect(result.status).toBe('exact');
    expect(result.lines.map((line) => [line.start, line.end, line.text, line.lineHeightPx])).toEqual([
      [0, 2, '中文', 24],
      [3, 10, 'English', undefined],
    ]);
  });

  it('skips inter-line spaces so auto-wrap rows still reconcile (quote join guard)', () => {
    // Canvas wrapped after 釁鏆娰嚆; characters kept two spaces instead of `\n`.
    const line1 = '釁鏆娰嚆';
    const line2 = '囀噈港遌嘚瀇姆”';
    const line3 = '“弨慥螎，樑纄尌嚋搱壏掶嚺嘀瀷”';
    const source = `${line1}  ${line2}${line3}`;
    const svg = `<svg viewBox="0 0 400 120"><text>
      <tspan x="0" y="20">${line1}</tspan>
      <tspan x="0" y="44">${line2}</tspan>
      <tspan x="0" y="80">${line3}</tspan>
    </text></svg>`;
    const result = parseSvgVisualLines(svg, source);
    expect(result.status).toBe('exact');
    expect(result.lines.map((line) => line.text)).toEqual([line1, line2, line3]);
    // Third Figma row is its own visual line — not glued onto line2.
    expect(result.lines[2].text).toBe(line3);
  });

  it('splits an SVG row that flattened two source paragraphs onto one baseline', () => {
    // Real failure mode: SVG emits one tspan "涹齢”“弨慥螎…", but characters
    // still have Enter between the closing quote and the next opening quote.
    const q2b = '囀噈港遌嘚瀇姆，蠌嘔港弨枈愚枈愚涹齢”';
    const q3 = '“弨慥螎，樑纄尌嚋搱壏掶嚺嘀瀷”';
    const source = `${q2b}\n${q3}`;
    const svg = `<svg viewBox="0 0 400 80"><text>
      <tspan x="0" y="40">${q2b}${q3}</tspan>
    </text></svg>`;
    const result = parseSvgVisualLines(svg, source);
    expect(result.status).toBe('exact');
    expect(result.lines.map((line) => line.text)).toEqual([q2b, q3]);
    expect(result.lines[0]!.paragraphIndex).toBe(0);
    expect(result.lines[1]!.paragraphIndex).toBe(1);
  });

  it('fails closed when SVG text cannot be reconciled with source characters', () => {
    const svg = `<svg><text><tspan x="0" y="20">Changed</tspan></text></svg>`;
    const result = parseSvgVisualLines(svg, 'Original');

    expect(result.status).toBe('mismatch');
    expect(result.lines).toEqual([]);
    expect(result.reason).toContain('source text mismatch');
  });

  it('uses strategy-aware fallback when mixed line-height visual lines are unavailable', () => {
    const base = {
      paragraphs: [
        { start: 0, end: 4, lineHeight: null, mixedLineHeight: true, paragraphSpacing: 0, paragraphIndent: 0 },
      ],
      visualLineStatus: 'mismatch' as const,
      visualLineReason: 'source text mismatch',
    };
    expect(decideMixedLineHeightRender(base, 'editable')).toEqual({
      kind: 'native',
      reason: 'mixed line-height kept editable: source text mismatch',
    });
    expect(decideMixedLineHeightRender(base, 'fidelity')).toEqual({
      kind: 'image',
      reason: 'mixed line-height local PNG: source text mismatch',
    });
  });

  it('selects native visual-line splitting only for exact, ordered geometry', () => {
    const decision = decideMixedLineHeightRender(
      {
        rect: { x: 0, y: 0, width: 200, height: 80 },
        characters: 'AB',
        paragraphs: [
          { start: 0, end: 2, lineHeight: null, mixedLineHeight: true, paragraphSpacing: 0, paragraphIndent: 0 },
        ],
        visualLineStatus: 'exact',
        visualLines: [
          { start: 0, end: 1, text: 'A', x: 0, baselineY: 16, paragraphIndex: 0 },
          { start: 1, end: 2, text: 'B', x: 0, baselineY: 40, paragraphIndex: 0 },
        ],
      },
      'editable'
    );
    expect(decision).toEqual({ kind: 'split' });
  });
});
