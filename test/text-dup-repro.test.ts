import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createPptx } from '../src/converter/converter';
import { postProcessPptx } from '../src/converter/postprocess';
import { lockVisualWraps } from '../src/converter/text-wrap';
import { textRuns } from '../src/converter/text';
import type { IRDocument, IRText } from '../src/ir/types';

describe('insight/idea duplication regression', () => {
  it('does not duplicate insight second line or emit empty break stubs', async () => {
    const line1 = '慥螎谥頠纄愚奃、嬅掹嘔澁奷嘓嘚暦纄箯悃琛廴，';
    const line2 = '港尸朕睜弨堙頉嚺纄漀瀸柃廠蔠';
    const characters = `${line1}\n${line2}`;
    const layer: IRText = {
      id: 'insight',
      type: 'text',
      rect: { x: 100, y: 200, width: 748, height: 80 },
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      characters,
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
        {
          start: 0,
          end: line1.length,
          lineHeight: { unit: 'PIXELS', value: 40 },
          mixedLineHeight: false,
          paragraphSpacing: 0,
          paragraphIndent: 0,
          textAlignHorizontal: 'LEFT',
        },
        {
          start: line1.length + 1,
          end: characters.length,
          lineHeight: { unit: 'PIXELS', value: 40 },
          mixedLineHeight: false,
          paragraphSpacing: 0,
          paragraphIndent: 0,
          textAlignHorizontal: 'LEFT',
        },
      ],
      visualLineStatus: 'exact',
      visualLines: [
        { start: 0, end: line1.length, text: line1, x: 0, baselineY: 20, paragraphIndex: 0 },
        {
          start: line1.length + 1,
          end: characters.length,
          text: line2,
          x: 0,
          baselineY: 60,
          paragraphIndex: 1,
        },
      ],
      runs: [
        {
          text: characters,
          start: 0,
          end: characters.length,
          fontSize: 20,
          fontFamily: 'PingFang SC',
          fontWeight: 400,
          color: '#FFFFFF',
          letterSpacing: 0,
        },
      ],
    };

    const runs = textRuns(lockVisualWraps(layer));
    expect(runs.every((r) => r.text.length > 0)).toBe(true);

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
    const pptx = createPptx(doc, { sizePreset: 'frame', strategy: 'editable' });
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
    const out = await postProcessPptx(buffer, doc, { sizePreset: 'frame', strategy: 'editable' });
    const zip = await JSZip.loadAsync(out);
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    expect(texts.filter((t) => t.includes('港尸朕')).length).toBe(1);
    expect(texts.join('')).toBe(line1 + line2);
    expect(xml).not.toContain('<a:br/>');
  });

  it('does not duplicate auto-wrapped idea lines or leave empty break stubs', async () => {
    const line1 = '囥“揻橾舀漉媨穩”嘺娛椏嘻亘，';
    const line2 = '樑囬搆甞揟娰纄峁穌穹锨曶摕嘺嚔嘪瀸柃囷堼釂，';
    const line3 = '晶嘺珏嘀臍囷堼镋嚈嘀嘪奨涰纄“舀漉媨穩”杢鑡，坜嘺釆釉麐嶻。';
    const line4 = '鎩実漬檽鑡纄涇嬖寘林寯釁、寯椟，囎蠌尸朕缟獣慑專纄嚺媠奥奶嘭。';
    const characters = `${line1}${line2}${line3}${line4}`;
    const layer: IRText = {
      id: 'idea',
      type: 'text',
      rect: { x: 100, y: 400, width: 800, height: 200 },
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      characters,
      fontSize: 18,
      fontFamily: 'PingFang SC',
      fontWeight: 400,
      color: '#FFFFFF',
      letterSpacing: 0,
      lineHeight: 36,
      lineHeightUnit: 'PIXELS',
      textAlignHorizontal: 'LEFT',
      textAlignVertical: 'TOP',
      paragraphs: [
        {
          start: 0,
          end: characters.length,
          lineHeight: { unit: 'PIXELS', value: 36 },
          mixedLineHeight: false,
          paragraphSpacing: 0,
          paragraphIndent: 0,
          textAlignHorizontal: 'LEFT',
        },
      ],
      visualLineStatus: 'exact',
      visualLines: [
        { start: 0, end: line1.length, text: line1, x: 0, baselineY: 20, paragraphIndex: 0 },
        {
          start: line1.length,
          end: line1.length + line2.length,
          text: line2,
          x: 0,
          baselineY: 56,
          paragraphIndex: 0,
        },
        {
          start: line1.length + line2.length,
          end: line1.length + line2.length + line3.length,
          text: line3,
          x: 0,
          baselineY: 92,
          paragraphIndex: 0,
        },
        {
          start: line1.length + line2.length + line3.length,
          end: characters.length,
          text: line4,
          x: 0,
          baselineY: 128,
          paragraphIndex: 0,
        },
      ],
      runs: [
        {
          text: characters,
          start: 0,
          end: characters.length,
          fontSize: 18,
          fontFamily: 'PingFang SC',
          fontWeight: 400,
          color: '#FFFFFF',
          letterSpacing: 0,
        },
      ],
    };

    const locked = lockVisualWraps(layer);
    const emitted = textRuns(locked);
    expect(emitted.map((r) => r.text)).toEqual([line1, line2, line3, line4]);
    expect(emitted.filter((r) => r.text === '').length).toBe(0);

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
    const pptx = createPptx(doc, { sizePreset: 'frame', strategy: 'editable' });
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
    const out = await postProcessPptx(buffer, doc, { sizePreset: 'frame', strategy: 'editable' });
    const zip = await JSZip.loadAsync(out);
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    for (const line of [line1, line2, line3, line4]) {
      expect(texts.filter((t) => t === line).length).toBe(1);
    }
    expect(texts.join('')).toBe(characters);
    expect(xml).not.toMatch(/<a:br\/>\s*<a:pPr\b/);
    expect((xml.match(/<a:br\/>/g) || []).length).toBe(3);
  });
});
