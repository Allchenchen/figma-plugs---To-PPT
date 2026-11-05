/**
 * Screenshot regression: Research quote block line breaks (Figma vs PPT).
 *
 * Boundary A — auto visual wrap after「釁鏆娰嚆」before「囀噈」.
 * Boundary B — next quote「弨慥螎…」must start its own row (not glued).
 *
 * These strings are fixtures only — production logic must not hardcode them.
 */
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createPptx } from '../src/converter/converter';
import { postProcessPptx } from '../src/converter/postprocess';
import { parseSvgVisualLines } from '../src/reader/text-model';
import type { ExportOptions, IRDocument, IRText, IRTextParagraph } from '../src/ir/types';

const Q1 = '“坠栻製缋娰漉嚺日坜娰痱愜，维殥罡弨璙寑嘊”';
const Q2A = '“坠鷮樑弨慥螎捦娰嚆囀噈？枈麾鏴姺濐嘀囶奷坓纄嚋，坆樑聮掞釁鏆娰嚆';
const Q2B = '囀噈港遌嘚瀇姆，蠌嘔港弨枈愚枈愚涹齢”';
const Q3 = '“弨慥螎，樑纄尌嚋搱壏掶嚺嘀瀷”';

function para(
  overrides: Partial<IRTextParagraph> & { start: number; end: number }
): IRTextParagraph {
  return {
    lineHeight: { unit: 'PIXELS', value: 20 },
    mixedLineHeight: false,
    paragraphSpacing: 10,
    paragraphIndent: 0,
    textAlignHorizontal: 'LEFT',
    ...overrides,
  };
}

function text(overrides: Partial<IRText>): IRText {
  return {
    id: 'quote-block',
    type: 'text',
    rect: { x: 100, y: 100, width: 420, height: 500 },
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    characters: '',
    fontSize: 14,
    fontFamily: 'PingFang SC',
    fontWeight: 400,
    color: '#FFFFFF',
    letterSpacing: 0,
    lineHeight: 20,
    lineHeightUnit: 'PIXELS',
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    ...overrides,
  };
}

function ooxmlRows(xml: string): string[] {
  const rows: string[] = [];
  for (const p of xml.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)) {
    let row = '';
    for (const m of p[0].matchAll(/<a:br\s*\/>|<a:t>([\s\S]*?)<\/a:t>/g)) {
      if (m[0].startsWith('<a:br')) {
        rows.push(row);
        row = '';
      } else {
        row += m[1];
      }
    }
    rows.push(row);
  }
  return rows.filter((r) => r.length > 0);
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

describe('quote linebreak fidelity (screenshot regression)', () => {
  it('SVG with spaces between wrap rows still yields exact visual lines at 嚆|囀噈 and before 弨慥螎', () => {
    // Source: continuous quote2 + quote3, with spaces where canvas wrapped (PPT bug shape).
    const source = `${Q1}\n${Q2A}  ${Q2B}${Q3}`;
    const svg = `<svg viewBox="0 0 420 200"><text>
      <tspan x="0" y="20">${Q1}</tspan>
      <tspan x="0" y="44">${Q2A}</tspan>
      <tspan x="0" y="68">${Q2B}</tspan>
      <tspan x="0" y="100">${Q3}</tspan>
    </text></svg>`;
    const result = parseSvgVisualLines(svg, source);
    expect(result.status).toBe('exact');
    expect(result.lines.map((l) => l.text)).toEqual([Q1, Q2A, Q2B, Q3]);
    // Boundary A: row ends at 嚆, next starts with 囀噈 (same split as before).
    expect(result.lines[1].text.endsWith('嚆')).toBe(true);
    expect(result.lines[2].text.startsWith('囀噈')).toBe(true);
    // Boundary B: 弨慥螎 is its own visual row.
    expect(result.lines[3].text).toBe(Q3);
  });

  it('OOXML locks Figma rows: wrap=none, 嚆|囀噈 break, 弨慥螎 not glued', async () => {
    const q2 = Q2A + Q2B;
    // No explicit \\n before Q3 — only visual lines create the boundary (path B).
    const characters = `${Q1}\n${q2}${Q3}`;
    const p0 = Q1.length;
    const q2Start = p0 + 1;
    const xml = await slideXml(
      text({
        characters,
        paragraphs: [
          para({
            start: 0,
            end: p0,
            lineHeight: { unit: 'PIXELS', value: 30 },
            paragraphSpacing: 10,
          }),
          para({
            start: q2Start,
            end: characters.length,
            lineHeight: { unit: 'PIXELS', value: 20 },
            paragraphSpacing: 10,
          }),
        ],
        visualLineStatus: 'exact',
        visualLines: [
          { start: 0, end: p0, text: Q1, x: 0, baselineY: 20, paragraphIndex: 0 },
          {
            start: q2Start,
            end: q2Start + Q2A.length,
            text: Q2A,
            x: 0,
            baselineY: 50,
            paragraphIndex: 1,
          },
          {
            start: q2Start + Q2A.length,
            end: q2Start + q2.length,
            text: Q2B,
            x: 0,
            baselineY: 70,
            paragraphIndex: 1,
          },
          {
            start: q2Start + q2.length,
            end: characters.length,
            text: Q3,
            x: 0,
            baselineY: 100,
            paragraphIndex: 1,
          },
        ],
      })
    );

    expect(xml).toMatch(/wrap="none"/);
    expect(xml).not.toMatch(/涹齢”“弨慥螎/);
    const rows = ooxmlRows(xml);
    expect(rows).toEqual([Q1, Q2A, Q2B, Q3]);
    // Structure: soft break before 囀噈 and before 弨慥螎 (not a:t-only join).
    expect(xml).toMatch(/釁鏆娰嚆<\/a:t>[\s\S]*?<a:br\s*\/>[\s\S]*?<a:t>囀噈港/);
    expect(xml).toMatch(/涹齢”<\/a:t>[\s\S]*?<a:br\s*\/>[\s\S]*?<a:t>“弨慥螎/);
  });

  it('explicit newline before next quote survives without visual lines (boundary B path A)', async () => {
    const q2 = Q2A + Q2B;
    const characters = `${q2}\n${Q3}`;
    const xml = await slideXml(
      text({
        characters,
        paragraphs: [
          para({ start: 0, end: q2.length, paragraphSpacing: 10 }),
          para({ start: q2.length + 1, end: characters.length, paragraphSpacing: 0 }),
        ],
        visualLineStatus: 'unavailable',
      })
    );
    expect(xml).not.toMatch(/涹齢”“弨慥螎/);
    const rows = ooxmlRows(xml);
    expect(rows.some((r) => r.includes(Q3) && !r.includes('涹齢”'))).toBe(true);
  });
});
