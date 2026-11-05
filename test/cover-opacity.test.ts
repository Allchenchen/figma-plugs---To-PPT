import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createPptx } from '../src/converter/converter';
import { shapeRender } from '../src/converter/shape';
import { applyRootCoverOpacity } from '../src/reader/cover-opacity';
import type { IRDocument, IRElement, IRImage, IRShape } from '../src/ir/types';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function image(overrides: Partial<IRImage> = {}): IRImage {
  return {
    id: 'bg',
    type: 'image',
    rect: { x: 0, y: 0, width: 1920, height: 1080 },
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    data: PNG,
    mimeType: 'image/png',
    ...overrides,
  };
}

function veil(overrides: Partial<IRShape> = {}): IRShape {
  return {
    id: 'veil',
    type: 'shape',
    rect: { x: 0, y: 0, width: 1920, height: 1080 },
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    shapeKind: 'rect',
    fill: '#F4F4FF',
    stroke: null,
    cornerRadii: null,
    ...overrides,
  };
}

describe('background cover opacity', () => {
  it('puts the root frame opacity on the veil and leaves text and the accent line alone', () => {
    const elements: IRElement[] = [
      image(),
      veil(),
      {
        id: 'line',
        type: 'shape',
        rect: { x: 140, y: 518, width: 151, height: 6 },
        rotation: 0,
        opacity: 1,
        zIndex: 2,
        shapeKind: 'rect',
        fill: '#7E8AFF',
        stroke: null,
        cornerRadii: null,
      },
      {
        id: 'title',
        type: 'text',
        rect: { x: 140, y: 209, width: 756, height: 118 },
        rotation: 0,
        opacity: 1,
        zIndex: 3,
        characters: '感知传达',
        fontSize: 56,
        fontFamily: 'PingFang SC',
        fontWeight: 400,
        color: '#241C6B',
        letterSpacing: 0,
        lineHeight: null,
        textAlignHorizontal: 'LEFT',
        textAlignVertical: 'TOP',
      },
    ];
    applyRootCoverOpacity(elements, { width: 1920, height: 1080 }, 0.5);
    expect(elements[1].opacity).toBeCloseTo(0.5);
    expect(elements[0].opacity).toBe(1);
    expect(elements[2].opacity).toBe(1);
    expect(elements[3].opacity).toBe(1);
  });

  it('keeps a 50% veil as shape alpha over the image instead of baking it white', async () => {
    const cover = veil({ opacity: 0.5 });
    const direct = shapeRender(cover, '#FFFFFF', { bakeFill: false });
    expect(direct.options.fill).toEqual({ color: 'F4F4FF', transparency: 50 });

    const doc: IRDocument = {
      slides: [
        {
          id: 's',
          name: 's',
          width: 1920,
          height: 1080,
          backgroundColor: '#FFFFFF',
          elements: [image(), cover],
        },
      ],
      report: { entries: [] },
    };
    const pptx = createPptx(doc, { sizePreset: 'frame', strategy: 'editable' });
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(xml).toMatch(/srgbClr val="F4F4FF"><a:alpha val="50000"\/>/);
    expect(xml).not.toMatch(/srgbClr val="F9F9FF"/);
  });
});
