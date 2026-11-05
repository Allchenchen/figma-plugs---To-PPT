import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createPptx } from '../src/converter/converter';
import { postProcessPptx, stripLeadingBreakStubs } from '../src/converter/postprocess';
import {
  canLockVisualWraps,
  estimateLineWidthPx,
  lockVisualWraps,
  textFitsSingleLineBox,
} from '../src/converter/text-wrap';
import { softBreakGroups } from '../src/converter/text-paragraphs';
import { textBoxOptions } from '../src/converter/text';
import { normalizeTextWithBoundaries, parseSvgVisualLines } from '../src/reader/text-model';
import type { ExportOptions, IRDocument, IRText, IRTextParagraph } from '../src/ir/types';

function text(overrides: Partial<IRText> = {}): IRText {
  return {
    id: 'quotes',
    type: 'text',
    rect: { x: 100, y: 100, width: 420, height: 400 },
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    characters: '',
    fontSize: 14,
    fontFamily: 'PingFang SC',
    fontWeight: 400,
    color: '#FFFFFF',
    letterSpacing: 0,
    lineHeight: 22,
    lineHeightUnit: 'PIXELS',
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    ...overrides,
  };
}

function para(
  overrides: Partial<IRTextParagraph> & { start: number; end: number }
): IRTextParagraph {
  return {
    lineHeight: { unit: 'PIXELS', value: 22 },
    mixedLineHeight: false,
    paragraphSpacing: 10,
    paragraphIndent: 0,
    textAlignHorizontal: 'LEFT',
    ...overrides,
  };
}

describe('stripLeadingBreakStubs', () => {
  it('removes a leading br before the first run but keeps mid-paragraph soft breaks', () => {
    const shape =
      '<p:sp><p:txBody>' +
      '<a:p><a:pPr/><a:br/><a:r><a:t>第二行</a:t></a:r></a:p>' +
      '<a:p><a:pPr/><a:r><a:t>上</a:t></a:r><a:br/><a:r><a:t>下</a:t></a:r></a:p>' +
      '</p:txBody></p:sp>';
    const next = stripLeadingBreakStubs(shape);
    expect(next).toContain('<a:pPr/><a:r><a:t>第二行</a:t></a:r>');
    expect(next).not.toMatch(/<a:pPr\/>\s*<a:br\s*\/>\s*<a:r><a:t>第二行/);
    expect(next).toContain('<a:t>上</a:t></a:r><a:br/><a:r><a:t>下</a:t>');
  });
});

describe('lockVisualWraps', () => {
  it('keeps shift-enter rows in one paragraph and Enter as the next paragraph', () => {
    const raw = '甲\u2028乙\u2028丙\n丁';
    const { characters, boundaries } = normalizeTextWithBoundaries(raw);
    const locked = lockVisualWraps(
      text({
        characters,
        boundaries,
        fontSize: 20,
        lineHeight: 40,
        lineHeightUnit: 'PIXELS',
        paragraphSpacing: 0,
        visualLineStatus: 'exact',
        visualLines: [
          { start: 0, end: 1, text: '甲', x: 0, baselineY: 20, lineHeightPx: 40, paragraphIndex: 0 },
          { start: 2, end: 3, text: '乙', x: 0, baselineY: 60, lineHeightPx: 40, paragraphIndex: 0 },
          { start: 4, end: 5, text: '丙', x: 0, baselineY: 100, lineHeightPx: 40, paragraphIndex: 0 },
          { start: 6, end: 7, text: '丁', x: 0, baselineY: 140, lineHeightPx: 40, paragraphIndex: 1 },
        ],
      })
    );
    expect(locked.paragraphs?.map((paragraph) => paragraph.breakAfter)).toEqual([
      'softBreak',
      'softBreak',
      'paragraphBreak',
      undefined,
    ]);
    expect(softBreakGroups(locked.paragraphs!)).toEqual([[0, 1, 2], [3]]);
  });

  it('writes the line box once and leaves paragraph spacing on the boundary', () => {
    const locked = lockVisualWraps(
      text({
        characters: '甲\n乙',
        fontSize: 16,
        lineHeight: 24,
        lineHeightUnit: 'PIXELS',
        paragraphs: [
          para({ start: 0, end: 1, paragraphSpacing: 16, lineHeight: { unit: 'PIXELS', value: 24 } }),
          para({ start: 2, end: 3, paragraphSpacing: 0, lineHeight: { unit: 'PIXELS', value: 24 } }),
        ],
        visualLineStatus: 'exact',
        visualLines: [
          {
            start: 0,
            end: 1,
            text: '甲',
            x: 0,
            baselineY: 20,
            lineHeightPx: 40,
            paragraphIndex: 0,
          },
          {
            start: 2,
            end: 3,
            text: '乙',
            x: 0,
            baselineY: 60,
            paragraphIndex: 1,
          },
        ],
      })
    );
    expect(locked.paragraphs?.[0].lineHeight).toEqual({ unit: 'PIXELS', value: 24 });
    expect(locked.paragraphs?.[0].paragraphSpacing).toBe(16);
    expect(locked.paragraphs?.[0].breakAfter).toBe('paragraphBreak');
  });

  it('inserts soft breaks at Figma auto-wrap points inside a logical paragraph', () => {
    const line1 = '“坠栻製缋娰漉嚺日坜娰痱愜，维殥罡弨璙寑嘊”';
    const line2a = '“坠鷮樑弨慥螎捦娰嚆囀噈？枈麾鏴姺濐嘀囶奷坓纄嚋，坆樑聮掞釁鏆娰嚆';
    const line2b = '囀噈港遌嘚瀇姆，蠌嘔港弨枈愚枈愚涹齢”';
    const line3 = '“弨慥螎，樑纄尌嚋搱壏掶嚺嘀瀷”';
    const characters = `${line1}\n${line2a}${line2b}\n${line3}`;
    const p0End = line1.length;
    const p1Start = p0End + 1;
    const p1End = p1Start + line2a.length + line2b.length;
    const p2Start = p1End + 1;

    const locked = lockVisualWraps(
      text({
        characters,
        paragraphs: [
          para({ start: 0, end: p0End, paragraphSpacing: 10 }),
          para({ start: p1Start, end: p1End, paragraphSpacing: 10 }),
          para({ start: p2Start, end: p2Start + line3.length, paragraphSpacing: 10 }),
        ],
        visualLineStatus: 'exact',
        visualLines: [
          { start: 0, end: p0End, text: line1, x: 0, baselineY: 20, paragraphIndex: 0 },
          {
            start: p1Start,
            end: p1Start + line2a.length,
            text: line2a,
            x: 0,
            baselineY: 50,
            paragraphIndex: 1,
          },
          {
            start: p1Start + line2a.length,
            end: p1End,
            text: line2b,
            x: 0,
            baselineY: 72,
            paragraphIndex: 1,
          },
          {
            start: p2Start,
            end: p2Start + line3.length,
            text: line3,
            x: 0,
            baselineY: 100,
            paragraphIndex: 2,
          },
        ],
      })
    );

    expect(locked.visualWrapLocked).toBe(true);
    expect(canLockVisualWraps(locked)).toBe(true);
    expect(locked.characters).toBe(`${line1}\n${line2a}\n${line2b}\n${line3}`);
    expect(locked.paragraphs).toHaveLength(4);
    expect(softBreakGroups(locked.paragraphs!)).toEqual([[0], [1, 2], [3]]);
    expect(locked.paragraphs![1].paragraphSpacing).toBe(0);
    expect(locked.paragraphs![2].paragraphSpacing).toBe(10);
    expect(locked.paragraphs![1].breakAfter).toBe('softBreak');
    // Locked boxes disable PPT re-wrap; soft breaks carry Figma rows.
    expect(textBoxOptions(locked).wrap).toBe(false);
  });

  it('bakes a missing break when SVG shows two rows but characters have none', () => {
    // Without `\n` in source, SVG paragraphIndex stays 0 for both rows — bake
    // still inserts a soft break so the second item is not same-line concatenated.
    const q2 = '“长句前半”';
    const q3 = '“下一条独立”';
    const characters = `${q2}${q3}`;
    const locked = lockVisualWraps(
      text({
        characters,
        paragraphs: [
          para({
            start: 0,
            end: characters.length,
            paragraphSpacing: 10,
            lineHeight: { unit: 'PIXELS', value: 22 },
          }),
        ],
        visualLineStatus: 'exact',
        visualLines: [
          { start: 0, end: q2.length, text: q2, x: 0, baselineY: 20, paragraphIndex: 0 },
          {
            start: q2.length,
            end: characters.length,
            text: q3,
            x: 0,
            baselineY: 50,
            paragraphIndex: 0,
          },
        ],
      })
    );
    expect(locked.characters).toBe(`${q2}\n${q3}`);
    expect(locked.paragraphs).toHaveLength(2);
    expect(locked.paragraphs![0].breakAfter).toBe('softBreak');
    expect(softBreakGroups(locked.paragraphs!)).toEqual([[0, 1]]);
  });

  it('always rebuilds paragraph IR from visual lines even when characters already match', () => {
    const source = text({
      characters: 'A\nB',
      // Stale single paragraph covering both rows — must be rebuilt.
      paragraphs: [para({ start: 0, end: 3, paragraphSpacing: 0 })],
      visualLineStatus: 'exact',
      visualLines: [
        { start: 0, end: 1, text: 'A', x: 0, baselineY: 10, paragraphIndex: 0 },
        { start: 2, end: 3, text: 'B', x: 0, baselineY: 30, paragraphIndex: 1 },
      ],
    });
    const locked = lockVisualWraps(source);
    expect(locked.characters).toBe('A\nB');
    expect(locked.visualWrapLocked).toBe(true);
    expect(locked.paragraphs).toHaveLength(2);
    expect(locked.paragraphs![0].breakAfter).toBe('paragraphBreak');
    expect(softBreakGroups(locked.paragraphs!)).toEqual([[0], [1]]);
    expect(locked.boundaries).toHaveLength(1);
  });

  it('is a no-op without exact visual lines', () => {
    const source = text({ characters: 'Long line', visualLineStatus: 'unavailable' });
    expect(lockVisualWraps(source)).toBe(source);
    expect(source.visualWrapLocked).toBeUndefined();
    expect(canLockVisualWraps(source)).toBe(false);
  });

  it('does not lock when SVG reports a single visual line that cannot fit (Idea overflow guard)', () => {
    const idea =
      '囥“揻橾舀漉媨穩”嘺娛椏嘻亘，樑囬搆甞揟娰纄峁穌穹锨曶摕嘺嚔嘪瀸柃囷堼釂，晶嘺珏嘀臍囷堼镋嚈嘀嘪奨涰纄“舀漉媨穩”杢鑡';
    const source = text({
      characters: idea,
      fontSize: 16,
      // Narrower than Figma wrap width — false 1-line SVG must not freeze wrap.
      rect: { x: 780, y: 420, width: 420, height: 160 },
      textAutoResize: 'HEIGHT',
      visualLineStatus: 'exact',
      visualLines: [
        { start: 0, end: idea.length, text: idea, x: 0, baselineY: 20, paragraphIndex: 0 },
      ],
    });
    expect(textFitsSingleLineBox(source)).toBe(false);
    expect(canLockVisualWraps(source)).toBe(false);
    expect(lockVisualWraps(source)).toBe(source);
    expect(source.visualWrapLocked).toBeUndefined();
    expect(textBoxOptions(source).wrap).toBe(false);
  });

  it('locks Results-style metric numbers that fit on one Figma row', () => {
    const metric = '196,336';
    const source = text({
      id: '63:771',
      characters: metric,
      fontSize: 56,
      rect: { x: 520, y: 621, width: 220, height: 67 },
      visualLineStatus: 'exact',
      visualLines: [
        { start: 0, end: metric.length, text: metric, x: 0, baselineY: 50, paragraphIndex: 0 },
      ],
    });
    expect(estimateLineWidthPx(metric, 56)).toBeLessThanOrEqual(220 * 1.35);
    expect(canLockVisualWraps(source)).toBe(true);
    const locked = lockVisualWraps(source);
    expect(locked.visualWrapLocked).toBe(true);
    expect(locked.characters).toBe(metric);
    expect(textBoxOptions(locked).wrap).toBe(false);
  });

  it('locks a hug-width single-line title so PowerPoint cannot wrap the last glyph', () => {
    const title = 'Storyboard';
    const fontSize = 32;
    const width = title.length * 0.52 * fontSize;
    const source = text({
      characters: title,
      fontSize,
      rect: { x: 48, y: 40, width, height: 40 },
      visualLineStatus: 'exact',
      visualLines: [
        { start: 0, end: title.length, text: title, x: 0, baselineY: 32, paragraphIndex: 0 },
      ],
    });
    expect(estimateLineWidthPx(title, fontSize)).toBeGreaterThan(width * 1.08);
    expect(textFitsSingleLineBox(source)).toBe(true);
    expect(lockVisualWraps(source).visualWrapLocked).toBe(true);
  });
});

describe('visual wrap OOXML emission', () => {
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

  it('emits wrap=none + soft-break when Figma visual rows are locked', async () => {
    const line1 = '“短句保持一行”';
    const line2a = '“长句前半段到釁鏆娰嚆';
    const line2b = '后半段续行”';
    const characters = `${line1}\n${line2a}${line2b}`;
    const p0 = line1.length;
    const p1Start = p0 + 1;
    const p1End = p1Start + line2a.length + line2b.length;

    const xml = await slideXml(
      text({
        characters,
        paragraphs: [
          para({ start: 0, end: p0, paragraphSpacing: 12 }),
          para({ start: p1Start, end: p1End, paragraphSpacing: 12 }),
        ],
        visualLineStatus: 'exact',
        visualLines: [
          { start: 0, end: p0, text: line1, x: 0, baselineY: 20, paragraphIndex: 0 },
          {
            start: p1Start,
            end: p1Start + line2a.length,
            text: line2a,
            x: 0,
            baselineY: 50,
            paragraphIndex: 1,
          },
          {
            start: p1Start + line2a.length,
            end: p1End,
            text: line2b,
            x: 0,
            baselineY: 72,
            paragraphIndex: 1,
          },
        ],
      })
    );

    expect(xml).toMatch(/<a:bodyPr[^>]*wrap="none"/);
    expect(xml).toContain('<a:br/>');
    expect(xml).toContain(line1);
    expect(xml).toContain(line2a);
    expect(xml).toContain(line2b);
    const contentParas = [...xml.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)]
      .map((m) => m[0])
      .filter((p) => /<a:t>/.test(p));
    expect(contentParas.length).toBeGreaterThanOrEqual(2);
    const longPara = contentParas.find((p) => p.includes(line2a) && p.includes('<a:br/>'));
    expect(longPara).toBeTruthy();
    expect(longPara).toContain(line2b);
  });

  it('keeps the next quote on its own Figma visual row (no same-line join)', async () => {
    // Repro from PPT screenshot: long quote wraps after 嚆; “弨慥螎…” is its own row.
    const q1 = '“坠栻製缋娰漉嚺日坜娰痱愜，维殥罡弨璙寑嘊”';
    const q2a = '“坠鷮樑弨慥螎捦娰嚆囀噈？枈麾鏴姺濐嘀囶奷坓纄嚋，坆樑聮掞釁鏆娰嚆';
    const q2b = '囀噈港遌嘚瀇姆，蠌嘔港弨枈愚枈愚涹齢”';
    const q3 = '“弨慥螎，樑纄尌嚋搱壏掶嚺嘀瀷”';
    // Enter between quotes; soft wrap only in visualLines.
    const characters = `${q1}\n${q2a}${q2b}\n${q3}`;
    const p0 = q1.length;
    const q2Start = p0 + 1;
    const q2End = q2Start + q2a.length + q2b.length;
    const q3Start = q2End + 1;
    const xml = await slideXml(
      text({
        id: '29:270',
        characters,
        paragraphs: [
          para({ start: 0, end: p0, paragraphSpacing: 10, lineHeight: { unit: 'PIXELS', value: 30 } }),
          para({
            start: q2Start,
            end: q2End,
            paragraphSpacing: 10,
            lineHeight: { unit: 'PIXELS', value: 20 },
          }),
          para({
            start: q3Start,
            end: characters.length,
            paragraphSpacing: 10,
            lineHeight: { unit: 'PIXELS', value: 30 },
          }),
        ],
        visualLineStatus: 'exact',
        // SVG flattened q2b+q3 onto one baseline; source `\n` must still split them.
        visualLines: [
          { start: 0, end: p0, text: q1, x: 0, baselineY: 20, paragraphIndex: 0 },
          {
            start: q2Start,
            end: q2Start + q2a.length,
            text: q2a,
            x: 0,
            baselineY: 50,
            paragraphIndex: 1,
          },
          {
            start: q2Start + q2a.length,
            end: characters.length,
            text: `${q2b}${q3}`,
            x: 0,
            baselineY: 70,
            paragraphIndex: 1,
          },
        ],
      })
    );

    expect(xml).toMatch(/<a:bodyPr[^>]*wrap="none"/);
    expect(xml).not.toMatch(/涹齢”“弨慥螎/);
    for (const row of [q1, q2a, q2b, q3]) {
      expect(xml).toContain(row);
    }
    // Soft wrap after 嚆 (not after 什) — Figma row boundary.
    expect(xml).toMatch(/釁鏆娰嚆<\/a:t>[\s\S]*?<a:br\s*\/>/);
    // q3 is its own row (paragraph or soft-break), never glued to q2b.
    const q3Para = [...xml.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)]
      .map((m) => m[0])
      .find((p) => p.includes(q3));
    expect(q3Para).toBeTruthy();
    expect(q3Para!.includes(q2b) && !q3Para!.includes('<a:br') ? false : true).toBe(true);
    expect(
      q3Para!.includes('<a:br') ||
        [...xml.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].some(
          (m) => m[0].includes(q3) && !m[0].includes(q2b)
        )
    ).toBe(true);
  });

  it('keeps wrap=square when visual lines are unavailable', async () => {
    const idea =
      '囥“揻橾舀漉媨穩”嘺娛椏嘻亘，樑囬搆甞揟娰纄峁穌穹锨曶摕嘺嚔嘪瀸柃囷堼釂，晶嘺珏嘀臍囷堼镋嚈嘀嘪奨涰纄“舀漉媨穩”杢鑡，坜嘺釆釉麐嶻。鎩実漬檽鑡纄涇嬖寘林寯釁、寯椟，囎蠌尸朕缟獣慑專纄嚺媠奥奶嘭。';
    const xml = await slideXml(
      text({
        id: 'idea-body',
        characters: idea,
        fontSize: 16,
        rect: { x: 780, y: 420, width: 900, height: 160 },
        textAutoResize: 'HEIGHT',
        visualLineStatus: 'unavailable',
      })
    );

    expect(xml).toMatch(/<a:bodyPr[^>]*wrap="square"/);
    expect(xml).not.toMatch(/wrap="none"/);
    expect(xml).toContain(idea.slice(0, 12));
    // Geometry must stay Figma box (900×160 pt → EMU).
    expect(xml).toMatch(/cx="11430000"/);
    expect(xml).toMatch(/cy="2032000"/);
  });

  it('emits wrap=none for locked single-line metrics that fit the Figma box', async () => {
    const metric = '196,336';
    const xml = await slideXml(
      text({
        id: '63:771',
        characters: metric,
        fontSize: 56,
        rect: { x: 520, y: 621, width: 220, height: 67 },
        visualLineStatus: 'exact',
        visualLines: [
          { start: 0, end: metric.length, text: metric, x: 0, baselineY: 50, paragraphIndex: 0 },
        ],
      })
    );
    expect(xml).toMatch(/<a:bodyPr[^>]*wrap="none"/);
    expect(xml).toContain(metric);
    expect(xml).not.toContain('<a:br/>');
  });

  it('keeps wrap=square for long single-line Idea when SVG under-reports rows', async () => {
    const idea =
      '囥“揻橾舀漉媨穩”嘺娛椏嘻亘，樑囬搆甞揟娰纄峁穌穹锨曶摕嘺嚔嘪瀸柃囷堼釂，晶嘺珏嘀臍囷堼镋嚈嘀嘪奨涰纄“舀漉媨穩”杢鑡';
    const xml = await slideXml(
      text({
        id: 'idea-1line-svg',
        characters: idea,
        fontSize: 16,
        rect: { x: 780, y: 420, width: 420, height: 160 },
        textAutoResize: 'HEIGHT',
        visualLineStatus: 'exact',
        visualLines: [
          { start: 0, end: idea.length, text: idea, x: 0, baselineY: 20, paragraphIndex: 0 },
        ],
      })
    );
    expect(xml).toMatch(/<a:bodyPr[^>]*wrap="square"/);
    expect(xml).not.toMatch(/wrap="none"/);
  });

  it('bakes Insight/Idea Figma soft wraps and strips leading break stubs', async () => {
    const i1a = '慥螎谥頠纄愚奃、嬅掹嘔澁奷嘓嘚暦';
    const i1b = '纄箯悃琛廴，';
    const i2 = '港尸朕睜弨堙頉嚺纄漀瀸柃廠蔠';
    const insightChars = `${i1a}${i1b}\n${i2}`;
    const insightXml = await slideXml(
      text({
        id: '4:21',
        characters: insightChars,
        fontSize: 20,
        rect: { x: 972, y: 568, width: 748, height: 120 },
        paragraphs: [
          para({
            start: 0,
            end: i1a.length + i1b.length,
            paragraphSpacing: 12,
            lineHeight: { unit: 'PIXELS', value: 40 },
          }),
          para({
            start: i1a.length + i1b.length + 1,
            end: insightChars.length,
            paragraphSpacing: 0,
            lineHeight: { unit: 'PIXELS', value: 40 },
          }),
        ],
        visualLineStatus: 'exact',
        visualLines: [
          { start: 0, end: i1a.length, text: i1a, x: 0, baselineY: 20, paragraphIndex: 0 },
          {
            start: i1a.length,
            end: i1a.length + i1b.length,
            text: i1b,
            x: 0,
            baselineY: 48,
            paragraphIndex: 0,
          },
          {
            start: i1a.length + i1b.length + 1,
            end: insightChars.length,
            text: i2,
            x: 0,
            baselineY: 88,
            paragraphIndex: 1,
          },
        ],
      })
    );
    expect(insightXml).toMatch(/wrap="none"/);
    expect(insightXml).toContain(i1a);
    expect(insightXml).toContain(i1b);
    expect(insightXml).toMatch(/嘓嘚暦<\/a:t>[\s\S]*?<a:br\s*\/>[\s\S]*?纄箯悃琛廴/);
    // No blank row before the second logical paragraph.
    expect(insightXml).not.toMatch(/<a:pPr[\s\S]*?<\/a:pPr>\s*<a:br\s*\/>\s*<a:r>[\s\S]*?港尸朕/);

    const ideaRows = [
      ['囥“揻橾舀漉媨穩”嘺娛椏嘻亘，'],
      ['樑囬搆甞揟娰纄峁穌穹锨曶摕嘺嚔', '嘪瀸柃囷堼釂，'],
      ['晶嘺珏嘀臍囷堼镋嚈嘀嘪奨涰纄“舀', '漉媨穩”杢鑡，坜嘺釆釉麐嶻。'],
      ['鎩実漬檽鑡纄涇嬖寘林寯釁、寯椟，', '囎蠌尸朕缟獣慑專纄嚺媠奥奶嘭。'],
    ];
    const ideaParas = ideaRows.map((rows) => rows.join(''));
    const ideaChars = ideaParas.join('\n');
    const visualLines: {
      start: number;
      end: number;
      text: string;
      x: number;
      baselineY: number;
      paragraphIndex: number;
    }[] = [];
    let cursor = 0;
    let baseline = 20;
    ideaRows.forEach((rows, pi) => {
      for (const row of rows) {
        const start = ideaChars.indexOf(row, cursor);
        visualLines.push({
          start,
          end: start + row.length,
          text: row,
          x: 0,
          baselineY: baseline,
          paragraphIndex: pi,
        });
        cursor = start + row.length;
        baseline += 28;
      }
      cursor += 1;
    });
    let pCursor = 0;
    const ideaParagraphs = ideaParas.map((block, index) => {
      const start = pCursor;
      const end = start + block.length;
      pCursor = end + 1;
      return para({
        start,
        end,
        paragraphSpacing: index < ideaParas.length - 1 ? 12 : 0,
        lineHeight: { unit: 'PIXELS', value: 28 },
      });
    });
    const ideaXml = await slideXml(
      text({
        id: '4:19',
        characters: ideaChars,
        fontSize: 20,
        fontFamily: 'SF Pro',
        rect: { x: 972, y: 766, width: 748, height: 220 },
        paragraphs: ideaParagraphs,
        visualLineStatus: 'exact',
        visualLines,
      })
    );
    expect(ideaXml).toMatch(/wrap="none"/);
    expect(ideaXml).toMatch(/曶摕嘺嚔<\/a:t>[\s\S]*?<a:br\s*\/>[\s\S]*?嘪瀸柃囷堼釂/);
    expect(ideaXml).toMatch(/奨涰纄“舀<\/a:t>[\s\S]*?<a:br\s*\/>[\s\S]*?漉媨穩/);
    expect(ideaXml).toMatch(/寯釁、寯椟，<\/a:t>[\s\S]*?<a:br\s*\/>[\s\S]*?囎蠌尸朕/);
  });

  it('emits one row per Figma line when the tspan already ends with the break', async () => {
    const lines = [
      '囥“揻橾舀漉媨穩”嘺娛椏嘻亘，',
      '樑囬搆甞揟娰纄峁穌穹锨曶摕嘺嚔嘪瀸柃囷堼釂，',
      '晶嘺珏嘀臍囷堼镋嚈嘀嘪奨涰纄“舀漉媨穩”杢鑡，坜嘺釆釉麐嶻。',
      '鎩実漬檽鑡纄涇嬖寘林寯釁、寯椟，囎蠌尸朕缟獣慑專纄嚺媠奥奶嘭。',
    ];
    const { characters, boundaries } = normalizeTextWithBoundaries(
      `${lines[0]}\u2028${lines[1]}\u2028${lines[2]}\n${lines[3]}`
    );
    const svg = `<svg viewBox="0 0 748 160"><text>
      <tspan x="0" y="20">${lines[0]}&#x2028;</tspan>
      <tspan x="0" y="60">${lines[1]}&#x2028;</tspan>
      <tspan x="0" y="100">${lines[2]}&#10;</tspan>
      <tspan x="0" y="140">${lines[3]}</tspan>
    </text></svg>`;
    const parsed = parseSvgVisualLines(svg, characters, boundaries);
    const xml = await slideXml(
      text({
        id: '4:19',
        characters,
        boundaries,
        fontSize: 20,
        lineHeight: 40,
        lineHeightUnit: 'PIXELS',
        paragraphSpacing: 0,
        rect: { x: 972, y: 766, width: 748, height: 160 },
        visualLineStatus: 'exact',
        visualLines: parsed.lines,
      })
    );
    const paras = [...xml.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].map((match) => match[0]);
    expect(paras.filter((paragraph) => !/<a:t>[^<]/.test(paragraph))).toEqual([]);
    expect(xml).not.toMatch(/<a:br\s*\/>\s*<a:br\s*\/>/);
    expect(paras).toHaveLength(2);
    expect(paras[0].match(/<a:br\s*\/>/g)?.length).toBe(2);
    expect(paras[1]).toContain('鎩実漬檽鑡纄涇嬖');
  });
});
