/**
 * Text vertical layout policy (R-TXT-19 / R-TXT-22)
 *
 * Layers (do not confuse them):
 * 1. TextBox geometry — Figma measured rect; never nudge Y/H.
 * 2. bodyPr anchor — only from Figma textAlignVertical (t/ctr/b).
 * 3. bodyPr insets — always zero; never invent tIns from line metrics.
 * 4. bodyPr autofit — always noAutofit (Figma already measured the box).
 * 5. Paragraph lnSpc — PIXELS→spcPts, PERCENT→spcPct; soft-break merge so
 *    Exact/Multiple applies between visual rows inside one `<a:p>`.
 * 6. Font line box / baseline — engine difference (Figma half-leading vs PPT
 *    Exact); leadingTrim=CAP_HEIGHT has no DrawingML equivalent.
 *
 * Historical `textVerticalCorrection()` (renderBounds / lineHeight−fontSize
 * frame nudges) is intentionally removed — it conflicted with paragraph
 * soft-break + lnSpc and shifted unrelated layouts. Do not reintroduce it.
 */

import type { IRText } from '../ir/types';

/** Machine-checkable policy: geometry vs alignment vs line metrics stay separate. */
export const TEXT_VERTICAL_POLICY = {
  /** Never offset TextBox y/height to fake glyph position. */
  allowGeometryNudge: false,
  /** Never invent tIns/bIns from lineHeight − fontSize. */
  allowInsetFromLineMetrics: false,
  /** Never force every box to CENTER. */
  forceCenterAlign: false,
  /** Soft-break + lnSpc handle row packing; not verticalCorrection. */
  rowSpacingViaSoftBreakLnSpc: true,
} as const;

export type BodyPrAnchor = 't' | 'ctr' | 'b';

/** Figma textAlignVertical → DrawingML bodyPr/@anchor (and pptxgenjs valign). */
export function bodyPrAnchorFromFigma(
  align: IRText['textAlignVertical'] | undefined
): BodyPrAnchor {
  if (align === 'CENTER') return 'ctr';
  if (align === 'BOTTOM') return 'b';
  return 't';
}

export function pptxValignFromFigma(
  align: IRText['textAlignVertical'] | undefined
): 'top' | 'middle' | 'bottom' {
  const anchor = bodyPrAnchorFromFigma(align);
  if (anchor === 'ctr') return 'middle';
  if (anchor === 'b') return 'bottom';
  return 'top';
}

/**
 * Guard used by converters/tests: TextBox options must not smuggle vertical
 * "corrections" that fight paragraph metrics.
 */
export function assertTextBoxVerticalPolicy(opts: {
  y: number;
  h: number;
  sourceY: number;
  sourceH: number;
  margin?: unknown;
  valign?: unknown;
  textAlignVertical?: IRText['textAlignVertical'];
}): void {
  if (TEXT_VERTICAL_POLICY.allowGeometryNudge) return;
  if (opts.y !== opts.sourceY || opts.h !== opts.sourceH) {
    throw new Error('TextBox geometry must equal Figma measured rect (no verticalCorrection)');
  }
  if (Array.isArray(opts.margin)) {
    const [left, right, bottom, top] = opts.margin as number[];
    if (left !== 0 || right !== 0 || bottom !== 0 || top !== 0) {
      throw new Error('Text box insets must stay 0');
    }
  }
  if (
    opts.textAlignVertical !== undefined &&
    opts.valign !== undefined &&
    opts.valign !== pptxValignFromFigma(opts.textAlignVertical)
  ) {
    throw new Error('valign must map from Figma textAlignVertical');
  }
}
