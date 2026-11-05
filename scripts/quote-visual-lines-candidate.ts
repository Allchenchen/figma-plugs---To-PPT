/**
 * Candidate PPTX: right-side quote block with Figma visual lines locked.
 * Does not modify conversion rules — export evidence for line-by-line check.
 */
import { writeFileSync } from 'fs';
import JSZip from 'jszip';
import { createPptx } from '../src/converter/converter';
import { postProcessPptx } from '../src/converter/postprocess';
import { lockVisualWraps } from '../src/converter/text-wrap';
import type { ExportOptions, IRDocument, IRText, IRTextParagraph } from '../src/ir/types';

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

async function main(): Promise<void> {
  const q1 = '“坠栻製缋娰漉嚺日坜娰痱愜，维殥罡弨璙寑嘊”';
  const q2a = '“坠鷮樑弨慥螎捦娰嚆囀噈？枈麾鏴姺濐嘀囶奷坓纄嚋，坆樑聮掞釁鏆娰嚆';
  const q2b = '囀噈港遌嘚瀇姆，蠌嘔港弨枈愚枈愚涹齢”';
  const q3 = '“弨慥螎，樑纄尌嚋搱壏掶嚺嘀瀷”';
  const rest = [
    '“樑嘺滾蛏港慥螎纄嘀屘蠌椟娰觪鑪”',
    '“娛椏璡漉橀鐓纄僘擰樖坎鐷”',
    '“琸韜埝欁慽慇柃”',
    '“艿囀噈飽枈觪弨”',
    '“珏愩飽壏渟漟嚔。”',
    '“樑港樑囬廢鸟駌崯嘀纄维紷”',
    '......',
  ];

  // Simulate broken source: wrap point + next quote glued (spaces / no `\n`).
  const brokenTail = `${q2a}  ${q2b}${q3}`;
  const characters = [q1, brokenTail, ...rest].join('\n');

  const visualLines = [
    { start: 0, end: q1.length, text: q1, x: 0, baselineY: 20, paragraphIndex: 0 },
    {
      start: q1.length + 1,
      end: q1.length + 1 + q2a.length,
      text: q2a,
      x: 0,
      baselineY: 50,
      paragraphIndex: 1,
    },
    {
      start: q1.length + 1 + q2a.length + 2,
      end: q1.length + 1 + q2a.length + 2 + q2b.length,
      text: q2b,
      x: 0,
      baselineY: 70,
      paragraphIndex: 1,
    },
    {
      start: q1.length + 1 + q2a.length + 2 + q2b.length,
      end: q1.length + 1 + brokenTail.length,
      text: q3,
      x: 0,
      baselineY: 100,
      paragraphIndex: 1,
    },
  ];

  let pos = q1.length + 1 + brokenTail.length + 1;
  let y = 130;
  for (let i = 0; i < rest.length; i += 1) {
    const line = rest[i];
    visualLines.push({
      start: pos,
      end: pos + line.length,
      text: line,
      x: 0,
      baselineY: y,
      paragraphIndex: 2 + i,
    });
    pos += line.length + 1;
    y += 30;
  }

  const quotes: IRText = {
    id: '29:270',
    type: 'text',
    rect: { x: 100, y: 80, width: 420, height: 520 },
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    characters,
    fontSize: 14,
    fontFamily: 'PingFang SC',
    fontWeight: 400,
    color: '#FFFFFF',
    letterSpacing: 0,
    lineHeight: 30,
    lineHeightUnit: 'PIXELS',
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    paragraphs: [
      para({
        start: 0,
        end: q1.length,
        lineHeight: { unit: 'PIXELS', value: 30 },
        paragraphSpacing: 10,
      }),
      para({
        start: q1.length + 1,
        end: q1.length + 1 + brokenTail.length,
        lineHeight: { unit: 'PIXELS', value: 20 },
        paragraphSpacing: 10,
      }),
      ...rest.map((line, i) => {
        const start =
          q1.length +
          1 +
          brokenTail.length +
          1 +
          rest.slice(0, i).reduce((n, s) => n + s.length + 1, 0);
        return para({
          start,
          end: start + line.length,
          lineHeight: { unit: 'PIXELS', value: 30 },
          paragraphSpacing: i < rest.length - 1 ? 10 : 0,
        });
      }),
    ],
    visualLineStatus: 'exact',
    visualLines,
  };

  const locked = lockVisualWraps(quotes);
  const figmaRows = locked.characters.split('\n');
  console.log('=== Figma visual lines (baked) ===');
  figmaRows.forEach((row, i) => console.log(`${i}: ${JSON.stringify(row)}`));

  const doc: IRDocument = {
    slides: [
      {
        id: 's1',
        name: 'quote-visual-lines',
        width: 1920,
        height: 1080,
        backgroundColor: '#1a1a2e',
        elements: [locked],
      },
    ],
    report: { entries: [] },
  };
  const options: ExportOptions = { sizePreset: 'frame', strategy: 'editable' };
  const pptx = createPptx(doc, options);
  const buf = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
  const out = await postProcessPptx(buf, doc, options);
  writeFileSync('fixtures/exports/quote-visual-lines-candidate.pptx', out);

  const zip = await JSZip.loadAsync(out);
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
  const idx = xml.indexOf('F2P_TXT_29:270');
  const sp = xml.slice(xml.lastIndexOf('<p:sp>', idx), xml.indexOf('</p:sp>', idx) + 7);
  const wrap = sp.match(/wrap="[^"]+"/)?.[0];
  const pptRows: string[] = [];
  for (const p of sp.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)) {
    let row = '';
    for (const m of p[0].matchAll(/<a:br\s*\/>|<a:t>([\s\S]*?)<\/a:t>/g)) {
      if (m[0].startsWith('<a:br')) {
        pptRows.push(row);
        row = '';
      } else {
        row += m[1];
      }
    }
    pptRows.push(row);
  }

  console.log('\n=== PPT rows (wrap', wrap, ') ===');
  pptRows.forEach((row, i) => console.log(`${i}: ${JSON.stringify(row)}`));

  console.log('\n=== Line-by-line compare ===');
  const n = Math.max(figmaRows.length, pptRows.length);
  let ok = true;
  for (let i = 0; i < n; i += 1) {
    const a = figmaRows[i] ?? '∅';
    const b = pptRows[i] ?? '∅';
    const match = a === b;
    if (!match) ok = false;
    console.log(`${match ? 'OK' : 'DIFF'} [${i}] Figma=${JSON.stringify(a)} PPT=${JSON.stringify(b)}`);
  }
  console.log(ok ? '\nALL ROWS MATCH' : '\nMISMATCH');
  console.log('wrote fixtures/exports/quote-visual-lines-candidate.pptx');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
