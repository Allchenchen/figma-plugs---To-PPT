/**
 * Build candidate PPTX for mixed line-height + paragraph spacing (quote stack).
 * Evidence-only export — does not change conversion rules.
 */
import { writeFileSync } from 'fs';
import JSZip from 'jszip';
import { createPptx } from '../src/converter/converter';
import { postProcessPptx } from '../src/converter/postprocess';
import { lockVisualWraps } from '../src/converter/text-wrap';
import type { ExportOptions, IRDocument, IRText, IRTextParagraph } from '../src/ir/types';

function para(
  start: number,
  end: number,
  lh: number,
  spc: number,
  breakAfter?: 'softBreak' | 'paragraphBreak'
): IRTextParagraph {
  return {
    start,
    end,
    lineHeight: { unit: 'PIXELS', value: lh },
    mixedLineHeight: false,
    paragraphSpacing: spc,
    paragraphIndent: 0,
    textAlignHorizontal: 'LEFT',
    breakAfter,
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
  const logical = [q1, q2a + q2b, q3, ...rest];
  const characters = logical.join('\n');
  let pos = 0;
  const paragraphs: IRTextParagraph[] = logical.map((line, i) => {
    const start = pos;
    const end = pos + line.length;
    pos = end + 1;
    const lh = i === 1 ? 20 : 30;
    const spc = i < logical.length - 1 ? 10 : 0;
    return para(start, end, lh, spc, i < logical.length - 1 ? 'paragraphBreak' : undefined);
  });

  const visualLines = [];
  let y = 20;
  let off = 0;
  for (let i = 0; i < logical.length; i += 1) {
    if (i === 1) {
      visualLines.push({
        start: off,
        end: off + q2a.length,
        text: q2a,
        x: 0,
        baselineY: y,
        paragraphIndex: i,
      });
      y += 20;
      off += q2a.length;
      visualLines.push({
        start: off,
        end: off + q2b.length,
        text: q2b,
        x: 0,
        baselineY: y,
        paragraphIndex: i,
      });
      y += 30;
      off += q2b.length + 1;
    } else {
      visualLines.push({
        start: off,
        end: off + logical[i].length,
        text: logical[i],
        x: 0,
        baselineY: y,
        paragraphIndex: i,
      });
      y += 40;
      off += logical[i].length + 1;
    }
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
    paragraphs,
    visualLineStatus: 'exact',
    visualLines,
  };

  const two =
    '慥螎谥頠纄愚奃、嬅掹嘔澁奷嘓嘚暦纄箯悃琛廴，\n港尸朕睜弨堙頉嚺纄漀瀸柃廠蔠';
  const i1 = two.indexOf('\n');
  const body: IRText = {
    id: '4:21',
    type: 'text',
    rect: { x: 560, y: 80, width: 748, height: 80 },
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    characters: two,
    fontSize: 20,
    fontFamily: 'PingFang SC',
    fontWeight: 400,
    color: '#FFFFFF',
    letterSpacing: 0,
    lineHeight: 40,
    lineHeightUnit: 'PIXELS',
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    paragraphs: [
      para(0, i1, 40, 0, 'paragraphBreak'),
      para(i1 + 1, two.length, 40, 0),
    ],
  };

  const locked = lockVisualWraps(quotes);
  const doc: IRDocument = {
    slides: [
      {
        id: 's1',
        name: 'mixed-lh',
        width: 1920,
        height: 1080,
        backgroundColor: '#1a1a2e',
        elements: [locked, body],
      },
    ],
    report: { entries: [] },
  };
  const options: ExportOptions = { sizePreset: 'frame', strategy: 'editable' };
  const pptx = createPptx(doc, options);
  const buf = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
  const out = await postProcessPptx(buf, doc, options);
  writeFileSync('fixtures/exports/mixed-lh-spacing-candidate.pptx', out);

  const zip = await JSZip.loadAsync(out);
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
  for (const id of ['29:270', '4:21']) {
    const idx = xml.indexOf(`name="F2P_TXT_${id}"`);
    const start = xml.lastIndexOf('<p:sp>', idx);
    const end = xml.indexOf('</p:sp>', idx);
    const sp = xml.slice(start, end + 7);
    const paras = [...sp.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].map((m) => m[0]);
    const br = (sp.match(/<a:br\s*\/>/g) || []).length;
    console.log(`\n=== ${id} p=${paras.length} br=${br}`);
    for (let i = 0; i < paras.length; i += 1) {
      const p = paras[i];
      const t = [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]).join('');
      const ln = (p.match(/<a:lnSpc>[\s\S]*?<\/a:lnSpc>/) || [])[0];
      const aft = (p.match(/<a:spcAft>[\s\S]*?<\/a:spcAft>/) || [])[0];
      console.log(
        i,
        'ln=',
        ln ? ln.replace(/\s+/g, ' ') : '-',
        'aft=',
        aft ? aft.replace(/\s+/g, ' ') : '-',
        't=',
        JSON.stringify(t).slice(0, 48)
      );
    }
  }
  console.log('\nwrote fixtures/exports/mixed-lh-spacing-candidate.pptx');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
