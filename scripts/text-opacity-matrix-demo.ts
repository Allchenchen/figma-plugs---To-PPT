/**
 * Demo slide: simple-path text opacity → original RGB + DrawingML alpha.
 * Not a production fixture — regenerate with: npx tsx scripts/text-opacity-matrix-demo.ts
 */
import { writeFileSync } from 'fs';
import JSZip from 'jszip';
import { createPptx } from '../src/converter/converter';
import { postProcessPptx } from '../src/converter/postprocess';
import type { IRDocument, IRText } from '../src/ir/types';

function t(id: string, y: number, op: number, label: string): IRText {
  return {
    id,
    type: 'text',
    rect: { x: 40, y, width: 700, height: 40 },
    rotation: 0,
    opacity: op,
    zIndex: 0,
    characters: label,
    fontSize: 20,
    fontFamily: 'Arial',
    fontWeight: 400,
    color: '#FFFFFF',
    letterSpacing: 0,
    lineHeight: null,
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
  };
}

const doc: IRDocument = {
  slides: [
    {
      id: 's1',
      name: 'opacity-matrix',
      width: 800,
      height: 450,
      backgroundColor: '#000000',
      elements: [
        t('0', 40, 1, 'effective=1.00 → opaque white'),
        t('1', 100, 0.8, 'effective=0.80 (e.g. paint1×node0.8) → transparency 20%'),
        t('2', 160, 0.64, 'effective=0.64 (paint0.8×node0.8) → transparency 36%'),
        t('3', 220, 0, 'effective=0 → fully transparent (must not become opaque)'),
      ],
    },
  ],
  report: { entries: [] },
};

async function main(): Promise<void> {
  const opts = { sizePreset: 'frame' as const, strategy: 'editable' as const };
  const pptx = createPptx(doc, opts);
  const buf = (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array;
  const out = await postProcessPptx(buf, doc, opts);
  const path = 'fixtures/exports/text-opacity-matrix-demo.pptx';
  writeFileSync(path, out);

  const zip = await JSZip.loadAsync(out);
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
  const alphas = [...xml.matchAll(/srgbClr val="FFFFFF"(?:><a:alpha val="(\d+)"\/>)?/g)].map(
    (m) => m[1] ?? 'opaque'
  );
  console.log('alphas:', alphas);
  console.log('wrote', path);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
