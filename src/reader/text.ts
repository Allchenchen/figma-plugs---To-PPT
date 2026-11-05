export type LetterSpacingResolved = { unit: 'PERCENT' | 'PIXELS'; value: number };
/** null = AUTO */
export type LineHeightResolved = { unit: 'PERCENT' | 'PIXELS'; value: number } | null;

/** Figma letterSpacing → absolute px. */
export function letterSpacingPx(
  ls: LetterSpacingResolved,
  fontSize: number
): number {
  return ls.unit === 'PERCENT' ? (fontSize * ls.value) / 100 : ls.value;
}

/** Figma lineHeight → absolute px; null for AUTO. */
export function lineHeightPx(
  lh: LineHeightResolved,
  fontSize: number
): number | null {
  if (lh === null) return null;
  return lh.unit === 'PERCENT' ? (fontSize * lh.value) / 100 : lh.value;
}

/** Map a Figma font style name ("Bold", "Medium", …) to a CSS weight. */
export function styleToWeight(style: string): number {
  const s = style.toLowerCase();
  if (s.includes('thin')) return 100;
  if (s.includes('extralight') || s.includes('extra light')) return 200;
  if (s.includes('light')) return 300;
  if (s.includes('medium')) return 500;
  if (s.includes('semibold') || s.includes('semi bold')) return 600;
  if (s.includes('bold')) return 700;
  if (s.includes('heavy') || s.includes('black')) return 900;
  return 400;
}
