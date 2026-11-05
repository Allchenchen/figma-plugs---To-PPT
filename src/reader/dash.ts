/**
 * Figma `dashPattern` → PowerPoint dash type (FigDeck-compatible heuristic).
 * Even indices = dash length, odd = gap. Empty / missing → solid.
 * Very short first dash (≤2px) → sysDot; otherwise → dash.
 */
export type DashStyle = 'solid' | 'dash' | 'dot';

export function dashStyleFromPattern(pattern: readonly number[] | null | undefined): DashStyle {
  if (!pattern || pattern.length === 0) return 'solid';
  if (pattern[0] <= 2) return 'dot';
  return 'dash';
}

/** Map to pptxgenjs `line.dashType`. */
export function pptxDashType(style: DashStyle): 'solid' | 'dash' | 'sysDot' {
  if (style === 'dot') return 'sysDot';
  if (style === 'dash') return 'dash';
  return 'solid';
}
