import JSZip from 'jszip';
import { createPptx } from '../src/converter/converter';
import { postProcessPptx } from '../src/converter/postprocess';
import { lockVisualWraps } from '../src/converter/text-wrap';
import { textBoxOptions, textRuns } from '../src/converter/text';
import type { ExportOptions, IRDocument, IRText } from '../src/ir/types';

function base(overrides: Partial<IRText> = {}): IRText {
  return {
    id: 't1',
    type: 'text',
    rect: { x: 780, y: 420, width: 900, height: 160 },
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    characters: '',
    fontSize: 16,
    fontFamily: 'PingFang SC',
    fontWeight: 400,
    color: '#FFFFFF',
    letterSpacing: 0,
    lineHeight: 24,
    lineHeightUnit: 'PIXELS',
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    ...overrides,
  };
}

async function dump(label: string, layer: IRText): Promise<void> {
  const locked = lockVisualWraps(layer);
  const runs = textRuns(locked);
  const opts = textBoxOptions(locked);
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
  const bodyPr = xml.match(/<a:bodyPr\b[^>]*>/)?.[0] ?? '(none)';
  const brCount = (xml.match(/<a:br\/>/g) || []).length;
  const pCount = (xml.match(/<a:p>/g) || []).length;
  const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
  const ext = xml.match(/<a:ext\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
  console.log('\n===', label, '===');
  console.log(
    'locked',
    locked.visualWrapLocked,
    'newlineCount',
    (locked.characters.match(/\n/g) || []).length
  );
  console.log(
    'breakLines',
    runs.filter((r) => r.options.breakLine).length,
    'wrapOpt',
    opts.wrap
  );
  console.log('bodyPr', bodyPr);
  console.log('br', brCount, 'p', pCount, 'cx', ext?.[1], 'cy', ext?.[2]);
  console.log('texts', texts);
}

async function main(): Promise<void> {
  const idea =
    '囥“揻橾舀漉媨穩”嘺娛椏嘻亘，樑囬搆甞揟娰纄峁穌穹锨曶摕嘺嚔嘪瀸柃囷堼釂，晶嘺珏嘀臍囷堼镋嚈嘀嘪奨涰纄“舀漉媨穩”杢鑡，坜嘺釆釉麐嶻。';
  const l1 = '囥“揻橾舀漉媨穩”嘺娛椏嘻亘，';
  const l2 = '樑囬搆甞揟娰纄峁穌穹锨曶摕嘺嚔嘪瀸柃囷堼釂，';
  const l3 = '晶嘺珏嘀臍囷堼镋嚈嘀嘪奨涰纄“舀漉媨穩”杢鑡，坜嘺釆釉麐嶻。';

  await dump('A unavailable long CJK', base({ id: 'idea-unavail', characters: idea, visualLineStatus: 'unavailable' }));
  await dump(
    'B exact 1-line (bad SVG)',
    base({
      id: 'idea-1line',
      characters: idea,
      visualLineStatus: 'exact',
      visualLines: [
        { start: 0, end: idea.length, text: idea, x: 0, baselineY: 20, paragraphIndex: 0 },
      ],
    })
  );
  await dump(
    'C exact 3-line bake',
    base({
      id: 'idea-3line',
      characters: idea,
      textAutoResize: 'HEIGHT',
      visualLineStatus: 'exact',
      visualLines: [
        {
          start: 0,
          end: l1.length,
          text: l1,
          x: 0,
          baselineY: 20,
          paragraphIndex: 0,
          lineHeightPx: 24,
        },
        {
          start: l1.length,
          end: l1.length + l2.length,
          text: l2,
          x: 0,
          baselineY: 44,
          paragraphIndex: 0,
          lineHeightPx: 24,
        },
        {
          start: l1.length + l2.length,
          end: idea.length,
          text: l3,
          x: 0,
          baselineY: 68,
          paragraphIndex: 0,
        },
      ],
      paragraphs: [
        {
          start: 0,
          end: idea.length,
          lineHeight: { unit: 'PIXELS', value: 24 },
          mixedLineHeight: false,
          paragraphSpacing: 0,
          paragraphIndent: 0,
          textAlignHorizontal: 'LEFT',
        },
      ],
    })
  );
  await dump(
    'D explicit newlines locked',
    base({
      id: 'insight',
      characters: '慥螎谥頠纄愚奃、嬅掹嘔澁奷嘓嘚暦纄箯悃琛廴，\n港尸朕睜弨堙頉嚺纄漀瀸柃廠蔠',
      rect: { x: 100, y: 100, width: 748, height: 80 },
      visualLineStatus: 'exact',
      visualLines: [
        {
          start: 0,
          end: 21,
          text: '慥螎谥頠纄愚奃、嬅掹嘔澁奷嘓嘚暦纄箯悃琛廴，',
          x: 0,
          baselineY: 20,
          paragraphIndex: 0,
          lineHeightPx: 30,
        },
        {
          start: 22,
          end: 37,
          text: '港尸朕睜弨堙頉嚺纄漀瀸柃廠蔠',
          x: 0,
          baselineY: 50,
          paragraphIndex: 1,
        },
      ],
      paragraphs: [
        {
          start: 0,
          end: 21,
          lineHeight: { unit: 'PIXELS', value: 40 },
          mixedLineHeight: false,
          paragraphSpacing: 0,
          paragraphIndent: 0,
          textAlignHorizontal: 'LEFT',
        },
        {
          start: 22,
          end: 37,
          lineHeight: { unit: 'PIXELS', value: 40 },
          mixedLineHeight: false,
          paragraphSpacing: 0,
          paragraphIndent: 0,
          textAlignHorizontal: 'LEFT',
        },
      ],
    })
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
