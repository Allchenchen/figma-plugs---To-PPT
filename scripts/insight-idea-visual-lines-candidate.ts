/**
 * Candidate PPTX: Insight/Idea body with Figma visual soft wraps locked.
 * Evidence for line-by-line compare — does not change conversion rules alone.
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
    lineHeight: { unit: 'PIXELS', value: 40 },
    mixedLineHeight: false,
    paragraphSpacing: 12,
    paragraphIndent: 0,
    textAlignHorizontal: 'LEFT',
    ...overrides,
  };
}

function text(overrides: Partial<IRText>): IRText {
  return {
    id: 't',
    type: 'text',
    rect: { x: 100, y: 100, width: 748, height: 200 },
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    characters: '',
    fontSize: 20,
    fontFamily: 'PingFang SC',
    fontWeight: 400,
    color: '#CCCCCC',
    letterSpacing: 0,
    lineHeight: 40,
    lineHeightUnit: 'PIXELS',
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    ...overrides,
  };
}

async function main(): Promise<void> {
  const i1a = '慥螎谥頠纄愚奃、嬅掹嘔澁奷嘓嘚暦';
  const i1b = '纄箯悃琛廴，';
  const i2 = '港尸朕睜弨堙頉嚺纄漀瀸柃廠蔠';
  const insightChars = `${i1a}${i1b}\n${i2}`;
  const insight = lockVisualWraps(
    text({
      id: '4:21',
      rect: { x: 972, y: 200, width: 748, height: 120 },
      characters: insightChars,
      paragraphs: [
        para({ start: 0, end: i1a.length + i1b.length }),
        para({ start: i1a.length + i1b.length + 1, end: insightChars.length, paragraphSpacing: 0 }),
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

  const ideaRows = [
    ['囥“揻橾舀漉媨穩”嘺娛椏嘻亘，'],
    ['樑囬搆甞揟娰纄峁穌穹锨曶摕嘺嚔', '嘪瀸柃囷堼釂，'],
    ['晶嘺珏嘀臍囷堼镋嚈嘀嘪奨涰纄“舀', '漉媨穩”杢鑡，坜嘺釆釉麐嶻。'],
    ['鎩実漬檽鑡纄涇嬖寘林寯釁、寯椟，', '囎蠌尸朕缟獣慑專纄嚺媠奥奶嘭。'],
  ];
  const ideaParas = ideaRows.map((rows) => rows.join(''));
  const ideaChars = ideaParas.join('\n');
  const visualLines: NonNullable<IRText['visualLines']> = [];
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
  const idea = lockVisualWraps(
    text({
      id: '4:19',
      fontFamily: 'SF Pro',
      rect: { x: 972, y: 360, width: 748, height: 240 },
      characters: ideaChars,
      paragraphs: ideaParagraphs,
      visualLineStatus: 'exact',
      visualLines,
    })
  );

  console.log('=== Insight baked ===');
  insight.characters.split('\n').forEach((row, i) => console.log(i, JSON.stringify(row)));
  console.log('=== Idea baked ===');
  idea.characters.split('\n').forEach((row, i) => console.log(i, JSON.stringify(row)));

  const doc: IRDocument = {
    slides: [
      {
        id: 's1',
        name: 'insight-idea-visual-lines',
        width: 1920,
        height: 1080,
        backgroundColor: '#000000',
        elements: [
          text({
            id: '4:22',
            characters: 'Insight',
            fontSize: 36,
            fontFamily: 'SF Pro',
            color: '#FFFFFF',
            rect: { x: 972, y: 140, width: 748, height: 50 },
          }),
          insight,
          text({
            id: '4:23',
            characters: 'Idea',
            fontSize: 36,
            fontFamily: 'SF Pro',
            color: '#FFFFFF',
            rect: { x: 972, y: 300, width: 748, height: 50 },
          }),
          idea,
        ],
      },
    ],
    report: { entries: [] },
  };
  const options: ExportOptions = { sizePreset: 'frame', strategy: 'editable' };
  const pptx = createPptx(doc, options);
  const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
  const out = await postProcessPptx(buffer, doc, options);
  writeFileSync('fixtures/exports/insight-idea-visual-lines-candidate.pptx', out);

  const zip = await JSZip.loadAsync(out);
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
  for (const id of ['4:21', '4:19']) {
    const part = xml.split(/<p:sp>/).find((p) => p.includes(`F2P_TXT_${id}`));
    if (!part) continue;
    const body = part.match(/<p:txBody>([\s\S]*?)<\/p:txBody>/)?.[1] ?? '';
    const wrap = body.match(/wrap="([^"]+)"/)?.[1];
    console.log(`\n=== PPT ${id} wrap=${wrap} ===`);
    for (const p of body.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? []) {
      const texts = [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
      const br = (p.match(/<a:br/g) ?? []).length;
      console.log(`  br=${br}`, texts.map((t) => JSON.stringify(t)).join(' | '));
    }
  }
  console.log('\nwrote fixtures/exports/insight-idea-visual-lines-candidate.pptx');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
