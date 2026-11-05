/** PowerPoint custom page: 1920 × 1080 pt (16:9), not the default 13.333×7.5in. */
export const PPT_WIDTH_PT = 1920;
export const PPT_HEIGHT_PT = 1080;
export const PT_PER_INCH = 72;
export const EMU_PER_INCH = 914400;
/** 1 pt = 12700 EMU. */
export const EMU_PER_PT = EMU_PER_INCH / PT_PER_INCH;

/** Exact inches — do not round2 (page physical size must stay accurate). */
export const PPT_WIDTH_IN = PPT_WIDTH_PT / PT_PER_INCH;
export const PPT_HEIGHT_IN = PPT_HEIGHT_PT / PT_PER_INCH;

/**
 * Final design-value precision (pt / design numbers).
 * Do not use on intermediate matrix math or on page inches.
 */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Design pt → inches for pptxgenjs.
 * Round the **pt** value to 2 decimals, then divide by 72 at full precision.
 */
export function ptToInch(pt: number): number {
  return round2(pt) / PT_PER_INCH;
}

/** @deprecated Use ptToInch — slide space is pt under the 1920×1080 mapping. */
export function pxToInch(px: number): number {
  return ptToInch(px);
}

/**
 * @deprecated Geometric 96dpi helper. Prefer page-scale 1:1 px→pt mapping.
 * Kept for stroke fallbacks / legacy tests only.
 */
export const PX_PER_INCH = 96;

/** @deprecated Prefer mapTypographyPt / 1:1 page mapping. */
export function pxToPt(px: number): number {
  return px * (PT_PER_INCH / PX_PER_INCH);
}
