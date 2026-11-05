import JSZip from 'jszip';
import { TEXT_OBJECT_PREFIX } from '../converter/text-layout';

/** Slide space is pt under the 1920×1080 mapping (1 pt = 12700 EMU). */
const EMU_PER_PT = 12700;

export interface PptxTextAuditEntry {
  slide: number;
  objectName: string;
  text: string;
  geometryPx: { x: number; y: number; width: number; height: number };
  body: {
    anchor: string;
    insetsPx: { left: number; top: number; right: number; bottom: number };
    autofit: 'shape' | 'normal' | 'none';
  };
  paragraphs: {
    lineSpacing: { unit: 'points' | 'percent'; value: number } | null;
    spaceBeforePt: number;
    spaceAfterPt: number;
  }[];
  runs: { text: string; fontFace: string | null; fontSizePt: number | null }[];
}

function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
}

function xmlText(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#([0-9]+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10))
    )
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function emuToPt(value: string | undefined): number {
  return value === undefined ? 0 : Number(value) / EMU_PER_PT;
}

function centipoints(value: string | undefined): number {
  return value === undefined ? 0 : Number(value) / 100;
}

function paragraphAudit(xml: string): PptxTextAuditEntry['paragraphs'][number] {
  const points = xml.match(/<a:lnSpc>\s*<a:spcPts\b([^>]*)\/>\s*<\/a:lnSpc>/);
  const percent = xml.match(/<a:lnSpc>\s*<a:spcPct\b([^>]*)\/>\s*<\/a:lnSpc>/);
  const before = xml.match(/<a:spcBef>\s*<a:spcPts\b([^>]*)\/>\s*<\/a:spcBef>/);
  const after = xml.match(/<a:spcAft>\s*<a:spcPts\b([^>]*)\/>\s*<\/a:spcAft>/);
  return {
    lineSpacing: points
      ? { unit: 'points', value: centipoints(attr(points[1], 'val')) }
      : percent
        ? { unit: 'percent', value: Number(attr(percent[1], 'val')) / 1000 }
        : null,
    spaceBeforePt: centipoints(before ? attr(before[1], 'val') : undefined),
    spaceAfterPt: centipoints(after ? attr(after[1], 'val') : undefined),
  };
}

function runAudit(xml: string): PptxTextAuditEntry['runs'][number] {
  const properties = xml.match(/<a:rPr\b([^>]*)>/)?.[1] ?? '';
  const face = xml.match(/<a:latin\b[^>]*typeface="([^"]*)"/)?.[1] ?? null;
  const text = xml.match(/<a:t>([\s\S]*?)<\/a:t>/)?.[1] ?? '';
  const size = attr(properties, 'sz');
  return {
    text: xmlText(text),
    fontFace: face,
    fontSizePt: size === undefined ? null : Number(size) / 100,
  };
}

/** Inspect the final, post-processed package rather than pre-generation options. */
export async function auditPptxText(
  buffer: ArrayBuffer | Uint8Array
): Promise<PptxTextAuditEntry[]> {
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  const result: PptxTextAuditEntry[] = [];

  for (const path of slidePaths) {
    const slide = Number(path.match(/slide(\d+)\.xml$/)?.[1]);
    const xml = await zip.file(path)!.async('string');
    for (const match of xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)) {
      const shape = match[0];
      const name = shape.match(/<p:cNvPr\b[^>]*name="([^"]*)"/)?.[1];
      if (!name?.startsWith(TEXT_OBJECT_PREFIX)) continue;
      const off = shape.match(/<a:off\b([^>]*)\/?>/);
      const ext = shape.match(/<a:ext\b([^>]*)\/?>/);
      const bodyTag = shape.match(/<a:bodyPr\b[^>]*>/)?.[0] ?? '<a:bodyPr>';
      const paragraphs = [...shape.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((item) =>
        paragraphAudit(item[0])
      );
      const runs = [...shape.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)].map((item) =>
        runAudit(item[0])
      );
      const allText = [...shape.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
        .map((item) => xmlText(item[1]))
        .join('');
      result.push({
        slide,
        objectName: xmlText(name),
        text: allText,
        geometryPx: {
          x: emuToPt(off ? attr(off[1], 'x') : undefined),
          y: emuToPt(off ? attr(off[1], 'y') : undefined),
          width: emuToPt(ext ? attr(ext[1], 'cx') : undefined),
          height: emuToPt(ext ? attr(ext[1], 'cy') : undefined),
        },
        body: {
          anchor: attr(bodyTag, 'anchor') ?? 't',
          insetsPx: {
            left: emuToPt(attr(bodyTag, 'lIns')),
            top: emuToPt(attr(bodyTag, 'tIns')),
            right: emuToPt(attr(bodyTag, 'rIns')),
            bottom: emuToPt(attr(bodyTag, 'bIns')),
          },
          autofit: shape.includes('<a:spAutoFit')
            ? 'shape'
            : shape.includes('<a:normAutofit')
              ? 'normal'
              : 'none',
        },
        paragraphs,
        runs,
      });
    }
  }

  return result;
}
