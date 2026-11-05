/**
 * Diagnose inter-line spacing OOXML for uniform multi-line body text.
 * Does not modify conversion rules — evidence only.
 */
import JSZip from 'jszip';
import { createPptx } from '../src/converter/converter';
import { postProcessPptx } from '../src/converter/postprocess';
import { softBreakGroups, collapsedParagraphMetrics } from '../src/converter/text-paragraphs';
import type { ExportOptions, IRDocument, IRText, IRTextParagraph } from '../src/ir/types';

function para(
  start: number,
  end: number,
  lh: number,
  spacing: number,
  breakAfter?: 'softBreak' | 'paragraphBreak'
): IRTextParagraph {
  return {
    start,
    end,
    lineHeight: { unit: 'PIXELS', value: lh },
    mixedLineHeight: false,
    paragraphSpacing: spacing,
    paragraphIndent: 0,
    textAlignHorizontal: 'LEFT',
    breakAfter,
  };
}

async function dump(label: string, layer: IRText): Promise<void> {
  const paras = layer.paragraphs ?? [];
  const groups = softBreakGroups(paras);
  const metrics = collapsedParagraphMetrics(paras, layer.visualLines);
  console.log('\n===', label, '===');
  console.log('chars', JSON.stringify(layer.characters));
  console.log('softBreakGroups', JSON.stringify(groups));
  console.log(
    'metrics',
    metrics.map((m) => ({
      ln: m.lineHeight,
      spcAft: m.paragraphSpacing,
      breakAfter: m.breakAfter,
    }))
  );

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
  const buf = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
  const out = await postProcessPptx(buf, doc, options);
  const zip = await JSZip.loadAsync(out);
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
  const pCount = (xml.match(/<a:p>/g) || []).length;
  const brCount = (xml.match(/<a:br\/>/g) || []).length;
  const ln = [...xml.matchAll(/<a:lnSpc>[\s\S]*?<\/a:lnSpc>/g)].map((m) => m[0]);
  const aft = [...xml.matchAll(/<a:spcAft>[\s\S]*?<\/a:spcAft>/g)].map((m) => m[0]);
  const bef = [...xml.matchAll(/<a:spcBef>[\s\S]*?<\/a:spcBef>/g)].map((m) => m[0]);
  console.log('OOXML p=', pCount, 'br=', brCount);
  console.log('lnSpc', ln);
  console.log('spcAft', aft);
  console.log('spcBef', bef);
}

async function main(): Promise<void> {
  const lh = 40;
  const two = '慥螎谥頠纄愚奃、嬅掹嘔澁奷嘓嘚暦纄箯悃琛廴，\n港尸朕睜弨堙頉嚺纄漀瀸柃廠蔠';
  const i1 = two.indexOf('\n');
  await dump('2-line Enter spacing=0 LH=40', {
    id: 'two',
    type: 'text',
    rect: { x: 100, y: 100, width: 748, height: 80 },
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    characters: two,
    fontSize: 20,
    fontFamily: 'PingFang SC',
    fontWeight: 400,
    color: '#FFFFFF',
    letterSpacing: 0,
    lineHeight: lh,
    lineHeightUnit: 'PIXELS',
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    paragraphs: [
      para(0, i1, lh, 0, 'paragraphBreak'),
      para(i1 + 1, two.length, lh, 0),
    ],
  });

  const lines = ['囥“揻橾舀漉媨穩”嘺娛椏嘻亘，', '樑囬搆甞揟娰纄峁穌穹锨曶摕嘺嚔嘪瀸柃囷堼釂，', '晶嘺珏嘀臍囷堼镋嚈嘀嘪奨涰纄“舀漉媨穩”杢鑡，', '坜嘺釆釉麐嶻。'];
  const four = lines.join('\n');
  let pos = 0;
  const paragraphs: IRTextParagraph[] = lines.map((line, idx) => {
    const start = pos;
    const end = pos + line.length;
    pos = end + 1;
    return para(start, end, 24, 0, idx < lines.length - 1 ? 'paragraphBreak' : undefined);
  });
  await dump('4-line Enter spacing=0 LH=24', {
    id: 'four',
    type: 'text',
    rect: { x: 780, y: 420, width: 900, height: 160 },
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    characters: four,
    fontSize: 16,
    fontFamily: 'PingFang SC',
    fontWeight: 400,
    color: '#FFFFFF',
    letterSpacing: 0,
    lineHeight: 24,
    lineHeightUnit: 'PIXELS',
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    paragraphs,
  });

  // Same 4 lines but soft-break fails (different LH) → separate groups, no invented spcAft
  const noJoin = paragraphs.map((p, i) =>
    i < paragraphs.length - 1
      ? { ...p, paragraphSpacing: 0, breakAfter: 'paragraphBreak' as const, lineHeight: { unit: 'PIXELS' as const, value: 24 + i } }
      : p
  );
  await dump('4-line DIFFERENT LH (no soft-join) — spcAft must stay 0', {
    id: 'four-mixed',
    type: 'text',
    rect: { x: 780, y: 420, width: 900, height: 200 },
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    characters: four,
    fontSize: 16,
    fontFamily: 'PingFang SC',
    fontWeight: 400,
    color: '#FFFFFF',
    letterSpacing: 0,
    lineHeight: 24,
    lineHeightUnit: 'PIXELS',
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    paragraphs: noJoin,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
