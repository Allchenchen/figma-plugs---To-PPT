import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { createPptx } from '../src/converter/converter';
import { postProcessPptx } from '../src/converter/postprocess';
import type { IRDocument, IRShape } from '../src/ir/types';

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

function sampleDoc(): IRDocument {
  return {
    slides: [
      {
        id: 's1',
        name: 'Slide-1',
        width: 1920,
        height: 1080,
        backgroundColor: '#000000',
        elements: [
          {
            id: 't1',
            type: 'text',
            rect: { x: 100, y: 100, width: 400, height: 80 },
            rotation: 0,
            opacity: 1,
            zIndex: 0,
            characters: '作为视觉隐喻。',
            fontSize: 32,
            fontFamily: 'Inter',
            fontWeight: 700,
            color: '#FFFFFF',
            letterSpacing: 0,
            lineHeight: 48,
            textAlignHorizontal: 'LEFT',
            textAlignVertical: 'TOP',
          },
          {
            id: 'r1',
            type: 'shape',
            rect: { x: 100, y: 200, width: 200, height: 100 },
            rotation: 0,
            opacity: 1,
            zIndex: 1,
            shapeKind: 'rect',
            fill: '#3D7A3D',
            stroke: null,
            cornerRadii: { tl: 20, tr: 20, br: 20, bl: 20 },
          },
          {
            id: 'e1',
            type: 'shape',
            rect: { x: 400, y: 200, width: 100, height: 100 },
            rotation: 0,
            opacity: 1,
            zIndex: 2,
            shapeKind: 'ellipse',
            fill: '#FF0000',
            stroke: null,
            cornerRadii: null,
          },
          {
            id: 'i1',
            type: 'image',
            rect: { x: 600, y: 200, width: 100, height: 100 },
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

describe('converter integration', () => {
  it('produces a valid pptx with native text/shape/image', async () => {
    const pptx = createPptx(sampleDoc(), { sizePreset: 'frame', strategy: 'editable' });
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
    expect(buffer.length).toBeGreaterThan(1000);

    const zip = await JSZip.loadAsync(buffer);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');

    expect(slideXml).toContain('作为视觉隐喻。');
    expect(slideXml).toContain('prst="roundRect"');
    expect(slideXml).toContain('prst="ellipse"');
    expect(slideXml).toContain('<a:blip');
    // background restored
    expect(slideXml).toContain('000000');
  });

  it('emits custGeom for mixed corner radii', async () => {
    const doc = sampleDoc();
    const rect = doc.slides[0].elements[1] as IRShape;
    doc.slides[0].elements[1] = {
      ...rect,
      cornerRadii: { tl: 4, tr: 30, br: 12, bl: 16 },
    };
    const pptx = createPptx(doc, { sizePreset: 'frame', strategy: 'editable' });
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
    const zip = await JSZip.loadAsync(buffer);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(slideXml).toContain('<a:custGeom>');
    expect(slideXml).toContain('<a:quadBezTo>');
  });

  it('always emits 1920×1080 pt page (even for sizePreset 16x9)', async () => {
    const pptx = createPptx(sampleDoc(), { sizePreset: '16x9', strategy: 'editable' });
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('ppt/presentation.xml')!.async('string');
    // 1920pt × 12700 = 24384000; 1080pt × 12700 = 13716000
    expect(xml).toContain('cx="24384000"');
    expect(xml).toContain('cy="13716000"');
  });

  it('injects <a:srcRect> for a crop image fill', async () => {
    const doc = sampleDoc();
    doc.slides[0].elements.push({
      id: 'crop1',
      type: 'image',
      rect: { x: 10, y: 10, width: 100, height: 100 },
      rotation: 0,
      opacity: 1,
      zIndex: 9,
      data: PNG_1PX,
      mimeType: 'image/png',
      sizing: { mode: 'crop', srcRect: { l: 1000, r: 2000, t: 3000, b: 4000 } },
    });

    const pptx = createPptx(doc, { sizePreset: 'frame', strategy: 'editable' });
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
    const out = await postProcessPptx(buffer, doc, { sizePreset: 'frame', strategy: 'editable' });

    const zip = await JSZip.loadAsync(out);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(slideXml).toContain('name="F2P_IMG_crop1"');
    expect(slideXml).toContain('<a:srcRect l="1000" r="2000" t="3000" b="4000"/>');
  });

  it('postProcess twice does not duplicate pics or stack srcRect/geometry', async () => {
    const doc = sampleDoc();
    doc.slides[0].elements.push({
      id: 'idem1',
      type: 'image',
      rect: { x: 10, y: 10, width: 200, height: 100 },
      rotation: 0,
      opacity: 1,
      zIndex: 9,
      data: PNG_1PX,
      mimeType: 'image/png',
      sizing: { mode: 'cover', srcRect: { l: 100, r: 100, t: 0, b: 0 } },
      cornerRadii: { tl: 8, tr: 8, br: 8, bl: 8 },
      cornerSmoothing: 0,
      cornerSource: 'node',
    });

    const pptx = createPptx(doc, { sizePreset: 'frame', strategy: 'editable' });
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
    const once = await postProcessPptx(buffer, doc, { sizePreset: 'frame', strategy: 'editable' });
    const twice = await postProcessPptx(once, doc, { sizePreset: 'frame', strategy: 'editable' });

    const zip = await JSZip.loadAsync(twice);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    // sampleDoc already has image i1; idem1 must remain a single pic after 2× postProcess.
    expect(slideXml.match(/name="F2P_IMG_idem1"/g)).toHaveLength(1);
    const idemPic = slideXml.match(/<p:pic>[\s\S]*?name="F2P_IMG_idem1"[\s\S]*?<\/p:pic>/)?.[0];
    expect(idemPic).toBeTruthy();
    expect(idemPic!.match(/<a:srcRect\b/g)).toHaveLength(1);
    expect(idemPic).toContain('<a:srcRect l="100" r="100" t="0" b="0"/>');
    expect(idemPic!.match(/prst="roundRect"/g)).toHaveLength(1);
    // Offsets must not accumulate across postProcess runs.
    expect(idemPic).toMatch(/<a:off x="[^"]+" y="[^"]+"/);
    const onceZip = await JSZip.loadAsync(once);
    const onceXml = await onceZip.file('ppt/slides/slide1.xml')!.async('string');
    const oncePic = onceXml.match(/<p:pic>[\s\S]*?name="F2P_IMG_idem1"[\s\S]*?<\/p:pic>/)?.[0];
    const offOnce = oncePic!.match(/<a:off x="([^"]+)" y="([^"]+)"/)!;
    const offTwice = idemPic!.match(/<a:off x="([^"]+)" y="([^"]+)"/)!;
    expect(offTwice[1]).toBe(offOnce[1]);
    expect(offTwice[2]).toBe(offOnce[2]);
  });

  it('injects prstGeom roundRect on a native image with uniform corners', async () => {
    const doc = sampleDoc();
    doc.slides[0].elements.push({
      id: 'round1',
      type: 'image',
      rect: { x: 10, y: 10, width: 200, height: 100 },
      rotation: 0,
      opacity: 1,
      zIndex: 9,
      data: PNG_1PX,
      mimeType: 'image/png',
      sizing: { mode: 'cover', srcRect: { l: 0, r: 0, t: 0, b: 0 } },
      cornerRadii: { tl: 10, tr: 10, br: 10, bl: 10 },
      cornerSmoothing: 0,
      cornerSource: 'node',
    });

    const pptx = createPptx(doc, { sizePreset: 'frame', strategy: 'editable' });
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
    const out = await postProcessPptx(buffer, doc, { sizePreset: 'frame', strategy: 'editable' });

    const zip = await JSZip.loadAsync(out);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    // Still a native pic with the same blip marker and cover srcRect.
    expect(slideXml).toContain('name="F2P_IMG_round1"');
    expect(slideXml).toContain('<a:srcRect l="0" r="0" t="0" b="0"/>');
    // Uniform radius → prstGeom roundRect (adj = 10/100*100000 = 10000 at scale=1).
    expect(slideXml).toContain('prst="roundRect"');
    expect(slideXml).toContain('fmla="val 10000"');
    // Slice from this pic's marker through its closing tag (avoid prior pics).
    const start = slideXml.indexOf('name="F2P_IMG_round1"');
    expect(start).toBeGreaterThan(-1);
    const end = slideXml.indexOf('</p:pic>', start);
    const pic = slideXml.slice(start, end);
    expect(pic).toContain('prst="roundRect"');
    expect(pic).toContain('fmla="val 10000"');
    expect(pic).not.toContain('prst="rect"');
    expect(pic).toContain('<a:blip');
  });

  it('injects custGeom for independent image corner radii without changing crop', async () => {
    const doc = sampleDoc();
    doc.slides[0].elements.push({
      id: 'round2',
      type: 'image',
      rect: { x: 10, y: 10, width: 100, height: 100 },
      rotation: 0,
      opacity: 1,
      zIndex: 9,
      data: PNG_1PX,
      mimeType: 'image/png',
      sizing: { mode: 'crop', srcRect: { l: 500, r: 500, t: 0, b: 0 } },
      cornerRadii: { tl: 4, tr: 12, br: 8, bl: 16 },
      cornerSource: 'node',
    });

    const pptx = createPptx(doc, { sizePreset: 'frame', strategy: 'editable' });
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
    const out = await postProcessPptx(buffer, doc, { sizePreset: 'frame', strategy: 'editable' });
    const zip = await JSZip.loadAsync(out);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const start = slideXml.indexOf('name="F2P_IMG_round2"');
    expect(start).toBeGreaterThan(-1);
    const pic = slideXml.slice(start, slideXml.indexOf('</p:pic>', start));
    expect(pic).toContain('<a:custGeom>');
    expect(pic).toContain('<a:srcRect l="500" r="500" t="0" b="0"/>');
    expect(pic).toContain('<a:blip');
  });

  it('is a no-op when no image needs a srcRect', async () => {
    const doc = sampleDoc();
    const pptx = createPptx(doc, { sizePreset: 'frame', strategy: 'editable' });
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
    const out = await postProcessPptx(buffer, doc, { sizePreset: 'frame', strategy: 'editable' });
    const zip = await JSZip.loadAsync(out);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(slideXml).not.toContain('F2P_IMG_');
    expect(slideXml).not.toContain('<a:srcRect');
  });

  it('injects <a:tile> for a TILE image fill', async () => {
    const doc = sampleDoc();
    doc.slides[0].elements.push({
      id: 'tile1',
      type: 'image',
      rect: { x: 10, y: 10, width: 100, height: 100 },
      rotation: 0,
      opacity: 1,
      zIndex: 9,
      data: PNG_1PX,
      mimeType: 'image/png',
      sizing: { mode: 'tile', scaleX: 50000, scaleY: 25000 },
    });

    const pptx = createPptx(doc, { sizePreset: 'frame', strategy: 'editable' });
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
    const out = await postProcessPptx(buffer, doc, { sizePreset: 'frame', strategy: 'editable' });

    const zip = await JSZip.loadAsync(out);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(slideXml).toContain('name="F2P_IMG_tile1"');
    expect(slideXml).toContain('<a:tile algn="tl" flip="none" sx="50000" sy="25000" tx="0" ty="0"/>');
  });

  it('renders an ellipse picture-shape natively', async () => {
    const doc = sampleDoc();
    doc.slides[0].elements.push({
      id: 'mask1',
      type: 'pictureShape',
      rect: { x: 0, y: 0, width: 96, height: 96 },
      rotation: 0,
      opacity: 1,
      zIndex: 9,
      shapeKind: 'ellipse',
      cornerRadii: null,
      data: PNG_1PX,
      mimeType: 'image/png',
      srcRect: null,
    });

    const pptx = createPptx(doc, { sizePreset: 'frame', strategy: 'editable' });
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
    const out = await postProcessPptx(buffer, doc, { sizePreset: 'frame', strategy: 'editable' });

    const zip = await JSZip.loadAsync(out);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(slideXml).toContain('name="F2P_PS_mask1"');
    expect(slideXml).toContain('prst="ellipse"');
  });

  it('swaps a star mask picture-shape to custGeom and injects srcRect', async () => {
    const doc = sampleDoc();
    doc.slides[0].elements.push({
      id: 'mask2',
      type: 'pictureShape',
      rect: { x: 0, y: 0, width: 96, height: 96 },
      rotation: 0,
      opacity: 1,
      zIndex: 9,
      shapeKind: 'star',
      cornerRadii: null,
      pointCount: 5,
      innerRadius: 0.5,
      data: PNG_1PX,
      mimeType: 'image/png',
      srcRect: { l: 1000, r: 2000, t: 3000, b: 4000 },
    });

    const pptx = createPptx(doc, { sizePreset: 'frame', strategy: 'editable' });
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
    const out = await postProcessPptx(buffer, doc, { sizePreset: 'frame', strategy: 'editable' });

    const zip = await JSZip.loadAsync(out);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(slideXml).toContain('name="F2P_PS_mask2"');
    expect(slideXml).toContain('<a:custGeom>');
    expect(slideXml).toContain('<a:srcRect l="1000" r="2000" t="3000" b="4000"/>');
  });

  it('emits custGeom with cubic beziers for an actual star path', async () => {
    const doc = sampleDoc();
    doc.slides[0].elements.push({
      id: 'star1',
      type: 'shape',
      rect: { x: 10, y: 10, width: 96, height: 96 },
      rotation: 0,
      opacity: 1,
      zIndex: 10,
      shapeKind: 'star',
      fill: '#FFD700',
      stroke: null,
      cornerRadii: null,
      pointCount: 5,
      innerRadius: 0.5,
      path: [{ windingRule: 'NONZERO', data: 'M 0 48 C 0 0 96 0 96 48 L 48 96 Z' }],
    });

    const pptx = createPptx(doc, { sizePreset: 'frame', strategy: 'editable' });
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
    const zip = await JSZip.loadAsync(buffer);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(slideXml).toContain('<a:custGeom>');
    expect(slideXml).toContain('<a:cubicBezTo>');
  });
});
