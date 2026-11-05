import { describe, it, expect } from 'vitest';
import { textBoxOptions } from '../src/converter/text';
import { slidePtToInch } from '../src/converter/page-scale';
import type { IRDocument, IRText } from '../src/ir/types';
import JSZip from 'jszip';
import { createPptx } from '../src/converter/converter';
import { postProcessPptx } from '../src/converter/postprocess';

function text(overrides: Partial<IRText> = {}): IRText {
  return {
    id: 't1',
    type: 'text',
    rect: { x: 100, y: 200, width: 400, height: 80 },
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

describe('text box geometry stays Figma-native', () => {
  it('does not nudge Y/H or invent top inset from render bounds', () => {
    const opts = textBoxOptions(
      text({
        rect: { x: 195, y: 105, width: 796, height: 167 },
        fontSize: 140,
        textAlignVertical: 'TOP',
        sourceRenderBounds: { x: 195, y: 140, width: 700, height: 100 },
      })
    );
    expect(opts.x).toBe(slidePtToInch(195));
    expect(opts.y).toBe(slidePtToInch(105));
    expect(opts.w).toBe(slidePtToInch(796));
    expect(opts.h).toBe(slidePtToInch(167));
    expect(opts.margin).toEqual([0, 0, 0, 0]);
    expect(opts.valign).toBe('top');
  });

  it('does not use the SVG baseline as a top inset', () => {
    const opts = textBoxOptions(
      text({
        textAlignVertical: 'TOP',
        visualLineStatus: 'exact',
        sourceSvgViewBox: { x: 0, y: 0, width: 400, height: 80 },
        visualLines: [
          { start: 0, end: 5, text: 'Hello', x: 0, baselineY: 28, paragraphIndex: 0 },
        ],
      })
    );
    expect(opts.margin).toEqual([0, 0, 0, 0]);
  });

  it('preserves CENTER and BOTTOM valign mapping', () => {
    expect(textBoxOptions(text({ textAlignVertical: 'CENTER' })).valign).toBe('middle');
    expect(textBoxOptions(text({ textAlignVertical: 'BOTTOM' })).valign).toBe('bottom');
  });
});

describe('soft-break collapse for shared PIXELS line height', () => {
  async function slideXml(textEl: IRText): Promise<string> {
    const doc: IRDocument = {
      slides: [
        {
          id: 's1',
          name: 'Slide-1',
          width: 1920,
          height: 1080,
          backgroundColor: '#000000',
          elements: [textEl],
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

  it('merges Insight-style two lines into one editable paragraph with br + Exact lnSpc', async () => {
    const xml = await slideXml(
      text({
        id: 'insight-body',
        characters: '慥螎谥頠纄愚奃、嬅掹嘔澁奷嘓嘚暦纄箯悃琛廴，\n港尸朕睜弨堙頉嚺纄漀瀸柃廠蔠',
        fontSize: 20,
        fontFamily: 'PingFang SC',
        rect: { x: 972, y: 568, width: 748, height: 80 },
        lineHeight: 40,
        lineHeightUnit: 'PIXELS',
        textAlignVertical: 'TOP',
        paragraphs: [
          {
            start: 0,
            end: 22,
            lineHeight: { unit: 'PIXELS', value: 40 },
            mixedLineHeight: false,
            paragraphSpacing: 0,
            paragraphIndent: 0,
            textAlignHorizontal: 'LEFT',
          },
          {
            start: 23,
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

    // Geometry 748×80 pt → EMU (×12700).
    expect(xml).toContain('<a:ext cx="9499600" cy="1016000"/>');
    expect(xml).toMatch(/<a:bodyPr[^>]*lIns="0"[^>]*tIns="0"[^>]*rIns="0"[^>]*bIns="0"[^>]*anchor="t"/);
    expect(xml).not.toContain('<a:spAutoFit');
    expect(xml).not.toContain('<a:br/>');
    expect(xml).toContain('<a:spcPts val="4000"/>'); // 40px @100%
    const contentParas = [...xml.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].filter((match) =>
      /<a:t>/.test(match[0])
    );
    expect(contentParas).toHaveLength(2);
    expect(contentParas[0][0]).toContain('慥螎谥頠');
    expect(contentParas[1][0]).toContain('港尸朕睜弨堙頉嚺');
    expect(contentParas[0][0].match(/<a:lnSpc>/g)?.length ?? 0).toBe(1);
  });

  it('keeps distinct paragraphs when line metrics or paragraph spacing differ', async () => {
    const xml = await slideXml(
      text({
        characters: 'One\nTwo',
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
            paragraphIndent: 0,
            textAlignHorizontal: 'RIGHT',
          },
        ],
      })
    );
    expect(xml).not.toContain('<a:br/>');
    const paragraphProperties = [...xml.matchAll(/<a:pPr\b[\s\S]*?<\/a:pPr>/g)].map((m) => m[0]);
    expect(paragraphProperties.length).toBeGreaterThanOrEqual(2);
    expect(paragraphProperties[0]).toContain('<a:spcPts val="2400"/>');
    expect(paragraphProperties[0]).toContain('<a:spcAft><a:spcPts val="1200"/></a:spcAft>');
    expect(paragraphProperties[1]).toContain('<a:spcPts val="4800"/>');
  });
});
