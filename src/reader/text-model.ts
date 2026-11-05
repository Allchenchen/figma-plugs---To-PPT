import type {
  ExportStrategy,
  IRTextBoundary,
  IRTextLineHeight,
  IRTextParagraph,
  IRTextRun,
  IRTextVisualLine,
} from '../ir/types';

export interface VisualLineParseResult {
  status: 'exact' | 'unavailable' | 'mismatch';
  lines: IRTextVisualLine[];
  viewBox?: { x: number; y: number; width: number; height: number };
  reason?: string;
}

interface MixedLineHeightText {
  characters?: string;
  rect?: { x?: number; y?: number; width: number; height: number };
  paragraphs?: IRTextParagraph[];
  visualLines?: IRTextVisualLine[];
  visualLineStatus?: 'exact' | 'unavailable' | 'mismatch';
  visualLineReason?: string;
}

export type MixedLineHeightRenderDecision =
  | { kind: 'native'; reason?: string }
  | { kind: 'split' }
  | { kind: 'image'; reason: string };

/** Reader-only segment: character style plus source paragraph metadata. */
export interface TextSegmentInput extends IRTextRun {
  lineHeight: IRTextLineHeight;
  paragraphSpacing: number;
  paragraphIndent: number;
  listType?: 'ORDERED' | 'UNORDERED' | 'NONE';
  listSpacing?: number;
  indentation?: number;
  leadingTrim?: 'CAP_HEIGHT' | 'NONE';
}

export function canSplitTextVisualLines(text: MixedLineHeightText): boolean {
  const lines = text.visualLines;
  if (
    text.visualLineStatus !== 'exact' ||
    !text.characters ||
    !text.rect ||
    !lines ||
    lines.length < 2
  ) {
    return false;
  }
  if (
    lines.map((line) => line.text).join('') !==
    normalizeFigmaNewlines(text.characters).replace(/\n/g, '')
  ) {
    return false;
  }
  const first = lines[0].baselineY;
  const offsets = lines.map((line) => line.baselineY - first);
  return offsets.every(
    (offset, index) =>
      offset >= 0 &&
      offset < text.rect!.height &&
      (index === 0 || offset > offsets[index - 1])
  );
}

export function decideMixedLineHeightRender(
  text: MixedLineHeightText,
  strategy: ExportStrategy
): MixedLineHeightRenderDecision {
  const mixed = text.paragraphs?.some((paragraph) => paragraph.mixedLineHeight) === true;
  if (!mixed) return { kind: 'native' };
  if (canSplitTextVisualLines(text)) return { kind: 'split' };
  if (text.visualLineStatus === 'exact' && text.visualLines?.length === 1) {
    return { kind: 'native' };
  }
  const detail = text.visualLineReason ?? 'visual line metadata unavailable';
  return strategy === 'fidelity'
    ? { kind: 'image', reason: `mixed line-height local PNG: ${detail}` }
    : { kind: 'native', reason: `mixed line-height kept editable: ${detail}` };
}

function lineHeightKey(value: IRTextLineHeight | undefined): string {
  if (!value) return 'missing';
  return value.unit === 'AUTO' ? 'AUTO' : `${value.unit}:${value.value}`;
}

function runsWithRanges<T extends IRTextRun>(runs: T[]): (T & { start: number; end: number })[] {
  let cursor = 0;
  return runs.map((run) => {
    const start = run.start ?? cursor;
    const end = run.end ?? start + run.text.length;
    cursor = end;
    return { ...run, start, end };
  });
}

function oneValue(values: number[]): number | null {
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : null;
}

function oneString<T extends string>(values: T[]): T | undefined {
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : undefined;
}

/** Escape break / control chars so logs never show blank for newlines (R-TXT-27). */
export function formatCharactersForLog(text: string): string {
  return text
    .replace(/\r\n/g, '\\r\\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Normalize Figma breaks to LF while recording explicit boundaries.
 * U+2028 → softBreak; `\n` / `\r` / `\r\n` / U+2029 → paragraphBreak.
 * Indexes in `boundaries` refer to the normalized `characters` string.
 */
export function normalizeTextWithBoundaries(raw: string): {
  characters: string;
  boundaries: IRTextBoundary[];
} {
  let characters = '';
  const boundaries: IRTextBoundary[] = [];
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '\r' && raw[i + 1] === '\n') {
      boundaries.push({
        index: characters.length,
        sourceIndex: i,
        sourceLength: 2,
        kind: 'paragraphBreak',
        sourceCharacter: '\\r\\n',
      });
      characters += '\n';
      i += 2;
      continue;
    }
    if (ch === '\n') {
      boundaries.push({
        index: characters.length,
        sourceIndex: i,
        sourceLength: 1,
        kind: 'paragraphBreak',
        sourceCharacter: '\\n',
      });
      characters += '\n';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      boundaries.push({
        index: characters.length,
        sourceIndex: i,
        sourceLength: 1,
        kind: 'paragraphBreak',
        sourceCharacter: '\\r',
      });
      characters += '\n';
      i += 1;
      continue;
    }
    if (ch === '\u2028') {
      boundaries.push({
        index: characters.length,
        sourceIndex: i,
        sourceLength: 1,
        kind: 'softBreak',
        sourceCharacter: '\\u2028',
      });
      characters += '\n';
      i += 1;
      continue;
    }
    if (ch === '\u2029') {
      boundaries.push({
        index: characters.length,
        sourceIndex: i,
        sourceLength: 1,
        kind: 'paragraphBreak',
        sourceCharacter: '\\u2029',
      });
      characters += '\n';
      i += 1;
      continue;
    }
    characters += ch;
    i += 1;
  }
  return { characters, boundaries };
}

/**
 * Figma soft/paragraph separators → LF.
 * Prefer `normalizeTextWithBoundaries` when kind/index must be preserved.
 */
export function normalizeFigmaNewlines(text: string): string {
  return normalizeTextWithBoundaries(text).characters;
}

/** Paragraph index counts Enter only. U+2028 stored as `\n` does not increment it. */
export function paragraphIndexAt(
  boundaries: readonly IRTextBoundary[] | undefined,
  offset: number
): number {
  if (!boundaries) return -1;
  let count = 0;
  for (const boundary of boundaries) {
    if (boundary.kind === 'paragraphBreak' && boundary.index < offset) count += 1;
  }
  return count;
}

function paragraphIndexFor(
  normalized: string,
  offset: number,
  boundaries?: readonly IRTextBoundary[]
): number {
  if (boundaries && boundaries.length > 0) return paragraphIndexAt(boundaries, offset);
  return normalized.slice(0, offset).split('\n').length - 1;
}

function boundaryKindAt(
  boundaries: readonly IRTextBoundary[] | undefined,
  newlineIndex: number
): IRTextParagraph['breakAfter'] {
  if (!boundaries || boundaries.length === 0) return undefined;
  return boundaries.find((b) => b.index === newlineIndex)?.kind;
}

/** Build logical paragraphs while preserving Figma's UTF-16 character offsets. */
export function buildTextParagraphs(
  source: string,
  runs: TextSegmentInput[],
  textAlignHorizontal: IRTextParagraph['textAlignHorizontal'] = 'LEFT',
  boundaries?: readonly IRTextBoundary[]
): IRTextParagraph[] {
  const extracted = boundaries
    ? { characters: normalizeFigmaNewlines(source), boundaries: [...boundaries] }
    : normalizeTextWithBoundaries(source);
  const normalized = extracted.characters;
  const breaks = extracted.boundaries;
  const ranged = runsWithRanges(
    runs.map((run) => ({
      ...run,
      text: normalizeFigmaNewlines(run.text),
    }))
  );
  const ranges: { start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i <= normalized.length; i += 1) {
    if (i === normalized.length || normalized[i] === '\n') {
      ranges.push({ start, end: i });
      start = i + 1;
    }
  }

  return ranges.map((range, rangeIndex) => {
    // Empty paragraphs inherit the segment touching their newline when possible.
    const overlaps = ranged.filter((run) =>
      range.start === range.end
        ? run.start <= range.start && run.end >= range.end
        : run.start < range.end && run.end > range.start
    );
    const keys = [...new Set(overlaps.map((run) => lineHeightKey(run.lineHeight)))];
    const lineHeight =
      keys.length === 1 && overlaps[0]?.lineHeight ? overlaps[0].lineHeight : null;
    const isLast = rangeIndex === ranges.length - 1;
    const breakAfter = isLast ? undefined : boundaryKindAt(breaks, range.end) ?? 'paragraphBreak';
    return {
      ...range,
      lineHeight,
      mixedLineHeight: keys.length > 1,
      paragraphSpacing: oneValue(
        overlaps
          .map((run) => run.paragraphSpacing)
          .filter((value): value is number => value !== undefined)
      ),
      paragraphIndent: oneValue(
        overlaps
          .map((run) => run.paragraphIndent)
          .filter((value): value is number => value !== undefined)
      ),
      paragraphSpaceBefore: 0,
      textAlignHorizontal,
      listType: oneString(
        overlaps
          .map((run) => run.listType)
          .filter((value): value is NonNullable<TextSegmentInput['listType']> => value !== undefined)
      ),
      listSpacing: oneValue(
        overlaps
          .map((run) => run.listSpacing)
          .filter((value): value is number => value !== undefined)
      ),
      indentation: oneValue(
        overlaps
          .map((run) => run.indentation)
          .filter((value): value is number => value !== undefined)
      ),
      leadingTrim: oneString(
        overlaps
          .map((run) => run.leadingTrim)
          .filter(
            (value): value is NonNullable<TextSegmentInput['leadingTrim']> =>
              value !== undefined
          )
      ),
      breakAfter,
    };
  });
}

/** Remove paragraph-only metadata before persisting character-level TextRun IR. */
export function textRunsFromSegments(segments: TextSegmentInput[]): IRTextRun[] {
  return segments.map(
    ({
      lineHeight: _lineHeight,
      paragraphSpacing: _paragraphSpacing,
      paragraphIndent: _paragraphIndent,
      listType: _listType,
      listSpacing: _listSpacing,
      indentation: _indentation,
      leadingTrim: _leadingTrim,
      ...run
    }) => run
  );
}

/** Slice styled runs by UTF-16 offsets and rebase the returned ranges to zero. */
export function sliceTextRuns(runs: IRTextRun[], start: number, end: number): IRTextRun[] {
  return runsWithRanges(runs)
    .filter((run) => run.start < end && run.end > start)
    .map((run) => {
      const from = Math.max(start, run.start);
      const to = Math.min(end, run.end);
      return {
        ...run,
        start: from - start,
        end: to - start,
        text: run.text.slice(from - run.start, to - run.start),
      };
    })
    .filter((run) => run.text.length > 0);
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#([0-9]+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10))
    )
    .replace(/&nbsp;/g, '\u00A0')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function attrNumber(attributes: string, name: string): number | undefined {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}="([^"]+)"`));
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

interface SvgSpan {
  text: string;
  x: number;
  baselineY: number;
}

function svgSpans(svg: string): SvgSpan[] {
  const result: SvgSpan[] = [];
  const textBlocks = [...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)];
  for (const block of textBlocks) {
    const textX = attrNumber(block[1], 'x') ?? 0;
    const textY = attrNumber(block[1], 'y') ?? 0;
    let currentX = textX;
    let currentY = textY;
    const tspanMatches = [...block[2].matchAll(/<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/gi)];
    if (tspanMatches.length === 0) {
      const text = decodeXml(block[2].replace(/<[^>]*>/g, ''));
      if (text.length > 0) result.push({ text, x: textX, baselineY: textY });
      continue;
    }
    for (const match of tspanMatches) {
      const x = attrNumber(match[1], 'x');
      const y = attrNumber(match[1], 'y');
      const dx = attrNumber(match[1], 'dx') ?? 0;
      const dy = attrNumber(match[1], 'dy') ?? 0;
      if (x !== undefined) currentX = x;
      else currentX += dx;
      if (y !== undefined) currentY = y;
      else currentY += dy;
      const text = decodeXml(match[2].replace(/<[^>]*>/g, ''));
      if (text.length > 0) result.push({ text, x: currentX, baselineY: currentY });
    }
  }
  return result;
}

const SVG_EDGE_SPACE = /^[\s\u00A0\u200B]+|[\s\u00A0\u200B]+$/g;

function isIgnorableSourceGap(gap: string): boolean {
  for (let i = 0; i < gap.length; i += 1) {
    const ch = gap[i];
    if (ch !== '\n' && ch !== ' ' && ch !== '\t' && ch !== '\u00A0' && ch !== '\u200B') {
      return false;
    }
  }
  return true;
}

/**
 * Locate one SVG row inside `source` starting at `cursor`.
 *
 * Allows ignorable gaps (newlines / spaces) *before* the match. Also allows
 * newlines/spaces *inside* the source range while walking SVG glyphs — so when
 * SVG concatenates two Figma paragraphs onto one baseline (`涹齢”“弨慥螎`), the
 * returned `[start,end)` still spans the source `\n` and
 * `splitVisualLinesAtSourceBreaks` can restore the real row boundary.
 */
export function locateSvgRowInSource(
  source: string,
  cursor: number,
  svgText: string
): { start: number; end: number; text: string } | null {
  const candidates = [svgText];
  const trimmed = svgText.replace(SVG_EDGE_SPACE, '');
  if (trimmed.length > 0 && trimmed !== svgText) candidates.push(trimmed);

  for (const candidate of candidates) {
    // Fast path: exact contiguous match after an ignorable gap.
    const found = source.indexOf(candidate, cursor);
    if (found !== -1) {
      const gap = source.slice(cursor, found);
      if (isIgnorableSourceGap(gap)) {
        return { start: found, end: found + candidate.length, text: candidate };
      }
    }

    // Slow path: walk source, skipping ignorable chars between SVG glyphs.
    let si = cursor;
    while (si < source.length && isIgnorableSourceGap(source[si]!)) si += 1;
    const start = si;
    let ti = 0;
    while (ti < candidate.length && si < source.length) {
      if (source[si] === candidate[ti]) {
        si += 1;
        ti += 1;
        continue;
      }
      if (isIgnorableSourceGap(source[si]!)) {
        si += 1;
        continue;
      }
      break;
    }
    if (ti === candidate.length) {
      return { start, end: si, text: candidate };
    }
  }
  return null;
}

/**
 * If a reconciled SVG row's source slice still contains `\n`, split into one
 * visual line per source row (same baseline until bake assigns soft/paragraph
 * breaks). Restores Enter boundaries that SVG flattened onto one tspan line.
 */
export function splitVisualLinesAtSourceBreaks(
  lines: readonly IRTextVisualLine[],
  source: string,
  boundaries?: readonly IRTextBoundary[]
): IRTextVisualLine[] {
  const normalized = normalizeFigmaNewlines(source);
  const out: IRTextVisualLine[] = [];
  for (const line of lines) {
    const content = normalized.slice(line.start, line.end);
    if (!content.includes('\n')) {
      out.push({ ...line, text: content.length > 0 ? content : line.text });
      continue;
    }
    let offset = 0;
    const parts = content.split('\n');
    // Figma draws this row's own U+2028 / Enter at the end of the tspan.
    // split() turns that terminator into a trailing empty part. That part is
    // not a blank row — a blank row is an empty part before the terminator
    // ("a\n\n" keeps the middle empty). Leaving the terminator in inserts a
    // second <a:br/> or an empty <a:p>, so the gap is one line taller than a
    // row whose break was not repeated (Insight body).
    if (content.endsWith('\n')) parts.pop();
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i]!;
      const start = line.start + offset;
      out.push({
        ...line,
        start,
        end: start + part.length,
        text: part,
        paragraphIndex: paragraphIndexFor(normalized, start, boundaries),
      });
      offset += part.length + (i < parts.length - 1 ? 1 : 0);
    }
  }
  return out;
}

/**
 * Recover visual lines from Figma's SVG text export. SVG is accepted only when
 * every emitted character reconciles with the TextNode source (ignoring
 * newlines/spaces that SVG omits).
 */
export function parseSvgVisualLines(
  svg: string,
  source: string,
  boundaries?: readonly IRTextBoundary[]
): VisualLineParseResult {
  const normalizedSource = normalizeFigmaNewlines(source);
  const viewBoxValues = svg
    .match(/<svg\b[^>]*\bviewBox="([^"]+)"/i)?.[1]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const viewBox =
    viewBoxValues?.length === 4 && viewBoxValues.every(Number.isFinite)
      ? {
          x: viewBoxValues[0],
          y: viewBoxValues[1],
          width: viewBoxValues[2],
          height: viewBoxValues[3],
        }
      : undefined;
  const spans = svgSpans(svg).map((span) => ({
    ...span,
    text: normalizeFigmaNewlines(span.text),
  }));
  if (spans.length === 0) {
    return {
      status: 'unavailable',
      lines: [],
      viewBox,
      reason: 'SVG contains no text spans',
    };
  }

  const groups: SvgSpan[][] = [];
  for (const span of spans) {
    const previous = groups[groups.length - 1];
    if (previous && Math.abs(previous[0]!.baselineY - span.baselineY) < 0.01) {
      previous.push(span);
    } else {
      groups.push([span]);
    }
  }

  let cursor = 0;
  const lines: IRTextVisualLine[] = [];
  for (const group of groups) {
    const svgText = group.map((span) => span.text).join('');
    if (svgText.length === 0) continue;
    const located = locateSvgRowInSource(normalizedSource, cursor, svgText);
    if (!located) {
      return {
        status: 'mismatch',
        lines: [],
        reason: `SVG/source text mismatch at UTF-16 offset ${cursor}`,
      };
    }
    cursor = located.end;
    lines.push({
      start: located.start,
      end: located.end,
      text: located.text,
      x: Math.min(...group.map((span) => span.x)),
      baselineY: group[0]!.baselineY,
      paragraphIndex: paragraphIndexFor(normalizedSource, located.start, boundaries),
    });
  }

  if (cursor !== normalizedSource.length) {
    const trailing = normalizedSource.slice(cursor);
    if (!isIgnorableSourceGap(trailing)) {
      return {
        status: 'mismatch',
        lines: [],
        reason: `SVG/source text mismatch at UTF-16 offset ${cursor}`,
      };
    }
  }

  const split = splitVisualLinesAtSourceBreaks(lines, normalizedSource, boundaries);
  for (let i = 0; i < split.length - 1; i += 1) {
    const gap = split[i + 1]!.baselineY - split[i]!.baselineY;
    if (gap > 0) split[i]!.lineHeightPx = gap;
  }

  return { status: 'exact', lines: split, viewBox };
}
