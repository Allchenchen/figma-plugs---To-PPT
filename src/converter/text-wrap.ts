/**
 * Lock Figma SVG visual wraps into the editable text model (R-TXT-25).
 *
 * Figma is the authority for where lines break. When SVG visual lines reconcile
 * exactly with source characters and there are 2+ rows:
 *   1. Bake any missing auto-wrap points as `\n` (soft breaks → `<a:br/>`).
 *   2. Set `visualWrapLocked` so postprocess may use `wrap="none"` **only if**
 *      the emitted shape actually has multiline structure (`<a:br/>` or ≥2 paras).
 *
 * Single-line / unavailable / mismatch SVG must not lock — wrap stays `square`
 * so fixed-width boxes keep native auto-wrap (no single-line overflow).
 */

import type {
  IRText,
  IRTextBoundary,
  IRTextParagraph,
  IRTextRun,
  IRTextVisualLine,
} from '../ir/types';
import {
  normalizeFigmaNewlines,
  sliceTextRuns,
  splitVisualLinesAtSourceBreaks,
} from '../reader/text-model';
import { resolveTextParagraphs } from './text-paragraphs';

function defaultRuns(text: IRText): IRTextRun[] {
  if (text.runs && text.runs.length > 0) return text.runs;
  return [
    {
      text: text.characters,
      start: 0,
      end: text.characters.length,
      fontSize: text.fontSize,
      fontFamily: text.fontFamily,
      fontStyle: text.fontStyle,
      fontWeight: text.fontWeight,
      color: text.color,
      letterSpacing: text.letterSpacing,
      opacity: text.opacity,
      underline: text.underline,
      strikethrough: text.strikethrough,
      textCase:
        text.textCase === 'MIXED' || text.textCase === undefined ? undefined : text.textCase,
    },
  ];
}

const MEASURED_GAP_EPS = 0.5;

/**
 * Auto-wrap with the same measured gap stays a soft break.
 * Enter, or a later gap that stays inside the same Figma paragraph, starts a paragraph.
 * The last line's gap into the next paragraph already includes paragraph spacing,
 * so it must not split the wrapped lines above it.
 */
export function visualLineBreakKind(
  lines: readonly IRTextVisualLine[],
  index: number
): 'softBreak' | 'paragraphBreak' {
  const next = lines[index + 1];
  if (!next) return 'paragraphBreak';
  if (lines[index].paragraphIndex !== next.paragraphIndex) return 'paragraphBreak';
  const following = lines[index + 2];
  if (!following || next.paragraphIndex !== following.paragraphIndex) return 'softBreak';
  const currentGap = lines[index].lineHeightPx;
  const nextGap = next.lineHeightPx;
  if (
    currentGap !== undefined &&
    nextGap !== undefined &&
    currentGap > 0 &&
    nextGap > 0 &&
    Math.abs(currentGap - nextGap) > MEASURED_GAP_EPS
  ) {
    return 'paragraphBreak';
  }
  return 'softBreak';
}

function rebuildParagraphs(text: IRText, lines: IRTextVisualLine[]): IRTextParagraph[] {
  const source = resolveTextParagraphs(text);
  let pos = 0;
  return lines.map((line, index) => {
    const src =
      source[Math.min(Math.max(line.paragraphIndex, 0), source.length - 1)] ?? source[0];
    const start = pos;
    const end = pos + line.text.length;
    pos = end + (index < lines.length - 1 ? 1 : 0);
    const firstInParagraph =
      index === 0 || lines[index - 1].paragraphIndex !== line.paragraphIndex;
    const lastInParagraph =
      index === lines.length - 1 || lines[index + 1].paragraphIndex !== line.paragraphIndex;
    const nextLine = lines[index + 1];
    const crossesParagraph =
      nextLine !== undefined && nextLine.paragraphIndex !== line.paragraphIndex;
    // The baseline gap into the next paragraph already includes paragraphSpacing.
    // Keep that spacing on spcAft only, so lnSpc is the line box.
    let measuredPx =
      line.lineHeightPx !== undefined && line.lineHeightPx > 0 ? line.lineHeightPx : undefined;
    if (crossesParagraph && measuredPx !== undefined) {
      const spacing = src.paragraphSpacing;
      if (typeof spacing === 'number' && spacing > 0 && measuredPx > spacing) {
        measuredPx -= spacing;
      }
    }
    const measured =
      measuredPx !== undefined ? ({ unit: 'PIXELS' as const, value: measuredPx }) : null;
    const nominalPixels =
      src.lineHeight?.unit === 'PERCENT'
        ? {
            unit: 'PIXELS' as const,
            value: (text.fontSize * src.lineHeight.value) / 100,
          }
        : src.lineHeight?.unit === 'PIXELS'
          ? src.lineHeight
          : null;
    const lineHeight = measured ?? nominalPixels ?? src.lineHeight;
    // Mid-paragraph visual wraps are softBreak; crossing paragraphIndex is paragraphBreak.
    const breakAfter = index < lines.length - 1 ? visualLineBreakKind(lines, index) : undefined;
    return {
      start,
      end,
      lineHeight,
      mixedLineHeight: false,
      // Preserve null (mixed/unknown) — do not coerce to 0 via ?? (soft-join guard).
      paragraphSpacing: lastInParagraph
        ? src.paragraphSpacing === undefined
          ? 0
          : src.paragraphSpacing
        : 0,
      paragraphSpaceBefore: firstInParagraph ? (src.paragraphSpaceBefore ?? 0) : 0,
      paragraphIndent: firstInParagraph ? (src.paragraphIndent ?? 0) : 0,
      textAlignHorizontal: src.textAlignHorizontal,
      listType: firstInParagraph ? src.listType : 'NONE',
      listSpacing: lastInParagraph ? src.listSpacing : undefined,
      indentation: src.indentation,
      leadingTrim: src.leadingTrim,
      breakAfter,
    };
  });
}

function rebuildBoundaries(lines: IRTextVisualLine[]): IRTextBoundary[] {
  const boundaries: IRTextBoundary[] = [];
  let pos = 0;
  for (let i = 0; i < lines.length - 1; i += 1) {
    pos += lines[i].text.length;
    const kind = visualLineBreakKind(lines, i);
    boundaries.push({
      index: pos,
      sourceIndex: -1,
      sourceLength: 1,
      kind,
      sourceCharacter: kind === 'softBreak' ? '\\n(visual-wrap)' : '\\n',
    });
    pos += 1;
  }
  return boundaries;
}

function rebuildRuns(text: IRText, lines: IRTextVisualLine[]): IRTextRun[] {
  const base = defaultRuns(text);
  const out: IRTextRun[] = [];
  let outPos = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const sliced = sliceTextRuns(base, line.start, line.end);
    const isLastLine = i === lines.length - 1;
    // Keep run text free of trailing `\n`. Characters join lines with `\n`;
    // textRuns expands those via breakLine.
    if (sliced.length === 0) {
      if (!isLastLine) outPos += 1;
      continue;
    }
    for (const run of sliced) {
      out.push({
        ...run,
        text: run.text,
        start: outPos,
        end: outPos + run.text.length,
      });
      outPos += run.text.length;
    }
    if (!isLastLine) outPos += 1;
  }
  return out;
}

/**
 * Rough advance width in px (Figma space) for the single-line fit gate.
 * CJK ≈ 1em; digits/metrics ≈ 0.5em; other latin ≈ 0.6em.
 */
export function estimateLineWidthPx(characters: string, fontSize: number): number {
  let units = 0;
  for (const ch of characters) {
    if (ch === ' ' || ch === '\t') units += 0.33;
    else if (/[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch)) units += 1;
    else if (/[0-9.,\-%‰]/.test(ch)) units += 0.5;
    else units += 0.6;
  }
  return units * fontSize;
}

/**
 * True when a single SVG row is short enough that Figma could have shown it
 * in `rect` without wrapping. Long CJK with a false 1-line SVG stays unlocked
 * so wrap=square can still reflow (Idea overflow guard).
 */
export function textFitsSingleLineBox(text: IRText): boolean {
  const width = text.rect?.width;
  if (!width || width <= 0 || !(text.fontSize > 0)) return false;
  const chars = normalizeFigmaNewlines(text.characters ?? '').replace(/\n/g, '');
  if (chars.length === 0) return false;
  // 0.6em overestimates a hug-width title (about 0.5em), so 1.08 wraps the last
  // glyph in PowerPoint. 1.35 still rejects a false one-line SVG of a long CJK
  // paragraph (Idea), which estimates at more than twice the box.
  return estimateLineWidthPx(chars, text.fontSize) <= width * 1.35;
}

/**
 * True when SVG visual lines are an exact layout we can freeze.
 * - ≥2 rows: bake soft wraps + wrap=none (R-TXT-25).
 * - 1 row, no `\n`, fits box: wrap=none so PPT cannot mid-glyph wrap
 *   (Results metrics "196,336" → "196,33"/"6").
 * - 1 row that cannot fit: leave unlocked (Idea overflow guard).
 */
export function canLockVisualWraps(text: IRText): boolean {
  if (text.visualLineStatus !== 'exact' || !Array.isArray(text.visualLines)) {
    return false;
  }
  if (text.visualLines.length >= 2) return true;
  if (text.visualLines.length !== 1) return false;
  const chars = normalizeFigmaNewlines(text.characters ?? '');
  if (chars.includes('\n')) return false;
  return textFitsSingleLineBox(text);
}

/**
 * Bake Figma visual-line breaks and mark the box so PPT wrap stays off.
 *
 * Always rebuild characters / paragraphs / runs / boundaries from `visualLines`
 * (even when the joined string already matches). Stale paragraph IR would leave
 * soft-break groups misaligned and allow PPT `wrap=square` reflow to join the
 * next Figma row onto the previous line.
 */
export function lockVisualWraps(text: IRText): IRText {
  if (text.visualWrapLocked) return text;
  if (!canLockVisualWraps(text)) return text;

  // Re-split at any source `\n` still inside a reconciled SVG row (SVG may
  // flatten “涹齢”“弨慥螎” onto one baseline while characters keep Enter).
  const lines = splitVisualLinesAtSourceBreaks(
    text.visualLines!,
    text.characters,
    text.boundaries
  );
  const nextCharacters = lines.map((line) => line.text).join('\n');
  const forRebuild = { ...text, visualLines: lines };

  return {
    ...text,
    characters: nextCharacters,
    paragraphs: rebuildParagraphs(forRebuild, lines),
    runs: rebuildRuns(text, lines),
    boundaries: rebuildBoundaries(lines),
    visualLines: lines.map((line, index) => {
      let start = 0;
      for (let i = 0; i < index; i += 1) start += lines[i]!.text.length + 1;
      return {
        ...line,
        start,
        end: start + line.text.length,
        text: line.text,
      };
    }),
    visualWrapLocked: true,
  };
}
