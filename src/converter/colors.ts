/** `#RRGGBB` → `RRGGBB` (pptxgenjs color format). */
export function stripHash(hex: string): string {
  return hex.replace(/^#/, '').toUpperCase();
}

/** Opacity 0..1 → pptxgenjs transparency percent (0..100). */
export function opacityToTransparency(opacity: number): number {
  return Math.round(Math.min(1, Math.max(0, 1 - opacity)) * 100);
}

function parseHexChannels(hex: string): { r: number; g: number; b: number } {
  const h = stripHash(hex).padEnd(6, '0').slice(0, 6);
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

function channelToHex(v: number): string {
  return Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
}

/**
 * Composite a foreground color over a slide background at the given opacity.
 *
 * Used for **shape fills** (hosts that composite shape transparency against
 * white). Text glyphs keep source RGB and use `<a:alpha>` via
 * `opacityToTransparency` instead — do not bake text white→grey here.
 */
export function compositeColorOverBackground(
  foregroundHex: string,
  opacity: number,
  backgroundHex: string
): string {
  const o = Math.min(1, Math.max(0, opacity));
  if (o >= 1 - 1e-9) return `#${stripHash(foregroundHex)}`;
  const fg = parseHexChannels(foregroundHex);
  const bg = parseHexChannels(backgroundHex);
  return `#${channelToHex(fg.r * o + bg.r * (1 - o))}${channelToHex(fg.g * o + bg.g * (1 - o))}${channelToHex(fg.b * o + bg.b * (1 - o))}`;
}
