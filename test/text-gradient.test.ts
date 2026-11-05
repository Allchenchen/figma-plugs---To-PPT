import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createPptx } from '../src/converter/converter';
import { postProcessPptx } from '../src/converter/postprocess';
import { diamondGradientOnTextBox, linearGradientOnTextBox, radialGradientOnTextBox } from '../src/reader/text-gradient';
import type { IRDocument, IRText } from '../src/ir/types';

const identity = [
  [1, 0, 0],
  [0, 1, 0],
] as const;

describe('linear gradient mapped onto the text box', () => {
  const stops = [
    { position: 0, color: { r: 0.2, g: 0.3, b: 0.9, a: 1 } },
    { position: 1, color: { r: 0.6, g: 0.4, b: 1, a: 0.5 } },
  ];

  it('keeps stop percentages when the handles sit on the two ends', () => {
    const gradient = linearGradientOnTextBox(identity, 320, 48, stops);
    expect(gradient).toEqual({
      kind: 'gradient',
      style: 'linear',
      angle: 0,
      stops: [
        { position: 0, color: '#334DE6', opacity: 1 },
        { position: 1, color: '#9966FF', opacity: 0.5 },
      ],
    });
  });

  it('uses the clockwise PowerPoint angles for the four cardinal directions', () => {
    const one = [{ position: 0, color: { r: 0, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }];
    // These are the matrices Figma stores (layer space → gradient space).
    expect(linearGradientOnTextBox([[0, 1, 0], [-1, 0, 1]], 100, 40, one)).toMatchObject({ kind: 'gradient', angle: 90 });
    expect(linearGradientOnTextBox([[-1, 0, 1], [0, 1, 0]], 100, 40, one)).toMatchObject({ kind: 'gradient', angle: 180 });
    expect(linearGradientOnTextBox([[0, -1, 1], [1, 0, 0]], 100, 40, one)).toMatchObject({ kind: 'gradient', angle: 270 });
  });

  it('remaps stops onto the in-box segment when the handles stick out', () => {
    // Stored transform whose inverse puts the handles one box-width outside each end.
    const gradient = linearGradientOnTextBox(
      [
        [1 / 3, 0, 1 / 3],
        [0, 1, 0],
      ],
      200,
      40,
      [
        { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
        { position: 0.5, color: { r: 0, g: 1, b: 0, a: 1 } },
        { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
      ]
    );
    expect(gradient).toMatchObject({ kind: 'gradient', angle: 0 });
    expect(gradient?.kind === 'gradient' ? gradient.stops : []).toEqual([
      { position: 0, color: '#55AA00', opacity: 1 },
      { position: 0.5, color: '#00FF00', opacity: 1 },
      { position: 1, color: '#00AA55', opacity: 1 },
    ]);
  });

  it('keeps the gradient when the handles sit outside the box but the letters still change color', () => {
    const gradient = linearGradientOnTextBox(
      [
        [1, 0, 0],
        [0, 1, 1],
      ],
      200,
      40,
      [
        { position: 0, color: { r: 124 / 255, g: 161 / 255, b: 1, a: 1 } },
        { position: 1, color: { r: 0.45, g: 0.28, b: 0.95, a: 1 } },
      ]
    );
    expect(gradient).toEqual({
      kind: 'gradient',
      style: 'linear',
      angle: 0,
      stops: [
        { position: 0, color: '#7CA1FF', opacity: 1 },
        { position: 1, color: '#7347F2', opacity: 1 },
      ],
    });
  });

  it('writes a solid when the whole text box lands on one stop', () => {
    const gradient = linearGradientOnTextBox(
      [
        [1, 0, -2],
        [0, 1, 0],
      ],
      200,
      40,
      [
        { position: 0, color: { r: 124 / 255, g: 161 / 255, b: 1, a: 1 } },
        { position: 1, color: { r: 0.45, g: 0.28, b: 0.95, a: 1 } },
      ]
    );
    expect(gradient).toEqual({ kind: 'solid', color: '#7CA1FF', opacity: 1 });
  });

  it('maps the WEIKNOW radial fill from its center handle', () => {
    const gradient = radialGradientOnTextBox(
      [
        [0.44251707196235657, 0.1130666509270668, 0.4985688328742981],
        [-0.34493979811668396, 0.33290615677833557, 0.4698219895362854],
      ],
      1002,
      148,
      [
        { position: 0, color: { r: 0.48781174421310425, g: 0.6329317688941956, b: 1, a: 1 } },
        { position: 0.9770867228507996, color: { r: 0.5179161429405212, g: 0.27687424421310425, b: 1, a: 1 } },
      ]
    );
    expect(gradient).toEqual({
      kind: 'gradient',
      style: 'radial',
      angle: 0,
      center: { x: -0.0158, y: 0.0743 },
      stops: [
        { position: 0, color: '#7CA1FF', opacity: 1 },
        { position: 0.4617, color: '#7F81FF', opacity: 1 },
        { position: 0.5008, color: '#8078FF', opacity: 1 },
        { position: 0.5722, color: '#816EFF', opacity: 1 },
        { position: 0.663, color: '#8262FF', opacity: 1 },
        { position: 0.7668, color: '#8356FF', opacity: 1 },
        { position: 0.8799, color: '#844AFF', opacity: 1 },
        { position: 1, color: '#8447FF', opacity: 1 },
      ],
    });
    const onTheLetters = gradient && gradient.kind === 'gradient' ? gradient.stops.filter((stop) => stop.position >= 0.45) : [];
    expect(onTheLetters.every((stop) => stop.color !== '#7CA1FF')).toBe(true);
  });

  it('writes a diamond text fill from the center of the box', () => {
    const gradient = diamondGradientOnTextBox(
      [
        [1, 0, 0],
        [0, 1, 0],
      ],
      200,
      100,
      [
        { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
      ]
    );
    expect(gradient).toMatchObject({
      kind: 'gradient',
      style: 'diamond',
      center: { x: 0.5, y: 0.5 },
    });
    expect(gradient && gradient.kind === 'gradient' ? gradient.stops[0] : null).toEqual({
      position: 0,
      color: '#FF0000',
      opacity: 1,
    });
    expect(gradient && gradient.kind === 'gradient' ? gradient.stops[gradient.stops.length - 1] : null).toEqual({
      position: 1,
      color: '#0000FF',
      opacity: 1,
    });
  });
});

describe('editable text keeps a linear fill', () => {
  async function slideXml(layer: IRText): Promise<string> {
    const doc: IRDocument = {
      slides: [
        {
          id: 's',
          name: 's',
          width: 1920,
          height: 1080,
          backgroundColor: '#FFFFFF',
          elements: [layer],
        },
      ],
      report: { entries: [] },
    };
    const options = { sizePreset: 'frame' as const, strategy: 'editable' as const };
    const pptx = createPptx(doc, options);
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
    const processed = await postProcessPptx(buffer, doc, options);
    const zip = await JSZip.loadAsync(processed);
    return zip.file('ppt/slides/slide1.xml')!.async('string');
  }

  const box: IRText = {
    id: 'wordmark',
    type: 'text',
    rect: { x: 400, y: 480, width: 640, height: 80 },
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    characters: 'WEIKNOW DESIGN',
    fontSize: 48,
    fontFamily: 'Arial',
    fontWeight: 700,
    color: '#3366E6',
    letterSpacing: 0,
    lineHeight: null,
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'CENTER',
    runs: [
      {
        text: 'WEIKNOW DESIGN',
        start: 0,
        end: 15,
        fontSize: 48,
        fontFamily: 'Arial',
        fontWeight: 700,
        color: '#3366E6',
        letterSpacing: 0,
        opacity: 1,
        fillGradient: {
          angle: 0,
          stops: [
            { position: 0, color: '#3366E6', opacity: 1 },
            { position: 1, color: '#9966FF', opacity: 0.5 },
          ],
        },
      },
    ],
  };

  it('writes the gradient on the text fill and leaves the characters editable', async () => {
    const xml = await slideXml(box);
    expect(xml).toContain('<a:t>WEIKNOW DESIGN</a:t>');
    expect(xml).toContain('txBox="1"');
    expect(xml).toContain(
      '<a:gradFill flip="none" rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="3366E6"></a:srgbClr></a:gs><a:gs pos="100000"><a:srgbClr val="9966FF"><a:alpha val="50000"/></a:srgbClr></a:gs></a:gsLst><a:lin ang="0" scaled="1"/></a:gradFill>'
    );
    expect(xml).not.toMatch(/<a:t>WEIKNOW DESIGN<\/a:t>[\s\S]{0,80}<a:solidFill/);
  });

  it('writes a radial text fill from the center handle', async () => {
    const xml = await slideXml({
      ...box,
      id: 'radial',
      runs: [
        {
          ...box.runs![0]!,
          color: '#7CA1FF',
          fillGradient: {
            style: 'radial',
            angle: 0,
            center: { x: -0.0158, y: 0.0743 },
            stops: [
              { position: 0, color: '#7CA1FF', opacity: 1 },
              { position: 1, color: '#8447FF', opacity: 1 },
            ],
          },
        },
      ],
    });
    expect(xml).toContain('<a:t>WEIKNOW DESIGN</a:t>');
    expect(xml).toContain(
      '<a:path path="circle"><a:fillToRect l="-1580" t="7430" r="101580" b="92570"/></a:path>'
    );
    expect(xml).toContain('val="7CA1FF"');
    expect(xml).toContain('val="8447FF"');
    expect(xml).not.toContain('<a:lin ');
  });

  it('writes a diamond text fill as a rectangular path', async () => {
    const xml = await slideXml({
      ...box,
      id: 'diamond',
      runs: [
        {
          ...box.runs![0]!,
          color: '#FF0000',
          fillGradient: {
            style: 'diamond',
            angle: 0,
            center: { x: 0.5, y: 0.5 },
            stops: [
              { position: 0, color: '#FF0000', opacity: 1 },
              { position: 1, color: '#0000FF', opacity: 1 },
            ],
          },
        },
      ],
    });
    expect(xml).toContain('<a:t>WEIKNOW DESIGN</a:t>');
    expect(xml).toContain('<a:path path="rect"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>');
    expect(xml).toContain('val="FF0000"');
    expect(xml).toContain('val="0000FF"');
    expect(xml).not.toContain('<a:lin ');
  });

  it('leaves a solid text fill solid', async () => {
    const xml = await slideXml({
      ...box,
      id: 'solid',
      color: '#111111',
      runs: [{ ...box.runs![0]!, color: '#111111', fillGradient: undefined }],
    });
    expect(xml).toContain('<a:t>WEIKNOW DESIGN</a:t>');
    expect(xml).not.toContain('<a:gradFill');
    expect(xml).toContain('val="111111"');
  });
});
