import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { createPptx } from '../src/converter/converter';
import type { IRDocument } from '../src/ir/types';

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

/**
 * Visual-consistency & editability checks (requirement 6): assert that native
 * elements keep their position, size, paint order and object TYPE in the
 * generated OOXML, and that the markup uses the editable native structures
 * PowerPoint exposes (text boxes, shapes, replaceable pictures, vertex-editable
 * custGeom). Rotation is handled upstream by rasterization (see compat.ts), so
 * native elements always carry rotation 0 today.
 */
function buildDoc(): IRDocument {
  return {
    slides: [
      {
        id: 's1',
        name: 'Slide-1',
        width: 1920,
        height: 1080,
        backgroundColor: '#FFFFFF',
        elements: [
          {
            id: 'text',
            type: 'text',
            rect: { x: 100, y: 100, width: 400, height: 80 },
            rotation: 0,
            opacity: 1,
            zIndex: 0,
            characters: 'Hello',
            fontSize: 32,
            fontFamily: 'Arial',
            fontWeight: 400,
            color: '#000000',
            letterSpacing: 0,
            lineHeight: 48,
            textAlignHorizontal: 'LEFT',
            textAlignVertical: 'TOP',
          },
          {
            id: 'rect',
            type: 'shape',
            rect: { x: 200, y: 200, width: 300, height: 150 },
            rotation: 0,
            opacity: 1,
            zIndex: 1,
            shapeKind: 'rect',
            fill: '#FF0000',
            stroke: null,
            cornerRadii: null,
          },
          {
            id: 'poly',
            type: 'shape',
            rect: { x: 600, y: 200, width: 100, height: 100 },
            rotation: 0,
            opacity: 1,
            zIndex: 2,
            shapeKind: 'polygon',
            fill: '#00FF00',
            stroke: null,
            cornerRadii: null,
            pointCount: 6,
          },
          {
            id: 'img',
            type: 'image',
            rect: { x: 800, y: 200, width: 100, height: 100 },
            rotation: 0,
            opacity: 1,
            zIndex: 3,
            data: PNG_1PX,
            mimeType: 'image/png',
          },
        ],
      },
    ],
    report: { entries: [] },
  };
}

async function slideXml(): Promise<string> {
  const pptx = createPptx(buildDoc(), { sizePreset: 'frame', strategy: 'editable' });
  const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('ppt/slides/slide1.xml')!.async('string');
}

describe('visual consistency', () => {
  it('preserves position and size in EMU', async () => {
    const xml = await slideXml();
    // 200×150 pt → EMU (×12700); 300 pt wide.
    expect(xml).toContain('x="2540000"');
    expect(xml).toContain('y="2540000"');
    expect(xml).toContain('cx="3810000"');
    expect(xml).toContain('cy="1905000"'); // 150pt × 12700
  });

  it('preserves paint order (z-index)', async () => {
    const xml = await slideXml();
    // Each marker uniquely identifies one element; they must appear in zIndex order.
    const order = ['Hello', 'FF0000', 'custGeom', '<a:blip'].map((m) => xml.indexOf(m));
    expect(order.every((i) => i !== -1)).toBe(true);
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1]);
    }
  });
});

describe('editability', () => {
  it('keeps text as an editable text box', async () => {
    const xml = await slideXml();
    expect(xml).toContain('<p:txBody>');
    expect(xml).toContain('<a:t>Hello</a:t>');
  });

  it('keeps shapes as editable <p:sp>', async () => {
    const xml = await slideXml();
    expect(xml).toContain('prst="rect"');
  });

  it('keeps polygons vertex-editable via custGeom moveTo/lnTo', async () => {
    const xml = await slideXml();
    expect(xml).toContain('<a:custGeom>');
    expect(xml).toContain('<a:moveTo>');
    expect(xml).toContain('<a:lnTo>');
  });

  it('keeps images as replaceable <p:pic>', async () => {
    const xml = await slideXml();
    expect(xml).toContain('<a:blip');
    expect(xml).toContain('r:embed=');
  });
});
