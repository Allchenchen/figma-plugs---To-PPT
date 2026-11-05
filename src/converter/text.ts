import type { IRText, IRTextRun, Rect } from '../ir/types';
import { normalizeFigmaNewlines, sliceTextRuns } from '../reader/text-model';
import { stripHash, opacityToTransparency } from './colors';
import {
  mapFontFace,
  pptBold,
  pptCharSpacing,
  pptFontSize,
  pptLangForFace,
  pptTextMargin,
  TEXT_OBJECT_PREFIX,
} from './text-layout';
import { applyDisplayTextCase } from './text-case';
import { slidePtToInch } from './page-scale';
import { pptxValignFromFigma } from './text-vertical';
import { round2 } from './units';

/**
 * Keep Figma text-box width exact (scale = 1).
 * Widening fudge changes Chinese wrap and shifts columns.
 */
const TEXT_WIDTH_SCALE = 1;

/**
 * Expand a text box for glyph-width safety WITHOUT shifting the aligned edge.
 * Left: grow right. Right: grow left. Center: grow both sides equally.
 */
export function textBoxLayout(
  rect: Rect,
  alignH: IRText['textAlignHorizontal'],
  widthScale = TEXT_WIDTH_SCALE
): Rect {
  if (widthScale === 1) return { ...rect };
  const width = rect.width * widthScale;
  const extra = width - rect.width;
  let x = rect.x;
  if (alignH === 'CENTER') x = rect.x - extra / 2;
  else if (alignH === 'RIGHT') x = rect.x - extra;
  return { x, y: rect.y, width, height: rect.height };
}

function align(v: IRText['textAlignHorizontal']): 'left' | 'center' | 'right' | 'justify' {
  switch (v) {
    case 'CENTER':
      return 'center';
    case 'RIGHT':
      return 'right';
    case 'JUSTIFIED':
      return 'justify';
    default:
      return 'left';
  }
}

/**
 * Simple text path: keep Figma RGB unchanged; map effective opacity onto the
 * glyph fill via PptxGenJS `transparency` (DrawingML `<a:alpha>` on `srgbClr`).
 *
 * IR `opacity` is already paint × node (and single-child inherited) — applied
 * once here. Do NOT bake into a grey hex (that permanently rewrites the color
 * and is not editable as the source white/brand color).
 *
 * `backgroundHex` is unused for this mapping (kept so call sites stay stable).
 */
function resolvedFontColor(
  color: string,
  opacity: number | undefined,
  _backgroundHex?: string
): { color: string; transparency?: number } {
  const colorOut = stripHash(color);
  // Missing opacity → opaque. Explicit 0 must stay fully transparent (not `|| 1`).
  if (opacity === undefined || opacity >= 1 - 1e-6) return { color: colorOut };
  return { color: colorOut, transparency: opacityToTransparency(opacity) };
}

function isItalicStyle(run: IRTextRun): boolean {
  if (run.italic) return true;
  const style = (run.fontStyle ?? '').toLowerCase();
  return style.includes('italic') || style.includes('oblique');
}

function runOptions(
  run: IRTextRun,
  backgroundHex: string
): Record<string, unknown> {
  const fill = resolvedFontColor(run.color, run.opacity, backgroundHex);
  const face = mapFontFace(run.fontFamily);
  const opts: Record<string, unknown> = {
    fontSize: pptFontSize(run.fontSize),
    fontFace: face,
    color: fill.color,
    bold: pptBold(run.fontWeight),
    ...pptLangForFace(face),
  };
  if (run.letterSpacing !== 0) {
    opts.charSpacing = pptCharSpacing(run.letterSpacing);
  }
  if (run.underline) opts.underline = true;
  if (run.strikethrough) opts.strike = true;
  if (isItalicStyle(run)) opts.italic = true;
  if (fill.transparency !== undefined) {
    opts.transparency = fill.transparency;
  }
  return opts;
}

/** Shape/box options for pptxgenjs `addText` (geometry + paragraph metrics). */
export function textBoxOptions(layer: IRText): Record<string, unknown> {
  // Geometry stays exactly Figma's measured box — never nudge Y/H to fake
  // glyph baselines. Internal line packing is handled in OOXML postprocess.
  const box = textBoxLayout(layer.rect, layer.textAlignHorizontal, TEXT_WIDTH_SCALE);
  const opts: Record<string, unknown> = {
    x: slidePtToInch(box.x),
    y: slidePtToInch(box.y),
    w: slidePtToInch(box.width),
    h: slidePtToInch(box.height),
    valign: pptxValignFromFigma(layer.textAlignVertical),
    align: align(layer.textAlignHorizontal),
    // Tuple is [left, right, bottom, top] points. SVG baseline is not an inset:
    // writing it into tIns drops the whole block by about one ascent.
    margin: pptTextMargin(0, 0, 0, 0),
    wrap: layer.visualLineStatus === 'exact' || layer.visualWrapLocked ? false : true,
    wordWrap: true,
    // Figma already measured the final box. `spAutoFit` makes PowerPoint
    // recalculate its height with different font metrics and shifts glyphs.
    fit: 'none',
    isTextBox: true,
    objectName: `${TEXT_OBJECT_PREFIX}${layer.id}`,
    ...(layer.rotation !== 0 ? { rotate: round2(layer.rotation) } : {}),
    ...(layer.flipH ? { flipH: true } : {}),
    ...(layer.flipV ? { flipV: true } : {}),
  };

  return opts;
}

export function textFillOptions(
  layer: IRText,
  backgroundHex = '#FFFFFF'
): Record<string, unknown> {
  const fill = resolvedFontColor(layer.color, layer.opacity, backgroundHex);
  const face = mapFontFace(layer.fontFamily);
  const opts: Record<string, unknown> = {
    fontSize: pptFontSize(layer.fontSize),
    fontFace: face,
    color: fill.color,
    bold: pptBold(layer.fontWeight),
    charSpacing: pptCharSpacing(layer.letterSpacing),
    ...pptLangForFace(face),
  };
  if (layer.underline) opts.underline = true;
  if (layer.strikethrough) opts.strike = true;
  if (fill.transparency !== undefined) {
    opts.transparency = fill.transparency;
  }
  return opts;
}

/** @deprecated Prefer textBoxOptions + textFillOptions; kept for existing tests. */
export function textOptions(
  layer: IRText,
  backgroundHex = '#FFFFFF'
): Record<string, unknown> {
  return {
    ...textBoxOptions(layer),
    ...textFillOptions(layer, backgroundHex),
  };
}

/**
 * PptxGenJS only starts a new `<a:p>` for string `\n` or `breakLine: true`.
 * Newlines embedded in rich-text run strings become literal characters — expand
 * them to breakLine so soft-break merge can see real paragraphs.
 *
 * Trailing empty segments from `"line\n".split("\n")` must be dropped; otherwise
 * pptxgenjs emits empty `<a:p>` that soft-break merge turns into blank rows /
 * leftover `<a:pPr>` after `<a:br/>` (visible as gaps + duplicated lines).
 */
function expandNewlinesToBreakLines(
  items: { text: string; options: Record<string, unknown> }[]
): { text: string; options: Record<string, unknown> }[] {
  const out: { text: string; options: Record<string, unknown> }[] = [];
  for (const item of items) {
    const parts = item.text.split('\n');
    if (parts.length > 1 && parts[parts.length - 1] === '') {
      parts.pop();
    }
    for (let i = 0; i < parts.length; i += 1) {
      const isLast = i === parts.length - 1;
      out.push({
        text: parts[i],
        options: isLast ? item.options : { ...item.options, breakLine: true },
      });
    }
  }
  return out;
}

/**
 * When `characters` contain `\n` but run texts omit them (visual-wrap bake),
 * emit one breakLine per character line using UTF-16 ranges in character space.
 */
function textRunsFromCharacterBreaks(
  layer: IRText,
  backgroundHex: string
): { text: string; options: Record<string, unknown> }[] {
  const chars = normalizeFigmaNewlines(layer.characters);
  const lines = chars.split('\n');
  const runs = layer.runs ?? [];
  const out: { text: string; options: Record<string, unknown> }[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const sliced = sliceTextRuns(runs, offset, offset + line.length);
    const isLastLine = i === lines.length - 1;
    const breakOpt = !isLastLine ? { breakLine: true as const } : {};
    const joinedSlice = sliced.map((run) => run.text).join('');
    // `characters` is authoritative for row text (R-TXT-27). Only trust run
    // slices when they reproduce the row exactly — otherwise emit the line
    // verbatim with the best available style (avoids truncation from bad ranges).
    if (sliced.length > 0 && joinedSlice === line) {
      sliced.forEach((run, runIndex) => {
        const lastOnLine = runIndex === sliced.length - 1;
        out.push({
          text: applyDisplayTextCase(run.text, run.textCase ?? layer.textCase),
          options: {
            ...runOptions(run, backgroundHex),
            ...(lastOnLine ? breakOpt : {}),
          },
        });
      });
    } else {
      const styleRun = sliced[0];
      out.push({
        text: applyDisplayTextCase(line, styleRun?.textCase ?? layer.textCase),
        options: {
          ...(styleRun
            ? runOptions(styleRun, backgroundHex)
            : textFillOptions(layer, backgroundHex)),
          ...breakOpt,
        },
      });
    }
    offset += line.length + 1;
  }
  return out;
}

/**
 * Rich-text / uniform runs for pptxgenjs `addText`.
 * Preserves `\n` as paragraph breaks (via breakLine for rich runs); paragraph
 * metrics are injected by the single Paragraph → OOXML post-processing path.
 * Does not merge separate Figma TextNodes — each IRText is one call site.
 */
export function textRuns(
  layer: IRText,
  backgroundHex = '#FFFFFF'
): { text: string; options: Record<string, unknown> }[] {
  const chars = normalizeFigmaNewlines(layer.characters);
  const charBreaks = (chars.match(/\n/g) || []).length;
  if (layer.runs && layer.runs.length > 0) {
    const joined = layer.runs.map((run) => run.text).join('');
    const runBreaks = (joined.match(/\n/g) || []).length;
    // Explicit breaks live in `characters` / `boundaries` (R-TXT-27).
    // Prefer character-row emission whenever runs omit or under-count `\n`
    // (segment gaps, visual-wrap bake, partial newline loss in runs).
    if (charBreaks > 0 && runBreaks < charBreaks) {
      return textRunsFromCharacterBreaks(layer, backgroundHex);
    }
    return expandNewlinesToBreakLines(
      layer.runs.map((run) => ({
        text: applyDisplayTextCase(run.text, run.textCase ?? layer.textCase),
        options: runOptions(run, backgroundHex),
      }))
    );
  }
  return expandNewlinesToBreakLines([
    {
      text: applyDisplayTextCase(layer.characters, layer.textCase),
      options: textFillOptions(layer, backgroundHex),
    },
  ]);
}

/** Number of explicit breaks that must appear as breakLine / `<a:br/>` or paras. */
export function explicitBreakCount(layer: IRText): number {
  if (layer.boundaries && layer.boundaries.length > 0) return layer.boundaries.length;
  return (normalizeFigmaNewlines(layer.characters).match(/\n/g) || []).length;
}

/**
 * Split only paragraphs whose character ranges have mixed line-height values.
 * Baseline deltas come from Figma's SVG output; no synthetic line-height
 * average, maximum or fixed offset is introduced.
 */
/** One Figma text node stays one text box, including mixed measured line gaps. */
export function textRenderFragments(layer: IRText): IRText[] {
  return [layer];
}
