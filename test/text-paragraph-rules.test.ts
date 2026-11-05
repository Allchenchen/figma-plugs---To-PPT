/**
 * Rule 13 regression matrix — paragraph / mixed line-height / vertical layout.
 * Feature-level samples only; no page or node-id hardcoding.
 */
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createPptx } from '../src/converter/converter';
import { postProcessPptx } from '../src/converter/postprocess';
import { resolveTextParagraphs, softBreakGroups } from '../src/converter/text-paragraphs';
import { textBoxOptions } from '../src/converter/text';
import {
  TEXT_VERTICAL_POLICY,
  assertTextBoxVerticalPolicy,
  bodyPrAnchorFromFigma,
  pptxValignFromFigma,
} from '../src/converter/text-vertical';
import { slidePtToInch } from '../src/converter/page-scale';
import { buildTextParagraphs, decideMixedLineHeightRender } from '../src/reader/text-model';
import type { ExportOptions, IRDocument, IRText, IRTextParagraph, IRTextRun } from '../src/ir/types';

function text(overrides: Partial<IRText> = {}): IRText {
  return {
    id: 't1',
    type: 'text',
    rect: { x: 100, y: 200, width: 400, height: 120 },
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    characters: 'Hello',
    fontSize: 20,
    fontFamily: 'Inter',
    fontWeight: 400,
    color: '#000000',
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
    lineHeight: { unit: 'PIXELS', value: 30 },
    mixedLineHeight: false,
    paragraphSpacing: 0,
    paragraphIndent: 0,
    textAlignHorizontal: 'LEFT',
    ...overrides,
  };
}

async function slideXml(layer: IRText, strategy: 'editable' | 'fidelity' = 'editable'): Promise<string> {
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
  const options: ExportOptions = { sizePreset: 'frame', strategy };
  const pptx = createPptx(doc, options);
  const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
  const out = await postProcessPptx(buffer, doc, options);
  const zip = await JSZip.loadAsync(out);
  return zip.file('ppt/slides/slide1.xml')!.async('string');
}

function contentParas(xml: string): string[] {
  return [...xml.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)]
    .map((m) => m[0])
    .filter((p) => /<a:t>/.test(p));
}

describe('rule 13.1–13.2: single / multi paragraph uniform spacing', () => {
  it('single paragraph PIXELS → one editable box with Exact lnSpc', async () => {
    const xml = await slideXml(
      text({
        characters: '一行',
        lineHeight: 32,
        lineHeightUnit: 'PIXELS',
        paragraphs: [para({ start: 0, end: 2, lineHeight: { unit: 'PIXELS', value: 32 } })],
      })
    );
    expect(xml).toContain('<p:txBody>');
    expect(xml).toContain('<a:spcPts val="3200"/>');
    expect(xml).toContain('<a:t>一行</a:t>');
  });

  it('multi-line same PIXELS → soft-break + shared Exact lnSpc', async () => {
    const xml = await slideXml(
      text({
        characters: 'LineA\nLineB',
        lineHeight: 28,
        lineHeightUnit: 'PIXELS',
        paragraphs: [
          para({ start: 0, end: 5, lineHeight: { unit: 'PIXELS', value: 28 } }),
          para({ start: 6, end: 11, lineHeight: { unit: 'PIXELS', value: 28 } }),
        ],
      })
    );
    expect(contentParas(xml)).toHaveLength(2);
    expect(xml).not.toContain('<a:br/>');
    expect(xml).toContain('<a:spcPts val="2800"/>');
    // Zero Figma paragraphSpacing → no spcAft; row gap comes from Exact lnSpc only.
    expect(xml).not.toContain('<a:spcAft>');
  });
});

describe('rule 13.3–13.6: mixed / percent / auto line heights', () => {
  it('keeps distinct paragraphs for different PIXELS values', async () => {
    const xml = await slideXml(
      text({
        characters: 'A\nB',
        paragraphs: [
          para({ start: 0, end: 1, lineHeight: { unit: 'PIXELS', value: 40 } }),
          para({ start: 2, end: 3, lineHeight: { unit: 'PIXELS', value: 24 } }),
        ],
      })
    );
    expect(xml).not.toContain('<a:br/>');
    expect(xml).toContain('<a:spcPts val="4000"/>');
    expect(xml).toContain('<a:spcPts val="2400"/>');
    expect(xml).not.toContain('<a:spcAft>');
  });

  it('keeps distinct paragraphs for different PERCENT values', async () => {
    const xml = await slideXml(
      text({
        characters: 'A\nB',
        paragraphs: [
          para({ start: 0, end: 1, lineHeight: { unit: 'PERCENT', value: 150 } }),
          para({ start: 2, end: 3, lineHeight: { unit: 'PERCENT', value: 200 } }),
        ],
      })
    );
    expect(xml).toContain('<a:spcPts val="3000"/>');
    expect(xml).toContain('<a:spcPts val="4000"/>');
  });

  it('AUTO omits lnSpc', async () => {
    const xml = await slideXml(
      text({
        characters: 'Auto',
        lineHeight: null,
        lineHeightUnit: 'AUTO',
        paragraphs: [para({ start: 0, end: 4, lineHeight: { unit: 'AUTO' } })],
      })
    );
    expect(xml).not.toContain('<a:lnSpc>');
  });

  it('PIXELS + PERCENT coexist in one editable text box', async () => {
    const xml = await slideXml(
      text({
        characters: 'Fix\nPct',
        paragraphs: [
          para({ start: 0, end: 3, lineHeight: { unit: 'PIXELS', value: 30 } }),
          para({ start: 4, end: 7, lineHeight: { unit: 'PERCENT', value: 140 } }),
        ],
      })
    );
    expect(xml).toContain('<p:txBody>');
    expect(xml).toContain('<a:spcPts val="3000"/>');
    expect(xml).toContain('<a:spcPts val="2800"/>');
    expect(contentParas(xml).length).toBeGreaterThanOrEqual(2);
  });
});

describe('rule 13.7–13.8: mixed runs and CJK', () => {
  it('preserves run-level fontSize / weight / family', async () => {
    const runs: IRTextRun[] = [
      { text: '中文', start: 0, end: 2, fontSize: 22, fontFamily: 'PingFang SC', fontWeight: 400, color: '#111111', letterSpacing: 0 },
      { text: 'En', start: 2, end: 4, fontSize: 18, fontFamily: 'Inter', fontWeight: 700, color: '#222222', letterSpacing: 0 },
    ];
    const xml = await slideXml(
      text({
        characters: '中文En',
        runs,
        paragraphs: [para({ start: 0, end: 4 })],
      })
    );
    expect(xml).toContain('<a:t>中文</a:t>');
    expect(xml).toContain('<a:t>En</a:t>');
    expect(xml).toContain('sz="2200"');
    expect(xml).toContain('sz="1800"');
    expect(xml).toMatch(/typeface="PingFang SC"/);
    expect(xml).toMatch(/typeface="Inter"/);
  });
});

describe('rule 13.9–13.10: breaks and paragraph spacing', () => {
  it('synthesizes per-newline paragraphs when IR paragraphs are missing', () => {
    const resolved = resolveTextParagraphs(
      text({
        characters: 'One\nTwo\nThree',
        lineHeight: 36,
        lineHeightUnit: 'PIXELS',
        paragraphs: undefined,
      })
    );
    expect(resolved).toHaveLength(3);
    expect(resolved.every((p) => p.lineHeight?.unit === 'PIXELS' && p.lineHeight.value === 36)).toBe(
      true
    );
    expect(softBreakGroups(resolved)).toEqual([[0], [1], [2]]);
  });

  it('fallback synthesis still soft-breaks and injects Exact lnSpc on all visual rows', async () => {
    const xml = await slideXml(
      text({
        characters: 'One\nTwo',
        lineHeight: 30,
        lineHeightUnit: 'PIXELS',
        // intentionally no paragraphs — exercises resolveTextParagraphs fallback
      })
    );
    expect(xml).not.toContain('<a:br/>');
    expect(xml).toContain('<a:spcPts val="3000"/>');
    expect(contentParas(xml)).toHaveLength(2);
  });

  it('keeps separate <a:p> when paragraphSpacing > 0 (no soft-break)', async () => {
    const xml = await slideXml(
      text({
        characters: 'A\nB',
        paragraphs: [
          para({
            start: 0,
            end: 1,
            lineHeight: { unit: 'PIXELS', value: 30 },
            paragraphSpacing: 10,
          }),
          para({ start: 2, end: 3, lineHeight: { unit: 'PIXELS', value: 30 } }),
        ],
      })
    );
    expect(xml).not.toContain('<a:br/>');
    // Explicit Figma paragraphSpacing only — do not add nextLH into spcAft.
    expect(xml).toContain('<a:spcAft><a:spcPts val="1000"/></a:spcAft>');
    expect(xml).toContain('<a:spcPts val="3000"/>');
  });

  it('mixed PIXELS paragraphs stay separate; zero spacing → no invented spcAft', async () => {
    const xml = await slideXml(
      text({
        characters: '宽\n窄',
        paragraphs: [
          para({ start: 0, end: 1, lineHeight: { unit: 'PIXELS', value: 36 }, paragraphSpacing: 0 }),
          para({ start: 2, end: 3, lineHeight: { unit: 'PIXELS', value: 18 }, paragraphSpacing: 0 }),
        ],
      })
    );
    expect(xml).not.toContain('<a:br/>');
    expect(xml).toContain('<a:spcPts val="3600"/>');
    expect(xml).toContain('<a:spcPts val="1800"/>');
    // Own Exact lnSpc per para; no nextLH folded into spcAft (overflow guard).
    expect(xml).not.toContain('<a:spcAft>');
  });

  it('mixed quote stack: each item keeps own lnSpc, explicit spcAft only, no join', async () => {
    const q1 = '“短句一行”';
    const q2 = '“长句保持独立条目”';
    const q3 = '“下一条不接上一条”';
    const characters = `${q1}\n${q2}\n${q3}`;
    const p0 = q1.length;
    const p1 = p0 + 1 + q2.length;
    const xml = await slideXml(
      text({
        characters,
        paragraphs: [
          para({
            start: 0,
            end: p0,
            lineHeight: { unit: 'PIXELS', value: 30 },
            paragraphSpacing: 10,
            breakAfter: 'paragraphBreak',
          }),
          para({
            start: p0 + 1,
            end: p1,
            lineHeight: { unit: 'PIXELS', value: 20 },
            paragraphSpacing: 10,
            breakAfter: 'paragraphBreak',
          }),
          para({
            start: p1 + 1,
            end: characters.length,
            lineHeight: { unit: 'PIXELS', value: 30 },
            paragraphSpacing: 0,
          }),
        ],
      })
    );
    expect(xml).not.toContain('<a:br/>');
    expect(contentParas(xml)).toHaveLength(3);
    expect(xml).toContain('<a:spcPts val="3000"/>');
    expect(xml).toContain('<a:spcPts val="2000"/>');
    // spcAft = 10 only (1000), not 10+nextLH.
    expect(xml).toContain('<a:spcAft><a:spcPts val="1000"/></a:spcAft>');
    expect(xml).not.toContain('<a:spcAft><a:spcPts val="4000"/></a:spcAft>');
    expect(xml).not.toContain('<a:spcAft><a:spcPts val="3000"/></a:spcAft>');
    // q3 must remain its own paragraph text, not appended to q2.
    expect(xml).toMatch(/<a:t>“长句保持独立条目”<\/a:t>/);
    expect(xml).toMatch(/<a:t>“下一条不接上一条”<\/a:t>/);
    expect(xml).not.toMatch(/长句保持独立条目”“下一条/);
  });
});

describe('rule 13.11: vertical alignment without geometry nudge', () => {
  it('maps TOP / CENTER / BOTTOM and keeps measured rect', () => {
    expect(TEXT_VERTICAL_POLICY.allowGeometryNudge).toBe(false);
    expect(TEXT_VERTICAL_POLICY.allowInsetFromLineMetrics).toBe(false);
    expect(TEXT_VERTICAL_POLICY.forceCenterAlign).toBe(false);

    for (const align of ['TOP', 'CENTER', 'BOTTOM'] as const) {
      const layer = text({
        rect: { x: 50, y: 80, width: 300, height: 90 },
        textAlignVertical: align,
        lineHeight: 40,
        lineHeightUnit: 'PIXELS',
      });
      const opts = textBoxOptions(layer);
      expect(opts.valign).toBe(pptxValignFromFigma(align));
      expect(opts.y).toBe(slidePtToInch(80));
      expect(opts.h).toBe(slidePtToInch(90));
      expect(opts.margin).toEqual([0, 0, 0, 0]);
      assertTextBoxVerticalPolicy({
        y: opts.y as number,
        h: opts.h as number,
        sourceY: slidePtToInch(80),
        sourceH: slidePtToInch(90),
        margin: opts.margin,
        valign: opts.valign,
        textAlignVertical: align,
      });
    }
  });

  it('CENTER + soft-break still preserves geometry and bodyPr anchor', async () => {
    const xml = await slideXml(
      text({
        characters: '上\n下',
        rect: { x: 10, y: 20, width: 200, height: 80 },
        textAlignVertical: 'CENTER',
        lineHeight: 36,
        lineHeightUnit: 'PIXELS',
        paragraphs: [
          para({ start: 0, end: 1, lineHeight: { unit: 'PIXELS', value: 36 } }),
          para({ start: 2, end: 3, lineHeight: { unit: 'PIXELS', value: 36 } }),
        ],
      })
    );
    expect(xml).toContain('cx="2540000"'); // 200pt
    expect(xml).toContain('cy="1016000"'); // 80pt
    expect(xml).toMatch(/anchor="ctr"/);
    expect(xml).not.toContain('<a:br/>');
    expect(xml).toContain('<a:spcPts val="3600"/>');
    expect(xml).not.toContain('<a:spAutoFit');
  });

  it('bodyPrAnchorFromFigma is the only vertical-align mapping', () => {
    expect(bodyPrAnchorFromFigma('TOP')).toBe('t');
    expect(bodyPrAnchorFromFigma('CENTER')).toBe('ctr');
    expect(bodyPrAnchorFromFigma('BOTTOM')).toBe('b');
  });
});

describe('rule 13.12–13.14: containers, editability, no default PNG', () => {
  it('Reader split matches resolveTextParagraphs for uniform metrics', () => {
    const characters = '甲\n乙';
    const segment = {
      text: characters,
      start: 0,
      end: 3,
      fontSize: 16,
      fontFamily: 'Inter',
      fontWeight: 400,
      color: '#000',
      letterSpacing: 0,
      lineHeight: { unit: 'PIXELS' as const, value: 24 },
      paragraphSpacing: 0,
      paragraphIndent: 0,
    };
    const fromReader = buildTextParagraphs(characters, [segment], 'LEFT');
    const fromResolve = resolveTextParagraphs(
      text({
        characters,
        lineHeight: 24,
        lineHeightUnit: 'PIXELS',
        paragraphs: undefined,
      })
    );
    expect(fromReader.map((p) => [p.start, p.end])).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(fromResolve.map((p) => [p.start, p.end])).toEqual(fromReader.map((p) => [p.start, p.end]));
  });

  it('mixed line-height stays native editable by default', () => {
    const decision = decideMixedLineHeightRender(
      {
        characters: 'a\nb',
        paragraphs: [
          para({ start: 0, end: 1, mixedLineHeight: true, lineHeight: null }),
        ],
        visualLineStatus: 'unavailable',
      },
      'editable'
    );
    expect(decision.kind).toBe('native');
  });

  it('exported shape remains an editable text box', async () => {
    const xml = await slideXml(
      text({
        characters: '可编辑\n第二行',
        lineHeight: 28,
        lineHeightUnit: 'PIXELS',
        paragraphs: [
          para({ start: 0, end: 3, lineHeight: { unit: 'PIXELS', value: 28 } }),
          para({ start: 4, end: 7, lineHeight: { unit: 'PIXELS', value: 28 } }),
        ],
      })
    );
    expect(xml).toContain('txBox="1"');
    expect(xml).toContain('<p:txBody>');
    expect(xml).not.toContain('<p:pic>');
  });
});
