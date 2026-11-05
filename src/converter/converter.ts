import PptxGenJS from 'pptxgenjs';
import type {
  IRDocument,
  IRElement,
  IRShape,
  IRSlide,
  ExportOptions,
  ExportSizePreset,
} from '../ir/types';
import { stripHash, opacityToTransparency } from './colors';
import { shapeSitsOnLowerContent } from '../reader/cover-opacity';
import { textBoxOptions, textRenderFragments, textRuns } from './text';
import { lockVisualWraps } from './text-wrap';
import { shapeRender, lineRender } from './shape';
import { IMAGE_OBJECT_PREFIX, PICTURE_SHAPE_PREFIX } from './postprocess';
import {
  layoutForFrame,
  mapRectToSlide,
  slidePtToInch,
  type PageLayout,
} from './page-scale';
import { PPT_HEIGHT_IN, PPT_WIDTH_IN } from './units';

/** @deprecated Prefer PageLayout; kept as alias for existing call sites. */
export type Layout = PageLayout;

/**
 * Always target the project 1920×1080 pt page.
 * `preset` is retained for API compatibility but does not change the page size.
 */
export function resolveLayout(slide: IRSlide, _preset: ExportSizePreset = 'frame'): PageLayout {
  return layoutForFrame(slide.width, slide.height);
}

function scaleRect(r: { x: number; y: number; width: number; height: number }, layout: PageLayout) {
  return mapRectToSlide(r, layout);
}

/**
 * Map Frame-space elements into 1920×1080 pt slide space.
 * Geometry always remapped (scale + letterbox). Typography scales only when scale≠1.
 */
function scaleElement(el: IRElement, layout: PageLayout): IRElement {
  const identity =
    layout.scale === 1 && layout.offsetX === 0 && layout.offsetY === 0;
  if (identity) return el;

  const s = layout.scale;
  const rect = scaleRect(el.rect, layout);

  if (s === 1) {
    // Letterbox translate only — keep font metrics unchanged.
    if (el.type === 'text') {
      return {
        ...el,
        rect,
        visualLines: el.visualLines
          ? el.visualLines.map((line) => ({
              ...line,
              x: line.x + layout.offsetX,
              baselineY: line.baselineY + layout.offsetY,
            }))
          : undefined,
        sourceSvgViewBox: el.sourceSvgViewBox
          ? {
              ...el.sourceSvgViewBox,
              x: el.sourceSvgViewBox.x + layout.offsetX,
              y: el.sourceSvgViewBox.y + layout.offsetY,
            }
          : undefined,
        sourceRenderBounds: el.sourceRenderBounds
          ? scaleRect(el.sourceRenderBounds, layout)
          : undefined,
      };
    }
    return { ...el, rect };
  }

  if (el.type === 'text') {
    return {
      ...el,
      rect,
      fontSize: el.fontSize * s,
      letterSpacing: el.letterSpacing * s,
      lineHeight: el.lineHeight === null ? null : el.lineHeight * s,
      paragraphSpacing:
        el.paragraphSpacing === null || el.paragraphSpacing === undefined
          ? el.paragraphSpacing
          : el.paragraphSpacing * s,
      paragraphIndent:
        el.paragraphIndent === null || el.paragraphIndent === undefined
          ? el.paragraphIndent
          : el.paragraphIndent * s,
      runs: el.runs
        ? el.runs.map((r) => ({
            ...r,
            fontSize: r.fontSize * s,
            letterSpacing: r.letterSpacing * s,
          }))
        : undefined,
      paragraphs: el.paragraphs
        ? el.paragraphs.map((paragraph) => ({
            ...paragraph,
            lineHeight:
              paragraph.lineHeight?.unit === 'PIXELS'
                ? { unit: 'PIXELS' as const, value: paragraph.lineHeight.value * s }
                : paragraph.lineHeight,
            paragraphSpacing:
              paragraph.paragraphSpacing === null || paragraph.paragraphSpacing === undefined
                ? paragraph.paragraphSpacing
                : paragraph.paragraphSpacing * s,
            paragraphIndent:
              paragraph.paragraphIndent === null || paragraph.paragraphIndent === undefined
                ? paragraph.paragraphIndent
                : paragraph.paragraphIndent * s,
            paragraphSpaceBefore:
              paragraph.paragraphSpaceBefore === null ||
              paragraph.paragraphSpaceBefore === undefined
                ? paragraph.paragraphSpaceBefore
                : paragraph.paragraphSpaceBefore * s,
            listSpacing:
              paragraph.listSpacing === null || paragraph.listSpacing === undefined
                ? paragraph.listSpacing
                : paragraph.listSpacing * s,
            indentation:
              paragraph.indentation === null || paragraph.indentation === undefined
                ? paragraph.indentation
                : paragraph.indentation * s,
          }))
        : undefined,
          visualLines: el.visualLines
        ? el.visualLines.map((line) => ({
            ...line,
            x: line.x * s,
            baselineY: line.baselineY * s,
            lineHeightPx:
              line.lineHeightPx !== undefined ? line.lineHeightPx * s : undefined,
          }))
        : undefined,
      sourceSvgViewBox: el.sourceSvgViewBox
        ? {
            x: el.sourceSvgViewBox.x * s,
            y: el.sourceSvgViewBox.y * s,
            width: el.sourceSvgViewBox.width * s,
            height: el.sourceSvgViewBox.height * s,
          }
        : undefined,
      sourceRenderBounds: el.sourceRenderBounds
        ? scaleRect(el.sourceRenderBounds, layout)
        : undefined,
    };
  }

  if (el.type === 'shape') {
    return {
      ...el,
      rect,
      cornerRadii: el.cornerRadii
        ? {
            tl: el.cornerRadii.tl * s,
            tr: el.cornerRadii.tr * s,
            br: el.cornerRadii.br * s,
            bl: el.cornerRadii.bl * s,
          }
        : null,
      stroke: el.stroke ? { ...el.stroke, weight: el.stroke.weight * s } : null,
    };
  }

  if (el.type === 'line') {
    return { ...el, rect, weight: el.weight * s };
  }

  return { ...el, rect };
}

/**
 * Build a PptxGenJS presentation from an IR document.
 * Returns the pptx instance; the caller decides write vs writeFile.
 */
export function createPptx(doc: IRDocument, options: ExportOptions): PptxGenJS {
  const pptx = new PptxGenJS();

  // One custom 1920×1080 pt layout for the whole deck (not PPT default 16:9).
  const layoutName = 'FIGMA_1920_1080';
  pptx.defineLayout({
    name: layoutName,
    width: PPT_WIDTH_IN,
    height: PPT_HEIGHT_IN,
  });
  pptx.layout = layoutName;

  doc.slides.forEach((slide) => {
    const layout = resolveLayout(slide, options.sizePreset);

    const s = pptx.addSlide();
    s.background = { color: stripHash(slide.backgroundColor) };

    const sorted = [...slide.elements].sort((a, b) => a.zIndex - b.zIndex);
    for (const el of sorted) {
      const scaled = scaleElement(el, layout);

      if (scaled.type === 'text') {
        // Glyph fill: original RGB + run/layer transparency (see resolvedFontColor).
        // Bake Figma SVG wraps into soft breaks and disable PPT reflow when exact.
        for (const fragment of textRenderFragments(scaled)) {
          const prepared = lockVisualWraps(fragment);
          s.addText(
            textRuns(prepared, slide.backgroundColor) as never,
            textBoxOptions(prepared) as never
          );
        }
      } else if (scaled.type === 'shape') {
        // A veil over images keeps its alpha. A shape on the empty slide
        // background is still baked so black cards do not turn gray.
        const render = shapeRender(scaled, slide.backgroundColor, {
          bakeFill: !shapeSitsOnLowerContent(el as IRShape, sorted),
        });
        // `custGeom` is supported at runtime but missing from pptxgenjs TS types.
        s.addShape(render.shape as never, render.options as never);
      } else if (scaled.type === 'line') {
        const render = lineRender(scaled);
        s.addShape(render.shape as never, render.options as never);
      } else if (scaled.type === 'image') {
        const sizing = scaled.sizing;
        const x = slidePtToInch(scaled.rect.x);
        const y = slidePtToInch(scaled.rect.y);
        const w = slidePtToInch(scaled.rect.width);
        const h = slidePtToInch(scaled.rect.height);
        const base = {
          data: `${scaled.mimeType};base64,${scaled.data}`,
          ...(scaled.opacity < 1 ? { transparency: opacityToTransparency(scaled.opacity) } : {}),
        };

        // Marker needed for OOXML post-process (srcRect / tile / corner clip).
        const needsSrcRect = sizing && (sizing.mode === 'cover' || sizing.mode === 'crop');
        const needsTile = sizing && sizing.mode === 'tile';
        const needsCorner = Boolean(scaled.cornerRadii);
        const marked =
          needsSrcRect || needsTile || needsCorner
            ? { objectName: `${IMAGE_OBJECT_PREFIX}${scaled.id}` }
            : {};

        if (sizing && sizing.mode === 'contain') {
          // FIT: place the image at its letterboxed size, centered, uncropped.
          const fw = slidePtToInch(sizing.fitWidth * layout.scale);
          const fh = slidePtToInch(sizing.fitHeight * layout.scale);
          s.addImage({
            ...base,
            x: x + (w - fw) / 2,
            y: y + (h - fh) / 2,
            w: fw,
            h: fh,
            ...marked,
          });
        } else {
          // FILL/CROP/TILE (and flattened PNG): place at the box; srcRect /
          // tile / roundRect geometry injected post-generation (native pic).
          s.addImage({
            ...base,
            x,
            y,
            w,
            h,
            ...marked,
          });
        }
      } else if (scaled.type === 'pictureShape') {
        // Native "picture shape" for non-rectangular masks: the mask geometry
        // (ellipse / roundRect / star / polygon) is swapped in post-processing.
        const opts: Record<string, unknown> = {
          data: `${scaled.mimeType};base64,${scaled.data}`,
          x: slidePtToInch(scaled.rect.x),
          y: slidePtToInch(scaled.rect.y),
          w: slidePtToInch(scaled.rect.width),
          h: slidePtToInch(scaled.rect.height),
          objectName: `${PICTURE_SHAPE_PREFIX}${scaled.id}`,
          ...(scaled.opacity < 1 ? { transparency: opacityToTransparency(scaled.opacity) } : {}),
          // Ellipse masks are expressible natively as a rounded picture.
          ...(scaled.shapeKind === 'ellipse' ? { rounding: true } : {}),
        };
        s.addImage(opts as never);
      }
    }
  });

  return pptx;
}
