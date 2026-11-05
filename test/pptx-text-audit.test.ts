import { describe, expect, it } from 'vitest';
import { createPptx } from '../src/converter/converter';
import { postProcessPptx } from '../src/converter/postprocess';
import { auditPptxText } from '../src/report/pptx-text-audit';
import type { IRDocument, IRText } from '../src/ir/types';

function title(): IRText {
  return {
    id: 'title',
    type: 'text',
    rect: { x: 195, y: 105, width: 796, height: 167 },
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    characters: 'Insight & Idea',
    fontSize: 140,
    fontFamily: 'SF Pro',
    fontStyle: 'Regular',
    fontWeight: 400,
    color: '#FFFFFF',
    letterSpacing: 0,
    lineHeight: null,
    lineHeightUnit: 'AUTO',
    paragraphSpacing: 0,
    paragraphIndent: 0,
    textAutoResize: 'WIDTH_AND_HEIGHT',
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    paragraphs: [
      {
        start: 0,
        end: 14,
        lineHeight: { unit: 'AUTO' },
        mixedLineHeight: false,
        paragraphSpacing: 0,
        paragraphIndent: 0,
        leadingTrim: 'NONE',
      },
    ],
  };
}

describe('PPTX text audit', () => {
  it('reports final geometry, body properties, paragraph metrics and run font data', async () => {
    const doc: IRDocument = {
      slides: [
        {
          id: 'slide',
          name: 'Slide',
          width: 1920,
          height: 1080,
          backgroundColor: '#000000',
          elements: [title()],
        },
      ],
      report: { entries: [] },
    };
    const pptx = createPptx(doc, { sizePreset: 'frame', strategy: 'editable' });
    const raw = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
    const output = await postProcessPptx(raw, doc, {
      sizePreset: 'frame',
      strategy: 'editable',
    });

    const audit = await auditPptxText(output);

    expect(audit).toEqual([
      expect.objectContaining({
        slide: 1,
        objectName: 'F2P_TXT_title',
        text: 'Insight & Idea',
        geometryPx: { x: 195, y: 105, width: 796, height: 167 },
        body: expect.objectContaining({
          anchor: 't',
          insetsPx: { left: 0, top: 0, right: 0, bottom: 0 },
          autofit: 'none',
        }),
        paragraphs: [
          expect.objectContaining({
            lineSpacing: null,
            spaceBeforePt: 0,
            spaceAfterPt: 0,
          }),
        ],
        runs: [
          expect.objectContaining({
            fontFace: 'SF Pro',
            fontSizePt: 140, // 100%: Figma 140 → 140pt
          }),
        ],
      }),
    ]);
  });
});
