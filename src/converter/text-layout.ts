/**
 * Text Layout Normalizer
 *
 * Page scale for **emitted** fonts/geometry: `scaleElement` in createPptx.
 * Page scale for **paragraph OOXML metrics** (lnSpc / spcAft / indent): once in
 * postprocess from unscaled Frame-space IR — do not apply scale here.
 * Typography is always 1:1 after page scale (no UI percent fine-tune).
 *
 * Line-height rules:
 * - PERCENT and PIXELS → Exact pt / spcPts (percent = fontSize × percent)
 * - AUTO → omit explicit spacing
 */

import { mapTypographyPt } from './page-scale';

export const TEXT_OBJECT_PREFIX = 'F2P_TXT_';

/**
 * Figma size (already page-scaled in IR when needed) → PPT pt.
 * Page scale must not be applied again here.
 */
export function typographyPt(figmaPx: number): number {
  return mapTypographyPt(figmaPx, 1);
}

/** OOXML spcPts / sz use hundredths of a point (from round2 pt). */
export function typographyCentipoints(figmaPx: number): number {
  return Math.round(typographyPt(figmaPx) * 100);
}

export type LineHeightUnit = 'AUTO' | 'MIXED' | 'PERCENT' | 'PIXELS';

/** Figma lineHeight before collapsing to px (Reader feeds this into IR). */
export type FigmaLineHeightInput =
  | { unit: 'AUTO' }
  | { unit: 'PERCENT'; value: number }
  | { unit: 'PIXELS'; value: number };

export interface LineHeightIR {
  /** Absolute px for geometry / legacy; null when AUTO. */
  px: number | null;
  unit: LineHeightUnit;
  /** Present when unit === 'PERCENT' (e.g. 150 for 150%). */
  percent?: number;
}

/** Resolve Figma lineHeight → IR fields (px + preserved unit). */
export function normalizeLineHeight(
  input: FigmaLineHeightInput | null | undefined,
  fontSizePx: number
): LineHeightIR {
  if (!input || input.unit === 'AUTO') {
    return { px: null, unit: 'AUTO' };
  }
  if (input.unit === 'PERCENT') {
    const percent = input.value;
    return {
      px: (fontSizePx * percent) / 100,
      unit: 'PERCENT',
      percent,
    };
  }
  return { px: input.value, unit: 'PIXELS' };
}

export interface PptLineSpacing {
  lineSpacing?: number;
  lineSpacingMultiple?: number;
}

/**
 * Exact points for both fixed pixels and percent (fontSize × percent).
 * Percent is not written as PowerPoint multiple line spacing.
 */
export function pptLineSpacing(lh: LineHeightIR | null | undefined): PptLineSpacing {
  if (!lh || lh.unit === 'AUTO' || lh.unit === 'MIXED') {
    return {};
  }
  if (lh.px !== null && lh.px > 0) {
    return { lineSpacing: typographyPt(lh.px) };
  }
  return {};
}

/** Figma paragraphSpacing → PPT paraSpaceAfter pt. */
export function pptParaSpaceAfter(
  paragraphSpacingPx: number | null | undefined
): number | undefined {
  if (paragraphSpacingPx === null || paragraphSpacingPx === undefined) return undefined;
  if (paragraphSpacingPx <= 0) return undefined;
  return typographyPt(paragraphSpacingPx);
}

/** Figma fontSize number → PPT fontSize pt (1:1 after page scale). */
export function pptFontSize(fontSizePx: number): number {
  return typographyPt(fontSizePx);
}

/** Letter-spacing → PPT charSpacing pt. */
export function pptCharSpacing(letterSpacingPx: number): number {
  return typographyPt(letterSpacingPx);
}

/**
 * Zero internal text-box margins. PptxGenJS unset → PowerPoint "Normal"
 * margins (~0.05–0.1"), which shifts glyphs vs Figma's zero-inset frames.
 *
 * Runtime tuple order is `[left, right, bottom, top]` in **points**
 * (pptxgenjs maps index 0→lIns, 1→rIns, 2→bIns, 3→tIns via pt→EMU).
 */
export function pptTextMargin(
  topPt = 0,
  rightPt = 0,
  bottomPt = 0,
  leftPt = 0
): [number, number, number, number] {
  return [leftPt, rightPt, bottomPt, topPt];
}

/** PowerPoint only has bold on/off; ≥600 → bold. */
export function pptBold(fontWeight: number): boolean {
  return fontWeight >= 600;
}

/**
 * Preserve the design font name. Font availability belongs in diagnostics,
 * not in conversion: silently replacing Inter with Arial changes glyph
 * metrics, wrapping and weight before PowerPoint even opens the file.
 */
export function mapFontFace(family: string): string {
  return family.trim() || 'Arial';
}

/**
 * zh-CN lang hint for CJK faces (helps PPT pick ea glyph runs).
 * Match by exact name or common family substrings — never remap the typeface.
 */
export function pptLangForFace(fontFace: string): { lang?: string; altLang?: string } {
  const exact = new Set([
    'Microsoft YaHei',
    'SimSun',
    'SimHei',
    'Microsoft JhengHei',
    'KaiTi',
    'FangSong',
    'DengXian',
    'PingFang SC',
    'PingFang TC',
    'PingFang HK',
    'Hiragino Sans GB',
    'Hiragino Sans',
    'Songti SC',
    'Heiti SC',
    'STHeiti',
    'STSong',
    'Source Han Sans SC',
    'Source Han Sans CN',
    'Noto Sans CJK SC',
    'Noto Sans SC',
    'WenQuanYi Micro Hei',
  ]);
  if (exact.has(fontFace)) return { lang: 'zh-CN', altLang: 'en-US' };
  const lower = fontFace.toLowerCase();
  if (
    /pingfang|hiragino|yahei|simsun|simhei|kaiti|fangsong|dengxian|songti|heiti|stheit|stsong|source han|noto sans cjk|noto sans sc|wenquanyi|微软雅黑|宋体|黑体|楷体|仿宋/.test(
      lower
    )
  ) {
    return { lang: 'zh-CN', altLang: 'en-US' };
  }
  return {};
}

/** Effective paragraph space-after: explicit paragraphSpacing, else listSpacing for lists. */
export function paragraphSpaceAfterPx(paragraph: {
  paragraphSpacing?: number | null;
  listType?: 'ORDERED' | 'UNORDERED' | 'NONE';
  listSpacing?: number | null;
}): number {
  const spacing = paragraph.paragraphSpacing ?? 0;
  if (spacing > 0) return spacing;
  const listType = paragraph.listType ?? 'NONE';
  if (listType === 'NONE') return 0;
  const listSpacing = paragraph.listSpacing ?? 0;
  return listSpacing > 0 ? listSpacing : 0;
}

/**
 * Space after a soft-break *group* before the next group (separate `<a:p>`).
 *
 * Same-metric soft-joined rows: gap comes from Exact/Multiple `lnSpc` only.
 *
 * Separate `<a:p>` each already carry their own `lnSpc`. Folding next PIXELS
 * line height (or the full SVG baseline delta) into `spcAft` double-counts
 * against that Exact line box and stretches quote stacks past the box bottom
 * (R-TXT-26). Inter-item distance must be Figma's **paragraphSpacing only**.
 *
 * Rules:
 * - No next group → Figma paragraph/list spacing only.
 * Measured line gaps are Exact `lnSpc` on each paragraph, not extra
 * space-after. Space-after stays the explicit Figma paragraph or list spacing.
 */
export function paragraphBoundarySpaceAfterPx(
  previous: {
    paragraphSpacing?: number | null;
    listType?: 'ORDERED' | 'UNORDERED' | 'NONE';
    listSpacing?: number | null;
    lineHeight?: { unit: string; value?: number } | null;
  },
  next:
    | {
        lineHeight?: { unit: string; value?: number } | null;
      }
    | undefined,
  visualBaselineGapPx?: number
): number {
  void next;
  void visualBaselineGapPx;
  return paragraphSpaceAfterPx(previous);
}
