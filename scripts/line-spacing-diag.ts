/**
 * DIAGNOSTIC ONLY — does not modify production conversion.
 *
 * Builds a minimal PPTX comparing line-spacing modes for the Insight body
 * text case (PingFang SC 20px→15pt, box 748×80, two lines).
 *
 * Run: npx tsx scripts/line-spacing-diag.ts
 * Output: fixtures/exports/line-spacing-diag.pptx
 */
import fs from 'node:fs';
import path from 'node:path';
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';

const FONT = 'PingFang SC';
const FONT_SIZE_PT = 15; // 20px * 72/96
const BOX_W_IN = 748 / 96;
const BOX_H_IN = 80 / 96;
const LINE1 = '慥螎谥頠纄愚奃、嬅掹嘔澁奷嘓嘚暦纄箯悃琛廴，';
const LINE2 = '港尸朕睜弨堙頉嚺纄漀瀸柃廠蔠';

type Case = {
  id: string;
  label: string;
  /** How to express spacing in pptxgenjs / post-written OOXML */
  mode: 'exact-pt' | 'multiple' | 'omit';
  value?: number;
  /** one paragraph with break vs two paragraphs */
  structure: 'two-paragraphs' | 'one-paragraph-break';
};

const CASES: Case[] = [
  { id: 'A', label: 'Exact 30pt / two paragraphs (current export path)', mode: 'exact-pt', value: 30, structure: 'two-paragraphs' },
  { id: 'B', label: 'Exact 39pt / two paragraphs (manual lookalike)', mode: 'exact-pt', value: 39, structure: 'two-paragraphs' },
  { id: 'C', label: 'Multiple 1.4 / two paragraphs (manual lookalike)', mode: 'multiple', value: 1.4, structure: 'two-paragraphs' },
  { id: 'D', label: 'Multiple 2.0 / two paragraphs (40px/20px ratio)', mode: 'multiple', value: 2.0, structure: 'two-paragraphs' },
  { id: 'E', label: 'Exact 30pt / one para with soft break', mode: 'exact-pt', value: 30, structure: 'one-paragraph-break' },
  { id: 'F', label: 'Exact 30pt / single line only', mode: 'exact-pt', value: 30, structure: 'two-paragraphs' },
];

function pxToEmu(px: number): number {
  return Math.round((px / 96) * 914400);
}

async function main(): Promise<void> {
  const pptx = new PptxGenJS();
  // Slide sized to Figma frame units in inches (1920×1080 @96dpi)
  pptx.defineLayout({ name: 'DIAG', width: 1920 / 96, height: 1080 / 96 });
  pptx.layout = 'DIAG';

  const meta: Record<string, unknown>[] = [];

  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i];
    const slide = pptx.addSlide();
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 1920 / 96,
      h: 1080 / 96,
      fill: { color: '000000' },
      line: { color: '000000' },
    });
    slide.addText(`${c.id}. ${c.label}`, {
      x: 0.3,
      y: 0.2,
      w: 18,
      h: 0.4,
      fontSize: 14,
      fontFace: 'Arial',
      color: 'FFFFFF',
      margin: 0,
    });

    const y = 1.2;
    const common = {
      x: 1,
      y,
      w: BOX_W_IN,
      h: BOX_H_IN,
      fontSize: FONT_SIZE_PT,
      fontFace: FONT,
      color: 'FFFFFF',
      transparency: 20,
      align: 'left' as const,
      valign: 'top' as const,
      margin: [0, 0, 0, 0] as [number, number, number, number],
      fit: 'none' as const,
      wrap: true,
      isTextBox: true,
      objectName: `DIAG_${c.id}`,
    };

    if (c.id === 'F') {
      slide.addText(LINE1, {
        ...common,
        ...(c.mode === 'exact-pt' ? { lineSpacing: c.value } : {}),
        ...(c.mode === 'multiple' ? { lineSpacingMultiple: c.value } : {}),
      });
    } else if (c.structure === 'two-paragraphs') {
      const opts =
        c.mode === 'exact-pt'
          ? { lineSpacing: c.value }
          : c.mode === 'multiple'
            ? { lineSpacingMultiple: c.value }
            : {};
      slide.addText(
        [
          { text: LINE1, options: { breakLine: true, ...opts } },
          { text: LINE2, options: { ...opts } },
        ],
        common
      );
    } else {
      // Still two logical paragraphs in pptxgenjs when using \n; documented as such.
      const opts =
        c.mode === 'exact-pt'
          ? { lineSpacing: c.value }
          : c.mode === 'multiple'
            ? { lineSpacingMultiple: c.value }
            : {};
      slide.addText(`${LINE1}\n${LINE2}`, { ...common, ...opts });
    }

    meta.push({
      id: c.id,
      label: c.label,
      boxPx: { w: 748, h: 80 },
      boxIn: { w: BOX_W_IN, h: BOX_H_IN },
      fontSizePt: FONT_SIZE_PT,
      mode: c.mode,
      value: c.value ?? null,
      structure: c.structure,
      editableNative: true,
      needsHumanVisualCheck: true,
    });
  }

  const outDir = path.join(process.cwd(), 'fixtures', 'exports');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'line-spacing-diag.pptx');
  await pptx.writeFile({ fileName: outFile });

  // Audit OOXML for each DIAG_ shape
  const buf = fs.readFileSync(outFile);
  const zip = await JSZip.loadAsync(buf);
  const audit: Record<string, unknown>[] = [];
  for (let s = 1; s <= CASES.length; s++) {
    const xml = await zip.file(`ppt/slides/slide${s}.xml`)!.async('string');
    const nameMatch = xml.match(/name="(DIAG_[A-F])"/);
    const body = xml.match(/<a:bodyPr([^>]*)/);
    const ln = [...xml.matchAll(/<a:lnSpc>([\s\S]*?)<\/a:lnSpc>/g)].map((m) => m[1]);
    const paras = (xml.match(/<a:p>/g) || []).length;
    const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    const sz = xml.match(/sz="(\d+)"/);
    const autofit = {
      spAutoFit: xml.includes('<a:spAutoFit'),
      normAutofit: xml.includes('<a:normAutofit'),
      noAutofit: xml.includes('<a:noAutofit'),
    };
    audit.push({
      slide: s,
      objectName: nameMatch?.[1] ?? null,
      bodyPr: body?.[1]?.trim() ?? null,
      paragraphCount: paras,
      charCount: texts.join('').length,
      texts,
      fontSizeHalfPt: sz?.[1] ?? null,
      lnSpc: ln,
      autofit,
      xfrmHintEmu: {
        // height of text box should be 80px
        expectedCy: pxToEmu(80),
      },
    });
  }

  const reportPath = path.join(outDir, 'line-spacing-diag-report.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), meta, audit }, null, 2)
  );
  console.log('Wrote', outFile);
  console.log('Wrote', reportPath);
  console.log(JSON.stringify(audit, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
