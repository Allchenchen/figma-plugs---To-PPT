import JSZip from 'jszip';
import type {
  ExportOptions,
  IRDocument,
  IRPictureShape,
  IRText,
  IRTextParagraph,
  IRTextRun,
  IRTextVisualLine,
  SrcRect,
} from '../ir/types';
import { resolveLayout } from './converter';
import { polygonVertices, starVertices } from './polygon';
import {
  srcRectXml,
  tileXml,
  custGeomFromPathXml,
  custGeomFromVerticesXml,
  roundRectCustGeomXml,
  imageCornerGeometryXml,
} from './ooxml';
import { TEXT_OBJECT_PREFIX } from './text-layout';
import {
  paragraphMetricsForInjection,
  resolveTextParagraphs,
  softBreakGroups,
} from './text-paragraphs';
import { drawingMlCap } from './text-case';
import { paragraphSpaceAfterPx, typographyCentipoints } from './text-layout';
import { lockVisualWraps } from './text-wrap';
import { injectTextGradientFills } from './text-gradient';

/**
 * OOXML post-processing for constructs PptxGenJS cannot express directly:
 *
 *  1. `<a:srcRect>` for FILL/CROP image fills — PptxGenJS's sizing.cover/contain/
 *     crop never measures the real image, so it cannot produce a correct crop.
 *  2. `<a:tile>` for Figma TILE image fills.
 *  3. `<a:custGeom>` geometry for non-rectangular mask "picture shapes".
 *  4. Paragraph lnSpc / spcBef / spcAft / soft-break merge / noAutofit / caps.
 *
 * Text metrics always come from Frame-space IR × page `scale` here (createPptx
 * does not mutate `doc`). Geometry/fonts are scaled only in createPptx emission.
 *
 * Objects are identified by stable `objectName` markers (see the *_PREFIX
 * constants) so the picture stays a fully native, replaceable PowerPoint image.
 */

/** Object name prefix set on pictures that need a srcRect or tile injected. */
export const IMAGE_OBJECT_PREFIX = 'F2P_IMG_';

/** Object name prefix set on picture shapes whose geometry is swapped here. */
export const PICTURE_SHAPE_PREFIX = 'F2P_PS_';

type Operation =
  | { marker: string; kind: 'srcRect'; srcRect: SrcRect }
  | { marker: string; kind: 'tile'; scaleX: number; scaleY: number }
  | { marker: string; kind: 'geometry'; xml: string }
  | {
      marker: string;
      kind: 'text';
      paragraphIndentPx?: number;
      cap?: 'all' | 'small';
      paragraphs?: IRTextParagraph[];
      runs?: IRTextRun[];
      visualLines?: IRTextVisualLine[];
      visualWrapLocked?: boolean;
    };

/** CustGeom markup for a picture shape's mask geometry (scaled to the layout). */
function pictureShapeGeometry(ps: IRPictureShape, scale: number): string | null {
  const w = ps.rect.width;
  const h = ps.rect.height;

  if (ps.shapeKind === 'roundRect') {
    const r = ps.cornerRadii;
    if (!r) return null;
    return roundRectCustGeomXml(w, h, r.tl, r.tr, r.br, r.bl, scale);
  }

  if (ps.shapeKind === 'star' || ps.shapeKind === 'polygon') {
    if (ps.path && ps.path.length === 1) {
      return custGeomFromPathXml(ps.path[0].data, w, h, scale);
    }
    const n = Math.max(3, Math.round(ps.pointCount ?? 5));
    const vertices =
      ps.shapeKind === 'star'
        ? starVertices(w, h, n, ps.innerRadius ?? 0.5)
        : polygonVertices(w, h, n);
    return custGeomFromVerticesXml(vertices, w, h, scale);
  }

  return null; // ellipse is rendered natively via `rounding`
}

function buildOperations(doc: IRDocument, options: ExportOptions): Map<number, Operation[]> {
  const ops = new Map<number, Operation[]>();
  doc.slides.forEach((slide, i) => {
    const list: Operation[] = [];
    const scale = resolveLayout(slide, options.sizePreset).scale;

    for (const el of slide.elements) {
      if (el.type === 'image') {
        const marker = `${IMAGE_OBJECT_PREFIX}${el.id}`;
        if (el.sizing) {
          if (el.sizing.mode === 'cover' || el.sizing.mode === 'crop') {
            list.push({
              marker,
              kind: 'srcRect',
              srcRect: el.sizing.srcRect,
            });
          } else if (el.sizing.mode === 'tile') {
            list.push({
              marker,
              kind: 'tile',
              scaleX: el.sizing.scaleX,
              scaleY: el.sizing.scaleY,
            });
          }
        }
        // Native pic keeps blipFill/srcRect/xfrm; only swap prstGeom → roundRect/custGeom.
        if (el.cornerRadii) {
          const r = el.cornerRadii;
          const boxW =
            el.sizing?.mode === 'contain' ? el.sizing.fitWidth : el.rect.width;
          const boxH =
            el.sizing?.mode === 'contain' ? el.sizing.fitHeight : el.rect.height;
          list.push({
            marker,
            kind: 'geometry',
            xml: imageCornerGeometryXml(
              boxW,
              boxH,
              r.tl,
              r.tr,
              r.br,
              r.bl,
              scale,
              el.cornerSmoothing ?? 0
            ),
          });
        }
      } else if (el.type === 'pictureShape') {
        if (el.srcRect) {
          list.push({ marker: `${PICTURE_SHAPE_PREFIX}${el.id}`, kind: 'srcRect', srcRect: el.srcRect });
        }
        if (el.shapeKind !== 'ellipse') {
          const geom = pictureShapeGeometry(el, scale);
          if (geom) list.push({ marker: `${PICTURE_SHAPE_PREFIX}${el.id}`, kind: 'geometry', xml: geom });
        }
      } else if (el.type === 'text') {
        const paragraphIndentPx =
          el.paragraphIndent !== null && el.paragraphIndent !== undefined && el.paragraphIndent !== 0
            ? el.paragraphIndent * scale
            : undefined;
        const cap = drawingMlCap(el.textCase);
        // Same visual-wrap bake as createPptx so soft-break groups match emitted breaks.
        const prepared = lockVisualWraps(el);
        const paragraphs = resolveTextParagraphs(prepared).map((paragraph) => ({
          ...paragraph,
          lineHeight:
            paragraph.lineHeight?.unit === 'PIXELS'
              ? { unit: 'PIXELS' as const, value: paragraph.lineHeight.value * scale }
              : paragraph.lineHeight?.unit === 'PERCENT'
                ? {
                    unit: 'PIXELS' as const,
                    value: ((el.fontSize * paragraph.lineHeight.value) / 100) * scale,
                  }
                : paragraph.lineHeight,
          paragraphSpacing:
            paragraph.paragraphSpacing === null ||
            paragraph.paragraphSpacing === undefined
              ? paragraph.paragraphSpacing ?? null
              : paragraph.paragraphSpacing * scale,
          paragraphIndent:
            paragraph.paragraphIndent === null ||
            paragraph.paragraphIndent === undefined
              ? paragraph.paragraphIndent ?? null
              : paragraph.paragraphIndent * scale,
          paragraphSpaceBefore:
            paragraph.paragraphSpaceBefore === null ||
            paragraph.paragraphSpaceBefore === undefined
              ? paragraph.paragraphSpaceBefore
              : paragraph.paragraphSpaceBefore * scale,
          listSpacing:
            paragraph.listSpacing === null || paragraph.listSpacing === undefined
              ? paragraph.listSpacing
              : paragraph.listSpacing * scale,
          indentation:
            paragraph.indentation === null || paragraph.indentation === undefined
              ? paragraph.indentation
              : paragraph.indentation * scale,
        }));
        // After wrap bake, visual lines are 1:1 with prepared paragraphs (same order).
        const visualLines =
          prepared.visualLineStatus === 'exact' &&
          prepared.visualLines &&
          prepared.visualLines.length === paragraphs.length
            ? prepared.visualLines.map((line) => ({
                ...line,
                x: line.x * scale,
                baselineY: line.baselineY * scale,
              }))
            : undefined;
        // Per-line markers only for mixed-line-height splits above. Auto-wrap
        // bake keeps one shape; soft-break merge uses prepared paragraphs.
        list.push({
          marker: `${TEXT_OBJECT_PREFIX}${el.id}`,
          kind: 'text',
          paragraphIndentPx,
          cap,
          paragraphs,
          runs: prepared.runs,
          visualLines,
          visualWrapLocked: prepared.visualWrapLocked === true,
        });
      }
    }

    if (list.length > 0) ops.set(i + 1, list);
  });
  return ops;
}

/** Find the marker's `name=` position; returns the remaining XML from there. */
function tailFrom(xml: string, marker: string): string | null {
  const idx = xml.indexOf(`name="${marker}"`);
  return idx === -1 ? null : xml.slice(idx);
}

function injectSrcRect(xml: string, marker: string, srcRectXmlStr: string): string {
  const nameIdx = xml.indexOf(`name="${marker}"`);
  if (nameIdx === -1) return xml;
  const tail = xml.slice(nameIdx);
  const stretchIdx = tail.indexOf('<a:stretch');
  if (stretchIdx === -1) return xml;
  // Idempotent: replace an existing srcRect in this blipFill instead of stacking.
  const beforeStretch = tail.slice(0, stretchIdx);
  const existing = beforeStretch.match(/<a:srcRect\b[^>]*\/>/);
  if (existing && existing.index !== undefined) {
    const abs = nameIdx + existing.index;
    return xml.slice(0, abs) + srcRectXmlStr + xml.slice(abs + existing[0].length);
  }
  return xml.slice(0, nameIdx + stretchIdx) + srcRectXmlStr + xml.slice(nameIdx + stretchIdx);
}

function injectTile(xml: string, marker: string, tileXmlStr: string): string {
  const tail = tailFrom(xml, marker);
  if (tail === null) return xml;
  const stretchIdx = tail.indexOf('<a:stretch><a:fillRect/></a:stretch>');
  if (stretchIdx === -1) return xml;
  const abs = xml.indexOf(`name="${marker}"`) + stretchIdx;
  const end = abs + '<a:stretch><a:fillRect/></a:stretch>'.length;
  return xml.slice(0, abs) + tileXmlStr + xml.slice(end);
}

function injectGeometry(xml: string, marker: string, geomXml: string): string {
  const tail = tailFrom(xml, marker);
  if (tail === null) return xml;
  const geomIdx = tail.indexOf('<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>');
  if (geomIdx === -1) return xml;
  const abs = xml.indexOf(`name="${marker}"`) + geomIdx;
  const end = abs + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'.length;
  return xml.slice(0, abs) + geomXml + xml.slice(end);
}

function setAttribute(tag: string, name: string, value: string): string {
  const without = tag.replace(new RegExp(`\\s${name}="[^"]*"`), '');
  return without.replace(/>$/, ` ${name}="${value}">`);
}

/**
 * PptxGenJS turns every `\n` into a separate `<a:p>`. Figma line height then
 * only affects intra-paragraph lines, so single-line paragraphs ignore Exact
 * spacing between visual rows. Collapse matching paragraphs into one `<a:p>`
 * with `<a:br/>` so `lnSpc` applies between those rows.
 */
/** Content-bearing `<a:p>` count (ignores empty pptxgenjs stubs). */
function contentParagraphCount(shape: string): number {
  return [...shape.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)]
    .map((m) => m[0])
    .filter((p) => /<a:t>/.test(p) && !/<a:t>(?:\s|&nbsp;)*<\/a:t>/.test(p)).length;
}

function mergeSoftBreakParagraphs(shape: string, paragraphs: IRTextParagraph[]): string {
  const groups = softBreakGroups(paragraphs);
  if (groups.every((group) => group.length === 1)) return shape;

  const txStart = shape.indexOf('<p:txBody>');
  const txEnd = shape.indexOf('</p:txBody>');
  if (txStart === -1 || txEnd === -1) return shape;
  const body = shape.slice(txStart, txEnd + '</p:txBody>'.length);
  const allParas = [...body.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].map((m) => m[0]);
  // Prefer content-bearing paragraphs when empty breakLine stubs inflated the count.
  const contentParas = allParas.filter(
    (p) => /<a:t>/.test(p) && !/<a:t>(?:\s|&nbsp;)*<\/a:t>/.test(p)
  );
  const paraMatches =
    contentParas.length === paragraphs.length ? contentParas : allParas;
  // Cannot safely merge when OOXML has fewer paras than IR — leave shape as-is
  // so per-paragraph metric injection still covers every emitted <a:p>.
  if (paraMatches.length < paragraphs.length) return shape;

  const leading = body.slice(0, body.indexOf(paraMatches[0]));
  const lastPara = paraMatches[paragraphs.length - 1];
  const trailing = body.slice(body.indexOf(lastPara) + lastPara.length);
  // Keep only empty trailing stubs from pptxgenjs — never re-append extra content paras.
  const extras = (contentParas.length === paragraphs.length ? [] : allParas.slice(paragraphs.length)).filter(
    (p) => !/<a:t>/.test(p) || /<a:t>(?:\s|&nbsp;)*<\/a:t>/.test(p)
  );

  const merged = groups.map((group) => {
    if (group.length === 1) return paraMatches[group[0]];
    const parts = group.map((index) => paraMatches[index]);
    const firstPPr = parts[0].match(/<a:pPr\b[\s\S]*?<\/a:pPr>|<a:pPr\b[^>]*\/>/)?.[0] ?? '<a:pPr/>';
    const endPr =
      parts[parts.length - 1].match(/<a:endParaRPr\b[^>]*\/>|<a:endParaRPr\b[\s\S]*?<\/a:endParaRPr>/)?.[0] ??
      '';
    const bodies = parts.map((part) => {
      let content = part.replace(/^<a:p>/, '').replace(/<\/a:p>$/, '');
      // Strip every pPr / endParaRPr — a single replace left leftovers after <a:br/>.
      content = content.replace(/<a:pPr\b[\s\S]*?<\/a:pPr>|<a:pPr\b[^>]*\/>/g, '');
      content = content.replace(
        /<a:endParaRPr\b[^>]*\/>|<a:endParaRPr\b[\s\S]*?<\/a:endParaRPr>/g,
        ''
      );
      // Do NOT trim() or drop empty bodies — that deletes leading spaces and
      // consecutive soft-break blank rows (R-TXT-27).
      return content;
    });
    return `<a:p>${firstPPr}${bodies.join('<a:br/>')}${endPr}</a:p>`;
  });

  const newBody = `${leading}${merged.join('')}${extras.join('')}${trailing}`;
  return shape.slice(0, txStart) + newBody + shape.slice(txEnd + '</p:txBody>'.length);
}

/**
 * Remove a leading `<a:br/>` that sits after `pPr` and before the first run.
 * Those stubs insert a blank visual row (Insight/Idea gap regression) and are
 * not a real soft-break between two text runs.
 */
export function stripLeadingBreakStubs(shape: string): string {
  return shape.replace(
    /(<a:p>(?:\s*<a:pPr\b[^/]*\/>|\s*<a:pPr\b[\s\S]*?<\/a:pPr>)?\s*)<a:br\s*\/>\s*(?=<a:r>)/g,
    '$1'
  );
}

/**
 * Force DrawingML noAutofit so PPT never reflows Figma-measured boxes.
 * wrap="none" when visual rows are locked (multi-row bake or safe single-row
 * metrics — gate is canLockVisualWraps). Otherwise wrap="square".
 */
function ensureNoAutofit(shape: string, visualWrapLocked = false): string {
  const wrapMode = visualWrapLocked ? 'none' : 'square';
  const forceWrap = (attrs: string): string => {
    let tag = `<a:bodyPr${attrs}>`;
    tag = setAttribute(tag, 'wrap', wrapMode);
    return tag.slice('<a:bodyPr'.length, -1);
  };
  // Self-closing bodyPr → expand and insert noAutofit.
  if (/<a:bodyPr\b[^>]*\/>/.test(shape)) {
    return shape.replace(/<a:bodyPr\b([^>]*)\/>/, (_whole, attrs: string) => {
      return `<a:bodyPr${forceWrap(attrs)}><a:noAutofit/></a:bodyPr>`;
    });
  }
  return shape.replace(
    /<a:bodyPr\b([^>]*)>([\s\S]*?)<\/a:bodyPr>/,
    (_whole, attrs: string, body: string) => {
      let next = body
        .replace(/<a:spAutoFit\s*\/>/g, '')
        .replace(/<a:normAutofit\b[^>]*\/>/g, '')
        .replace(/<a:normAutofit\b[\s\S]*?<\/a:normAutofit>/g, '');
      if (!/<a:noAutofit\s*\/>/.test(next)) {
        next = `<a:noAutofit/>${next}`;
      }
      return `<a:bodyPr${forceWrap(attrs)}>${next}</a:bodyPr>`;
    }
  );
}

/** Per-run DrawingML cap when style spans differ (layer-level cap is the fallback). */
function injectRunCaps(shape: string, runs: IRTextRun[] | undefined, layerCap?: 'all' | 'small'): string {
  if (!runs || runs.length === 0) {
    if (!layerCap) return shape;
    return shape.replace(/<a:(?:rPr|endParaRPr)\b[^>]*>/g, (tag) =>
      setAttribute(tag, 'cap', layerCap)
    );
  }
  let runIndex = 0;
  return shape.replace(/<a:r>([\s\S]*?)<\/a:r>/g, (block) => {
    const run = runs[runIndex++];
    const cap = drawingMlCap(run?.textCase) ?? layerCap;
    if (!cap) return block;
    return block.replace(/<a:rPr\b[^>]*>/, (tag) => setAttribute(tag, 'cap', cap));
  });
}

/** Apply text features supported by DrawingML but not exposed by PptxGenJS v4. */
function injectTextProperties(
  xml: string,
  marker: string,
  paragraphIndentPx?: number,
  cap?: 'all' | 'small',
  paragraphs?: IRTextParagraph[],
  runs?: IRTextRun[],
  visualLines?: IRTextVisualLine[],
  visualWrapLocked = false
): string {
  const markerIndex = xml.indexOf(`name="${marker}"`);
  if (markerIndex === -1) return xml;
  const start = xml.lastIndexOf('<p:sp>', markerIndex);
  const endTag = '</p:sp>';
  const endStart = xml.indexOf(endTag, markerIndex);
  if (start === -1 || endStart === -1) return xml;

  let shape = xml.slice(start, endStart + endTag.length);
  // Soft-break merge first so wrap=none can require proven multiline structure.
  // Metrics must match the *emitted* <a:p> count: collapsed only when merge
  // actually reduced groups; otherwise per-paragraph (avoids later rows losing lnSpc).
  let metricParagraphs: IRTextParagraph[] | undefined;
  if (paragraphs && paragraphs.length > 0) {
    const groups = softBreakGroups(paragraphs);
    const wantsMerge = groups.some((group) => group.length > 1);
    const beforeCount = contentParagraphCount(shape);
    shape = mergeSoftBreakParagraphs(shape, paragraphs);
    const afterCount = contentParagraphCount(shape);
    const mergeApplied = wantsMerge && afterCount === groups.length && afterCount <= beforeCount;
    metricParagraphs = paragraphMetricsForInjection(
      paragraphs,
      visualLines,
      mergeApplied || !wantsMerge
    );
  }
  shape = stripLeadingBreakStubs(shape);
  shape = ensureNoAutofit(shape, visualWrapLocked);
  if (paragraphIndentPx !== undefined) {
    // DrawingML indents are EMU; IR lengths are slide pt after page mapping (1pt=12700 EMU).
    const indentEmu = Math.round(paragraphIndentPx * 12700);
    shape = shape.replace(/<a:pPr\b[^>]*>/g, (tag) => {
      let result = setAttribute(tag, 'marL', '0');
      result = setAttribute(result, 'indent', String(indentEmu));
      return result;
    });
  }
  if (metricParagraphs && metricParagraphs.length > 0) {
    let paragraphIndex = 0;
    shape = shape.replace(
      /<a:pPr\b([^>]*)>([\s\S]*?)<\/a:pPr>/g,
      (_whole, attributes: string, body: string) => {
        const paragraph = metricParagraphs[paragraphIndex++];
        if (!paragraph) return `<a:pPr${attributes}>${body}</a:pPr>`;
        let opening = `<a:pPr${attributes}>`;
        const marginLeft =
          paragraph.indentation !== null && paragraph.indentation !== undefined
            ? paragraph.indentation
            : 0;
        opening = setAttribute(opening, 'marL', String(Math.round(marginLeft * 12700)));
        if (paragraph.paragraphIndent !== null) {
          opening = setAttribute(
            opening,
            'indent',
            String(Math.round(paragraph.paragraphIndent * 12700))
          );
        }
        const align = paragraph.textAlignHorizontal;
        if (align) {
          const value =
            align === 'CENTER'
              ? 'ctr'
              : align === 'RIGHT'
                ? 'r'
                : align === 'JUSTIFIED'
                  ? 'just'
                  : 'l';
          opening = setAttribute(opening, 'algn', value);
        }
        let content = body
          .replace(/<a:lnSpc>[\s\S]*?<\/a:lnSpc>/g, '')
          .replace(/<a:spcBef>[\s\S]*?<\/a:spcBef>/g, '')
          .replace(/<a:spcAft>[\s\S]*?<\/a:spcAft>/g, '');
        let metrics = '';
        if (paragraph.lineHeight?.unit === 'PIXELS' && paragraph.lineHeight.value > 0) {
          metrics += `<a:lnSpc><a:spcPts val="${typographyCentipoints(paragraph.lineHeight.value)}"/></a:lnSpc>`;
        }
        if (
          paragraph.paragraphSpaceBefore !== null &&
          paragraph.paragraphSpaceBefore !== undefined &&
          paragraph.paragraphSpaceBefore > 0
        ) {
          metrics += `<a:spcBef><a:spcPts val="${typographyCentipoints(paragraph.paragraphSpaceBefore)}"/></a:spcBef>`;
        }
        const spaceAfter = paragraphSpaceAfterPx(paragraph);
        if (spaceAfter > 0) {
          metrics += `<a:spcAft><a:spcPts val="${typographyCentipoints(spaceAfter)}"/></a:spcAft>`;
        }
        if (paragraph.listType === 'UNORDERED') {
          content = content.replace(/<a:buNone\/>/g, '<a:buChar char="•"/>');
        } else if (paragraph.listType === 'ORDERED') {
          content = content.replace(
            /<a:buNone\/>/g,
            '<a:buAutoNum type="arabicPeriod" startAt="1"/>'
          );
        }
        content = metrics + content;
        return `${opening}${content}</a:pPr>`;
      }
    );
  }
  shape = injectRunCaps(shape, runs, cap);
  shape = injectTextGradientFills(shape, runs);
  return xml.slice(0, start) + shape + xml.slice(endStart + endTag.length);
}

/**
 * Rewrite the generated pptx zip, injecting srcRect/tile/custGeom where needed.
 * Accepts an ArrayBuffer or Uint8Array and returns a Uint8Array.
 */
export async function postProcessPptx(
  buffer: ArrayBuffer | Uint8Array,
  doc: IRDocument,
  options: ExportOptions
): Promise<Uint8Array> {
  const operations = buildOperations(doc, options);
  if (operations.size === 0) {
    return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  }

  const zip = await JSZip.loadAsync(buffer);
  for (const [slideNum, list] of operations) {
    const path = `ppt/slides/slide${slideNum}.xml`;
    const file = zip.file(path);
    if (!file) continue;
    let xml = await file.async('string');
    for (const op of list) {
      if (op.kind === 'srcRect') {
        xml = injectSrcRect(xml, op.marker, srcRectXml(op.srcRect));
      } else if (op.kind === 'tile') {
        xml = injectTile(xml, op.marker, tileXml(op.scaleX, op.scaleY));
      } else if (op.kind === 'geometry') {
        xml = injectGeometry(xml, op.marker, op.xml);
      } else {
        xml = injectTextProperties(
          xml,
          op.marker,
          op.paragraphIndentPx,
          op.cap,
          op.paragraphs,
          op.runs,
          op.visualLines,
          op.visualWrapLocked
        );
      }
    }
    zip.file(path, xml);
  }

  return zip.generateAsync({ type: 'uint8array' });
}
