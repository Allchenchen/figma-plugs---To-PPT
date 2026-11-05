/**
 * Build before/after PPTX for Research-slide text targets from real export geometry.
 *
 * Data source: `fixtures/exports/Figma_Export.pptx` OOXML (2026-10-20).
 * leadingTrim is NOT read from that PPTX (DrawingML has no equivalent) — candidate
 * IR uses flush sourceRenderBounds and/or explicit CAP_HEIGHT only to exercise gates.
 */
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { createPptx } from '../src/converter/converter';
import { postProcessPptx } from '../src/converter/postprocess';
import { computeTextVerticalInkShift } from '../src/converter/text-vertical';
import type { ExportOptions, IRDocument, IRText } from '../src/ir/types';

const OUT_DIR = path.resolve('fixtures/exports');

/** A — single-line question. Source: Figma_Export.pptx slide2 F2P_TXT_29:247 */
function targetA(overrides: Partial<IRText> = {}): IRText {
  return {
    id: '29:247',
    type: 'text',
    rect: { x: 285, y: 420, width: 918, height: 72 },
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    characters: '弨慥螎，漉璡漉峪玵鎩坠孰鑡穹娫痱娻纄蛏宆寯囥娆嚫嘀嘋？',
    fontSize: 34,
    fontFamily: 'PingFang SC',
    fontWeight: 400,
    color: '#FFFFFF',
    letterSpacing: 0,
    lineHeight: 72,
    lineHeightUnit: 'PIXELS',
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    textAutoResize: 'NONE',
    paragraphs: [
      {
        start: 0,
        end: 28,
        lineHeight: { unit: 'PIXELS', value: 72 },
        mixedLineHeight: false,
        paragraphSpacing: 0,
        paragraphIndent: 0,
        textAlignHorizontal: 'LEFT',
      },
    ],
    ...overrides,
  };
}

/** B — two-line description. Source: Figma_Export.pptx slide2 F2P_TXT_29:269 */
function targetB(overrides: Partial<IRText> = {}): IRText {
  return {
    id: '29:269',
    type: 'text',
    rect: { x: 972, y: 159, width: 738, height: 72 },
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    characters:
      '嘺嚆洶黆漀缟掞纄釆釒，樑囬揹箰囻寊婍囻屘日韛遌嚆痱暦鐃耔，颀鏷囖囬娆嚫弨慥螎日坜纄\n缟掞蛏宆，囥寊揹奬寸涇嬖纄嘓嘚甞揟。',
    fontSize: 18,
    fontFamily: 'SF Pro',
    fontWeight: 400,
    color: '#FFFFFF',
    letterSpacing: 0,
    lineHeight: 36,
    lineHeightUnit: 'PIXELS',
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    textAutoResize: 'NONE',
    paragraphs: [
      {
        start: 0,
        end: 42,
        lineHeight: { unit: 'PIXELS', value: 36 },
        mixedLineHeight: false,
        paragraphSpacing: 0,
        paragraphIndent: 0,
        textAlignHorizontal: 'LEFT',
      },
      {
        start: 43,
        end: 62,
        lineHeight: { unit: 'PIXELS', value: 36 },
        mixedLineHeight: false,
        paragraphSpacing: 0,
        paragraphIndent: 0,
        textAlignHorizontal: 'LEFT',
      },
    ],
    ...overrides,
  };
}

function flushBounds(layer: IRText): IRText {
  return {
    ...layer,
    sourceRenderBounds: {
      x: layer.rect.x,
      y: layer.rect.y,
      width: layer.rect.width,
      height: Math.min(layer.rect.height, layer.fontSize * 1.1),
    },
  };
}

function withCapHeight(layer: IRText): IRText {
  return {
    ...layer,
    paragraphs: layer.paragraphs?.map((p) => ({ ...p, leadingTrim: 'CAP_HEIGHT' as const })),
  };
}

async function buildDoc(
  layers: IRText[],
  options: ExportOptions
): Promise<{ buf: Uint8Array; shifts: unknown[] }> {
  const doc: IRDocument = {
    slides: [
      {
        id: 's1',
        name: 'Research-diag',
        width: 1920,
        height: 1080,
        backgroundColor: '#000000',
        elements: layers,
      },
    ],
    report: { entries: [] },
  };
  const pptx = createPptx(doc, options);
  const raw = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
  const buf = await postProcessPptx(raw, doc, options);
  const shifts = layers.map((layer) => ({
    id: layer.id,
    shift: computeTextVerticalInkShift(layer, options.textInkShift ?? 'auto'),
  }));
  return { buf, shifts };
}

async function shapeBodyPr(buf: Uint8Array, id: string): Promise<string | null> {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
  const marker = `F2P_TXT_${id}`;
  const idx = xml.indexOf(marker);
  if (idx < 0) return null;
  const start = xml.lastIndexOf('<p:sp>', idx);
  const end = xml.indexOf('</p:sp>', idx) + 7;
  const shape = xml.slice(start, end);
  return shape.match(/<a:bodyPr[^>]*>/)?.[0] ?? null;
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Candidate IR: geometry/fonts from real PPTX; flush bounds = measurement gate
  // (NOT proof the live Figma node has CAP_HEIGHT).
  const layersFlush = [flushBounds(targetA()), flushBounds(targetB())];
  const layersCap = [withCapHeight(targetA()), withCapHeight(targetB())];

  const before = await buildDoc(layersFlush, {
    sizePreset: 'frame',
    strategy: 'editable',
    textInkShift: 'off',
  });
  const afterFlush = await buildDoc(layersFlush, {
    sizePreset: 'frame',
    strategy: 'editable',
    textInkShift: 'auto',
  });
  const afterCap = await buildDoc(layersCap, {
    sizePreset: 'frame',
    strategy: 'editable',
    textInkShift: 'auto',
  });

  const beforePath = path.join(OUT_DIR, 'vertical-ink-shift-before.pptx');
  const afterPath = path.join(OUT_DIR, 'vertical-ink-shift-after.pptx');
  fs.writeFileSync(beforePath, before.buf);
  fs.writeFileSync(afterPath, afterFlush.buf);

  const report = {
    generatedAt: new Date().toISOString(),
    units: {
      note: 'Frame 1920×1080 → scale=1: 1 Figma px = 1 PPT pt = 12700 EMU',
      page: '1920×1080 pt',
      fontSz: 'OOXML sz = pt × 100 (hundredths of a point)',
      spcPts: 'OOXML Exact = pt × 100',
    },
    source: {
      kind: 'real PPTX OOXML geometry/fonts/text',
      file: 'fixtures/exports/Figma_Export.pptx',
      leadingTrim: 'NOT present in PPTX — unknown until IR diagnostic from Figma',
    },
    targets: {
      A: {
        nodeId: '29:247',
        slide: 2,
        objectName: 'F2P_TXT_29:247',
        text: '弨慥螎，漉璡漉峪玵鎩坠孰鑡穹娫痱娻纄蛏宆寯囥娆嚫嘀嘋？',
        boxPxPt: { w: 918, h: 72, x: 285, y: 420 },
        font: 'PingFang SC',
        szHalfPt: 3400,
        spcPts: 7200,
        rows: 1,
        bodyPrBaseline: 'anchor=t insets=0 noAutofit',
      },
      B: {
        nodeId: '29:269',
        slide: 2,
        objectName: 'F2P_TXT_29:269',
        text: '为了收集…真实经历…',
        boxPxPt: { w: 738, h: 72, x: 972, y: 159 },
        font: 'SF Pro',
        szHalfPt: 1800,
        spcPts: 3600,
        rows: 2,
        bodyPrBaseline: 'anchor=t insets=0 noAutofit wrap=none br=1',
        emu: { cx: 9372600, cy: 914400 },
      },
    },
    screenshotMeasurement: {
      file: 'assets/image-57b38db6 (Research PPT screenshot ~1024×575)',
      A_topGapPtApprox: 37.6,
      B_topGapPtApprox: 20.7,
      model: 'Exact+TOP natural top gap ≈ lineHeight − fontSize for gated cases',
      capHeightStatus: 'hypothesis — not proven from PPTX alone',
    },
    before: {
      path: beforePath,
      mode: 'off',
      bodyPr: {
        A: await shapeBodyPr(before.buf, '29:247'),
        B: await shapeBodyPr(before.buf, '29:269'),
      },
      shifts: before.shifts,
    },
    afterFlushGate: {
      path: afterPath,
      mode: 'auto + flush sourceRenderBounds',
      bodyPr: {
        A: await shapeBodyPr(afterFlush.buf, '29:247'),
        B: await shapeBodyPr(afterFlush.buf, '29:269'),
      },
      shifts: afterFlush.shifts,
    },
    afterCapHeightGate: {
      note: 'Separate candidate using fixture leadingTrim=CAP_HEIGHT (not from live node)',
      bodyPr: {
        A: await shapeBodyPr(afterCap.buf, '29:247'),
        B: await shapeBodyPr(afterCap.buf, '29:269'),
      },
      shifts: afterCap.shifts,
    },
    visualVerification: {
      status: 'PENDING',
      requiredClient: 'Microsoft PowerPoint for Mac (record version when checking)',
      note: 'XML/structure pass ≠ pixel match. Open before/after PPTX and compare ink vs box top.',
    },
  };

  const reportPath = path.join(OUT_DIR, 'vertical-ink-shift-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log('wrote', beforePath);
  console.log('wrote', afterPath);
  console.log('wrote', reportPath);
  console.log(JSON.stringify(report.afterFlushGate.shifts, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
