import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { textOptions, textRenderFragments, textRuns } from '../src/converter/text';
import { createPptx } from '../src/converter/converter';
import { postProcessPptx } from '../src/converter/postprocess';
import type { IRDocument, IRText } from '../src/ir/types';

function text(overrides: Partial<IRText> = {}): IRText {
  return {
    id: 't1',
    type: 'text',
    rect: { x: 0, y: 0, width: 400, height: 80 },
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    characters: 'Hello',
    fontSize: 32,
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

describe('textOptions vertical alignment', () => {
  it('maps TOP to top', () => {
    expect(textOptions(text({ textAlignVertical: 'TOP' })).valign).toBe('top');
  });
  it('maps CENTER to middle', () => {
    expect(textOptions(text({ textAlignVertical: 'CENTER' })).valign).toBe('middle');
  });
  it('maps BOTTOM to bottom', () => {
    expect(textOptions(text({ textAlignVertical: 'BOTTOM' })).valign).toBe('bottom');
  });
});

describe('textOptions paragraph spacing', () => {
  it('does not leak paragraph spacing into TextBox options', () => {
    expect(textOptions(text({ paragraphSpacing: 24 })).paraSpaceAfter).toBeUndefined();
  });
  it('omits paraSpaceAfter when null', () => {
    expect(textOptions(text({ paragraphSpacing: null })).paraSpaceAfter).toBeUndefined();
  });
  it('omits paraSpaceAfter when absent (backward compat)', () => {
    const t = text();
    delete t.paragraphSpacing;
    expect(textOptions(t).paraSpaceAfter).toBeUndefined();
  });
});

describe('textRuns', () => {
  it('emits a single run with source RGB + transparency for translucent fill', () => {
    const runs = textRuns(text({ opacity: 0.8, color: '#FFFFFF', characters: 'Hi' }), '#000000');
    expect(runs).toHaveLength(1);
    expect(runs[0].text).toBe('Hi');
    expect(runs[0].options.color).toBe('FFFFFF');
    expect(runs[0].options.transparency).toBe(20);
  });

  it('emits a single run when IR carries one styled span', () => {
    const runs = textRuns(
      text({
        runs: [{ text: 'x', fontSize: 16, fontFamily: 'Arial', fontWeight: 400, color: '#000000', letterSpacing: 0 }],
      })
    );
    expect(runs).toHaveLength(1);
  });

  it('maps mixed runs to per-run options', () => {
    const runs = textRuns(
      text({
        runs: [
          { text: 'Bold ', fontSize: 32, fontFamily: 'Arial', fontWeight: 700, color: '#FF0000', letterSpacing: 0 },
          { text: 'Regular', fontSize: 16, fontFamily: 'Georgia', fontWeight: 400, color: '#000000', letterSpacing: 2 },
        ],
      })
    );
    expect(runs).toHaveLength(2);
    expect(runs[0].text).toBe('Bold ');
    expect(runs[0].options.fontSize).toBe(32); // 100%: panel number → pt
    expect(runs[0].options.bold).toBe(true);
    expect(runs[0].options.color).toBe('FF0000');
    expect(runs[1].options.fontSize).toBe(16);
    expect(runs[1].options.bold).toBe(false);
    expect(runs[1].options.fontFace).toBe('Georgia');
    expect(runs[1].options.charSpacing).toBe(2);
  });
});

describe('mixed line-height visual line fragments', () => {
  it('splits exact visual lines while preserving text, runs and baseline deltas', () => {
    const source = text({
      rect: { x: 100, y: 200, width: 400, height: 90 },
      characters: 'A😀中Next',
      runs: [
        { start: 0, end: 3, text: 'A😀', fontSize: 20, fontFamily: 'Inter', fontWeight: 700, color: '#000000', letterSpacing: 0 },
        { start: 3, end: 8, text: '中Next', fontSize: 16, fontFamily: 'Arial', fontWeight: 400, color: '#000000', letterSpacing: 0 },
      ],
      paragraphs: [
        { start: 0, end: 8, lineHeight: null, mixedLineHeight: true, paragraphSpacing: 0, paragraphIndent: 0 },
      ],
      visualLineStatus: 'exact',
      visualLines: [
        { start: 0, end: 4, text: 'A😀中', x: 12, baselineY: 20, paragraphIndex: 0 },
        { start: 4, end: 8, text: 'Next', x: 0, baselineY: 48, paragraphIndex: 0 },
      ],
    });

    const fragments = textRenderFragments(source);
    expect(fragments).toHaveLength(1);
    expect(fragments[0].characters).toBe(source.characters);
    expect(fragments[0].id).toBe(source.id);
  });

  it('keeps one text box when paragraph line height is uniform', () => {
    const source = text({
      paragraphs: [
        { start: 0, end: 5, lineHeight: { unit: 'PIXELS', value: 24 }, mixedLineHeight: false, paragraphSpacing: 0, paragraphIndent: 0 },
      ],
    });
    expect(textRenderFragments(source)).toEqual([source]);
  });
});

describe('rich text integration', () => {
  async function slideXml(textEl: IRText | IRText[]): Promise<string> {
    const doc: IRDocument = {
      slides: [
        {
          id: 's1',
          name: 'Slide-1',
          width: 1920,
          height: 1080,
          backgroundColor: '#FFFFFF',
          elements: Array.isArray(textEl) ? textEl : [textEl],
        },
      ],
      report: { entries: [] },
    };
    const pptx = createPptx(doc, { sizePreset: 'frame', strategy: 'editable' });
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
    const processed = await postProcessPptx(buffer, doc, {
      sizePreset: 'frame',
      strategy: 'editable',
    });
    const zip = await JSZip.loadAsync(processed);
    return zip.file('ppt/slides/slide1.xml')!.async('string');
  }

  it('emits multiple editable text runs with distinct sizes and bold', async () => {
    const xml = await slideXml(
      text({
        characters: 'Bold Regular',
        runs: [
          { text: 'Bold ', fontSize: 32, fontFamily: 'Arial', fontWeight: 700, color: '#000000', letterSpacing: 0 },
          { text: 'Regular', fontSize: 16, fontFamily: 'Arial', fontWeight: 400, color: '#000000', letterSpacing: 0 },
        ],
      })
    );
    // Two runs, each with its own <a:rPr sz=...>, the first bold.
    expect(xml.match(/<a:r>/g)?.length).toBe(2);
    expect(xml).toContain('<a:t>Bold </a:t>');
    expect(xml).toContain('<a:t>Regular</a:t>');
    expect(xml).toContain('sz="3200"'); // 32 → 32pt
    expect(xml).toContain('sz="1600"'); // 16 → 16pt
    expect(xml).toContain('b="1"');
  });

  it('emits italic as a character-level editable run property', async () => {
    const xml = await slideXml(
      text({
        characters: 'Italic',
        runs: [
          {
            start: 0,
            end: 6,
            text: 'Italic',
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
    expect(xml).toMatch(/<a:rPr[^>]*i="1"/);
  });

  it('emits native text rotation and keeps text editable', async () => {
    const xml = await slideXml(text({ rotation: 30, characters: 'Rotated' }));
    expect(xml).toContain('rot="1800000"');
    expect(xml).toContain('<a:t>Rotated</a:t>');
    expect(xml).not.toContain('<p:pic>');
  });

  it('applies bottom vertical alignment as anchor="b"', async () => {
    const xml = await slideXml(text({ textAlignVertical: 'BOTTOM' }));
    expect(xml).toContain('anchor="b"');
  });

  it('applies paragraph spacing as spcAft', async () => {
    const xml = await slideXml(text({ paragraphSpacing: 24 }));
    expect(xml).toContain('<a:spcAft>');
    expect(xml).toContain('val="2400"'); // 24pt at 100% = 2400 centipoints
  });

  it('writes percent and pixel line heights using the correct OOXML units', async () => {
    const percent = await slideXml(
      text({ lineHeight: 24, lineHeightUnit: 'PERCENT', lineHeightPercent: 150 })
    );
    expect(percent).toContain('<a:lnSpc><a:spcPts val="4800"/></a:lnSpc>');

    const pixels = await slideXml(
      text({ lineHeight: 24, lineHeightUnit: 'PIXELS' })
    );
    expect(pixels).toContain('<a:lnSpc><a:spcPts val="2400"/></a:lnSpc>');
  });

  it('does not invent OOXML line spacing for AUTO or MIXED', async () => {
    const auto = await slideXml(text({ lineHeight: null, lineHeightUnit: 'AUTO' }));
    expect(auto).not.toContain('<a:lnSpc>');
    const mixed = await slideXml(text({ lineHeight: null, lineHeightUnit: 'MIXED' }));
    expect(mixed).not.toContain('<a:lnSpc>');
  });

  it('writes zero text insets, preserves font and avoids shrink autofit', async () => {
    const xml = await slideXml(text({ fontFamily: 'Inter', textAutoResize: 'NONE' }));
    expect(xml).toMatch(/<a:bodyPr[^>]*lIns="0"[^>]*tIns="0"[^>]*rIns="0"[^>]*bIns="0"/);
    expect(xml).toContain('<a:latin typeface="Inter"');
    expect(xml).not.toContain('<a:normAutofit');
    expect(xml).not.toContain('<a:spAutoFit');
  });

  it('preserves measured Figma geometry for every textAutoResize mode', async () => {
    const both = await slideXml(text({ textAutoResize: 'WIDTH_AND_HEIGHT' }));
    expect(both).not.toContain('<a:spAutoFit/>');
    expect(both).toContain('<a:ext cx="5080000" cy="1016000"/>');
    const heightOnly = await slideXml(text({ textAutoResize: 'HEIGHT' }));
    expect(heightOnly).not.toContain('<a:spAutoFit/>');
  });

  it('injects paragraph first-line indent and native capitalization', async () => {
    const xml = await slideXml(
      text({ paragraphIndent: 16, textCase: 'UPPER', characters: 'Editable source' })
    );
    expect(xml).toMatch(/<a:pPr[^>]*marL="0"[^>]*indent="203200"/);
    expect(xml).toMatch(/<a:rPr[^>]*cap="all"/);
    expect(xml).toContain('<a:t>Editable source</a:t>');
  });

  it('maps preserved paragraph list metadata without flattening the text', async () => {
    const xml = await slideXml(
      text({
        characters: 'Item',
        paragraphs: [
          {
            start: 0,
            end: 4,
            lineHeight: { unit: 'PIXELS', value: 24 },
            mixedLineHeight: false,
            paragraphSpacing: 0,
            paragraphIndent: 6,
            textAlignHorizontal: 'LEFT',
            listType: 'UNORDERED',
            listSpacing: 8,
            indentation: 24,
          },
        ],
      })
    );
    expect(xml).toContain('<a:buChar char="•"/>');
    expect(xml).toMatch(/<a:pPr[^>]*marL="304800"[^>]*indent="76200"/);
    expect(xml).toContain('<a:t>Item</a:t>');
  });

  it('injects distinct line height and spacing for each logical paragraph', async () => {
    const xml = await slideXml(
      text({
        characters: 'One\nTwo',
        lineHeight: null,
        lineHeightUnit: 'MIXED',
        paragraphs: [
          {
            start: 0,
            end: 3,
            lineHeight: { unit: 'PIXELS', value: 24 },
            mixedLineHeight: false,
            paragraphSpacing: 12,
            paragraphIndent: 0,
            textAlignHorizontal: 'LEFT',
          },
          {
            start: 4,
            end: 7,
            lineHeight: { unit: 'PERCENT', value: 150 },
            mixedLineHeight: false,
            paragraphSpacing: 6,
            paragraphIndent: 8,
            textAlignHorizontal: 'RIGHT',
          },
        ],
      })
    );
    const paragraphProperties = [...xml.matchAll(/<a:pPr\b[\s\S]*?<\/a:pPr>/g)].map(
      (match) => match[0]
    );
    expect(paragraphProperties).toHaveLength(2);
    expect(paragraphProperties[0]).toContain('<a:spcPts val="2400"/>');
    expect(paragraphProperties[0]).toContain('<a:spcAft><a:spcPts val="1200"/></a:spcAft>');
    expect(paragraphProperties[1]).toContain('<a:spcPts val="4800"/>');
    expect(paragraphProperties[1]).toContain('<a:spcAft><a:spcPts val="600"/></a:spcAft>');
    expect(paragraphProperties[1]).toContain('indent="101600"'); // 8pt × 12700
    expect(paragraphProperties[0]).toContain('algn="l"');
    expect(paragraphProperties[1]).toContain('algn="r"');
  });

  it('emits mixed-line fragments as ordered editable text shapes without duplication', async () => {
    const xml = await slideXml(
      text({
        rect: { x: 100, y: 200, width: 400, height: 90 },
        characters: '中文English',
        textCase: 'UPPER',
        runs: [
          { start: 0, end: 2, text: '中文', fontSize: 20, fontFamily: 'Microsoft YaHei', fontWeight: 400, color: '#000000', letterSpacing: 0 },
          { start: 2, end: 9, text: 'English', fontSize: 16, fontFamily: 'Inter', fontWeight: 700, color: '#000000', letterSpacing: 0 },
        ],
        paragraphs: [
          { start: 0, end: 9, lineHeight: null, mixedLineHeight: true, paragraphSpacing: 0, paragraphIndent: 0 },
        ],
        visualLineStatus: 'exact',
        visualLines: [
          { start: 0, end: 2, text: '中文', x: 0, baselineY: 20, paragraphIndex: 0 },
          { start: 2, end: 9, text: 'English', x: 0, baselineY: 50, paragraphIndex: 0 },
        ],
      })
    );
    expect(xml.match(/<p:cNvSpPr txBox="1"\/>/g)).toHaveLength(1);
    expect(xml.match(/<a:t>中文<\/a:t>/g)).toHaveLength(1);
    expect(xml.match(/<a:t>English<\/a:t>/g)).toHaveLength(1);
    expect(xml.match(/<a:rPr[^>]*cap="all"/g)).toHaveLength(2);
    expect(xml.indexOf('<a:t>中文</a:t>')).toBeLessThan(xml.indexOf('<a:t>English</a:t>'));
  });

  it('matches FPPT mixed exact spacing in one editable box (soft-break within equal runs)', async () => {
    // Lines 1-3 @30px, line 4 @20px, lines 5-11 @30px. Equal adjacent rows collapse
    // to <a:br/> so Exact lnSpc applies between them; the 20px row stays its own <a:p>.
    const labels = Array.from({ length: 11 }, (_, index) => `Line ${index + 1}`);
    let cursor = 0;
    const paragraphs = labels.map((label, index) => {
      const start = cursor;
      cursor += label.length;
      const paragraph = {
        start,
        end: cursor,
        lineHeight: { unit: 'PIXELS' as const, value: index === 3 ? 20 : 30 },
        mixedLineHeight: false,
        paragraphSpacing: 0,
        paragraphIndent: 0,
      };
      cursor += 1;
      return paragraph;
    });
    const xml = await slideXml(
      text({
        characters: labels.join('\n'),
        fontSize: 12,
        lineHeight: null,
        lineHeightUnit: 'MIXED',
        paragraphs,
      })
    );
    expect(xml.match(/<p:cNvSpPr txBox="1"\/>/g)).toHaveLength(1);
    expect(xml).not.toContain('<a:br/>');
    const contentParas = [...xml.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].filter((match) =>
      /<a:t>/.test(match[0])
    );
    expect(contentParas).toHaveLength(11);
    expect(contentParas[0][0]).toContain('<a:spcPts val="3000"/>');
    expect(contentParas[0][0]).toContain('Line 1');
    expect(contentParas[3][0]).toContain('<a:spcPts val="2000"/>');
    expect(contentParas[3][0]).toContain('Line 4');
    expect(contentParas[4][0]).toContain('<a:spcPts val="3000"/>');
    expect(contentParas[10][0]).toContain('Line 11');
    expect(xml).toContain('sz="1200"'); // fontSize 12 → 12pt
  });

  it('keeps split visual lines at the source z-order and does not rasterize them', async () => {
    const mixed = text({
      id: 'mixed',
      zIndex: 0,
      characters: 'AB',
      runs: [
        { start: 0, end: 1, text: 'A', fontSize: 20, fontFamily: 'Inter', fontWeight: 400, color: '#000000', letterSpacing: 0 },
        { start: 1, end: 2, text: 'B', fontSize: 16, fontFamily: 'Inter', fontWeight: 400, color: '#000000', letterSpacing: 0 },
      ],
      paragraphs: [
        { start: 0, end: 2, lineHeight: null, mixedLineHeight: true, paragraphSpacing: 0, paragraphIndent: 0 },
      ],
      visualLineStatus: 'exact',
      visualLines: [
        { start: 0, end: 1, text: 'A', x: 0, baselineY: 16, paragraphIndex: 0 },
        { start: 1, end: 2, text: 'B', x: 0, baselineY: 40, paragraphIndex: 0 },
      ],
    });
    const after = text({ id: 'after', zIndex: 1, characters: 'After' });
    const xml = await slideXml([mixed, after]);
    const first = xml.indexOf('name="F2P_TXT_mixed"');
    const second = xml.indexOf('name="F2P_TXT_after"');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(xml).not.toContain('<p:pic>');
  });
});
