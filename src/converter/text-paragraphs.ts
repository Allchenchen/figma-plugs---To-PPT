import type { IRText, IRTextLineHeight, IRTextParagraph, IRTextVisualLine } from '../ir/types';
import { paragraphBoundarySpaceAfterPx, paragraphSpaceAfterPx } from './text-layout';

/** Stable key for comparing paragraph line-height values. */
export function paragraphLineHeightKey(
  lineHeight: IRTextLineHeight | null | undefined
): string {
  if (!lineHeight) return 'null';
  if (lineHeight.unit === 'AUTO') return 'AUTO';
  return `${lineHeight.unit}:${lineHeight.value}`;
}

/**
 * Resolve Paragraph IR for OOXML injection.
 * Prefer Reader-built `text.paragraphs`. When missing, synthesize one logical
 * paragraph per `\n`-separated range (same split as `buildTextParagraphs`) so
 * soft-break merge and per-`<a:p>` lnSpc still apply — never one blob that
 * only styles the first pptxgenjs paragraph.
 */
export function resolveTextParagraphs(text: IRText): IRTextParagraph[] {
  if (text.paragraphs && text.paragraphs.length > 0) return text.paragraphs;

  const unit = text.lineHeightUnit ?? (text.lineHeight === null ? 'AUTO' : 'PIXELS');
  const lineHeight: IRTextLineHeight =
    unit === 'PIXELS' && text.lineHeight !== null
      ? { unit: 'PIXELS', value: text.lineHeight }
      : unit === 'PERCENT'
        ? {
            unit: 'PERCENT',
            value:
              text.lineHeightPercent ??
              (text.lineHeight !== null && text.fontSize > 0
                ? (text.lineHeight / text.fontSize) * 100
                : 100),
          }
        : { unit: 'AUTO' };

  const template = {
    lineHeight,
    mixedLineHeight: unit === 'MIXED',
    paragraphSpacing: text.paragraphSpacing ?? 0,
    paragraphSpaceBefore: 0 as number | null,
    paragraphIndent: text.paragraphIndent ?? 0,
    textAlignHorizontal: text.textAlignHorizontal,
  };

  const ranges: { start: number; end: number }[] = [];
  let start = 0;
  const source = text.characters ?? '';
  for (let i = 0; i <= source.length; i += 1) {
    if (i === source.length || source[i] === '\n') {
      ranges.push({ start, end: i });
      start = i + 1;
    }
  }
  if (ranges.length === 0) {
    ranges.push({ start: 0, end: 0 });
  }

  const boundaries = text.boundaries;
  return ranges.map((range, rangeIndex) => {
    const isLast = rangeIndex === ranges.length - 1;
    const breakAfter = isLast
      ? undefined
      : boundaries?.find((b) => b.index === range.end)?.kind ?? 'paragraphBreak';
    return { ...range, ...template, breakAfter };
  });
}

function listTypeOf(paragraph: IRTextParagraph): string {
  return paragraph.listType ?? 'NONE';
}

/**
 * True when the break after `previous` should become DrawingML `<a:br/>`
 * inside one `<a:p>` (R-TXT-21 / R-TXT-27).
 *
 * - `breakAfter: softBreak` (U+2028 / baked visual wrap) → soft-join when
 *   line-height keys match, alignment matches, non-list (blank rows allowed).
 * - `breakAfter: paragraphBreak` / unset → join only when metrics match and
 *   paragraphSpacing is explicitly 0 (legacy Enter-as-line heuristic).
 * - `paragraphSpacing === null` (mixed/unknown) or missing lineHeight → never
 *   soft-join (would flatten mixed quote stacks onto the first lnSpc).
 */
export function canJoinAsSoftBreak(
  previous: IRTextParagraph,
  next: IRTextParagraph
): boolean {
  if (previous.breakAfter !== 'softBreak') return false;
  if (previous.mixedLineHeight || next.mixedLineHeight) return false;
  if (listTypeOf(previous) !== 'NONE' || listTypeOf(next) !== 'NONE') return false;
  if (!previous.lineHeight || !next.lineHeight) return false;
  if (
    paragraphLineHeightKey(previous.lineHeight) !==
    paragraphLineHeightKey(next.lineHeight)
  ) {
    return false;
  }
  const prevAlign = previous.textAlignHorizontal ?? 'LEFT';
  const nextAlign = next.textAlignHorizontal ?? 'LEFT';
  if (prevAlign !== nextAlign) return false;

  // U+2028 / baked visual soft breaks: keep blank rows (empty ranges) inside
  // the same <a:p> via <a:br/> — do not reject start>=end here.
  if (previous.breakAfter === 'softBreak') {
    return true;
  }

  if (previous.start >= previous.end || next.start >= next.end) return false;
  // null = mixed/unknown from Reader — keep separate <a:p>.
  if (previous.paragraphSpacing === null) return false;
  if ((previous.paragraphSpacing ?? 0) > 0) return false;
  return true;
}

/** Groups of paragraph indices that share one OOXML paragraph via soft breaks. */
export function softBreakGroups(paragraphs: readonly IRTextParagraph[]): number[][] {
  if (paragraphs.length === 0) return [];
  const groups: number[][] = [[0]];
  for (let i = 1; i < paragraphs.length; i += 1) {
    const current = groups[groups.length - 1];
    const prev = paragraphs[current[current.length - 1]];
    if (canJoinAsSoftBreak(prev, paragraphs[i])) current.push(i);
    else groups.push([i]);
  }
  return groups;
}

/**
 * One IR paragraph record per soft-break group for OOXML metric injection.
 * Line metrics come from the first member; space-after is Figma paragraph/
 * list spacing (plus SVG residual beyond next LH when groups stay separate).
 */
export function collapsedParagraphMetrics(
  paragraphs: readonly IRTextParagraph[],
  visualLines?: readonly IRTextVisualLine[]
): IRTextParagraph[] {
  const groups = softBreakGroups(paragraphs);
  const linesMatch =
    visualLines !== undefined &&
    visualLines.length === paragraphs.length &&
    visualLines.length > 0;

  return groups.map((group, groupIndex) => {
    const first = paragraphs[group[0]];
    const last = paragraphs[group[group.length - 1]];
    const nextGroup = groups[groupIndex + 1];
    const next = nextGroup ? paragraphs[nextGroup[0]] : undefined;

    let visualGap: number | undefined;
    if (linesMatch && nextGroup) {
      const prevLine = visualLines![group[group.length - 1]];
      const nextLine = visualLines![nextGroup[0]];
      if (prevLine && nextLine) {
        visualGap = nextLine.baselineY - prevLine.baselineY;
      }
    }

    const spaceAfter =
      next !== undefined
        ? paragraphBoundarySpaceAfterPx(last, next, visualGap)
        : paragraphSpaceAfterPx(last);

    return {
      ...first,
      end: last.end,
      paragraphSpacing: spaceAfter,
      paragraphSpaceBefore: first.paragraphSpaceBefore,
    };
  });
}

/**
 * Metrics aligned 1:1 with emitted `<a:p>` count.
 *
 * When soft-break merge applied, use collapsed group metrics. When merge was
 * skipped or failed, inject **per logical paragraph** so later rows keep their
 * own `lnSpc` / `spcAft` (never leave them on PPT defaults).
 */
export function paragraphMetricsForInjection(
  paragraphs: readonly IRTextParagraph[],
  visualLines: readonly IRTextVisualLine[] | undefined,
  collapsed: boolean
): IRTextParagraph[] {
  if (collapsed) {
    return collapsedParagraphMetrics(paragraphs, visualLines);
  }
  const linesMatch =
    visualLines !== undefined &&
    visualLines.length === paragraphs.length &&
    visualLines.length > 0;

  return paragraphs.map((paragraph, index) => {
    const next = paragraphs[index + 1];
    let visualGap: number | undefined;
    if (linesMatch && next) {
      visualGap = visualLines![index + 1].baselineY - visualLines![index].baselineY;
    }
    const spaceAfter =
      next !== undefined
        ? paragraphBoundarySpaceAfterPx(paragraph, next, visualGap)
        : paragraphSpaceAfterPx(paragraph);
    return {
      ...paragraph,
      paragraphSpacing: spaceAfter,
    };
  });
}
