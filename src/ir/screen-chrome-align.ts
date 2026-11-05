/**
 * Align a rasterized screen-content image to sibling browser-chrome bars.
 *
 * Device mockups often decompose into:
 *   - a native IMAGE-fill chassis photo (has `sizing`)
 *   - solid rect chrome bars (address / tab strips)
 *   - a rasterized webpage (`exportAsync`, no `sizing`)
 *
 * When the raster's horizontal span is slightly inset from those chrome bars
 * while sharing the same vertical band, Figma still reads as one screen — the
 * chrome defines the glass width. Emitting the inset raster leaves a strip of
 * the chassis photo (baked screen edge / black recess) visible → edge gap.
 *
 * Expand the raster horizontally to the chrome union. Do not move the chassis.
 * Do not invent a fixed X offset; the chrome shapes on the same slide are the
 * geometric reference. Distinct images that merely share a media hash are
 * untouched.
 */

import type { IRElement, IRImage, IRShape, Rect } from './types';

const TOL_PX = 2;
/** Raster must already cover at least this fraction of chrome width. */
const MIN_COVERAGE = 0.9;
/**
 * Max inset of raster vs chrome on either side (pt). Larger overhangs (e.g.
 * slide7 ~110pt dark chrome past the page raster) are treated as intentional
 * side chrome, not the same glass — stretching the page into them distorts.
 */
const MAX_INSET_PX = 24;
/** Chrome bar height ≤ this fraction of the raster height. */
const MAX_CHROME_HEIGHT_FRAC = 0.12;

function nearlyEqual(a: number, b: number, tol = TOL_PX): boolean {
  return Math.abs(a - b) <= tol;
}

function isRasterScreen(el: IRElement): el is IRImage {
  return el.type === 'image' && !el.sizing;
}

function isDevicePhoto(el: IRElement): el is IRImage {
  return el.type === 'image' && el.sizing !== undefined;
}

function isChromeBar(el: IRElement): el is IRShape {
  if (el.type !== 'shape') return false;
  if (el.shapeKind !== 'rect') return false;
  if (!el.fill) return false;
  if (el.stroke) return false;
  if (el.rotation !== 0) return false;
  return true;
}

function overlapsHorizontally(a: Rect, b: Rect, tol = TOL_PX): boolean {
  return a.x < b.x + b.width + tol && b.x < a.x + a.width + tol;
}

function sitsOnTopBand(chrome: Rect, screen: Rect): boolean {
  if (chrome.height > screen.height * MAX_CHROME_HEIGHT_FRAC) return false;
  if (chrome.height <= 0 || screen.height <= 0) return false;
  // Top edge near screen top, fully above the lower 70% of the screen.
  if (!nearlyEqual(chrome.y, screen.y, 8) && chrome.y + chrome.height > screen.y + screen.height * 0.25) {
    return false;
  }
  return chrome.y >= screen.y - 8 && chrome.y <= screen.y + screen.height * 0.2;
}

function coversDevicePhoto(screen: Rect, photo: Rect): boolean {
  // Screen sits in the interior of the chassis photo.
  return (
    screen.x >= photo.x - MAX_INSET_PX &&
    screen.y >= photo.y - MAX_INSET_PX &&
    screen.x + screen.width <= photo.x + photo.width + MAX_INSET_PX &&
    screen.y + screen.height <= photo.y + photo.height + MAX_INSET_PX &&
    screen.width * screen.height > photo.width * photo.height * 0.15
  );
}

/**
 * Expand inset screen rasters horizontally to matching top chrome bars when
 * both sit on a device photo.
 */
export function alignScreenRasterToChrome(elements: readonly IRElement[]): IRElement[] {
  const photos = elements.filter(isDevicePhoto);
  const rasters = elements.filter(isRasterScreen);
  const chromes = elements.filter(isChromeBar);
  if (photos.length === 0 || rasters.length === 0 || chromes.length === 0) {
    return [...elements];
  }

  const expandFor = new Map<string, Rect>();

  for (const raster of rasters) {
    const photo = photos.find((p) => coversDevicePhoto(raster.rect, p.rect));
    if (!photo) continue;

    const bars = chromes.filter(
      (c) =>
        c.zIndex !== raster.zIndex &&
        sitsOnTopBand(c.rect, raster.rect) &&
        overlapsHorizontally(c.rect, raster.rect)
    );
    if (bars.length === 0) continue;

    const left = Math.min(...bars.map((b) => b.rect.x));
    const right = Math.max(...bars.map((b) => b.rect.x + b.rect.width));
    const chromeW = right - left;
    if (chromeW <= 0) continue;

    const coverage = raster.rect.width / chromeW;
    if (coverage < MIN_COVERAGE || coverage > 1.02) continue;

    const insetL = raster.rect.x - left;
    const insetR = right - (raster.rect.x + raster.rect.width);
    if (insetL < -TOL_PX || insetR < -TOL_PX) continue; // raster already wider
    if (insetL > MAX_INSET_PX || insetR > MAX_INSET_PX) continue;
    if (insetL <= TOL_PX && insetR <= TOL_PX) continue; // already aligned

    expandFor.set(raster.id, {
      x: left,
      y: raster.rect.y,
      width: chromeW,
      height: raster.rect.height,
    });
  }

  if (expandFor.size === 0) return [...elements];

  return elements.map((el) => {
    if (!isRasterScreen(el)) return el;
    const next = expandFor.get(el.id);
    if (!next) return el;
    return { ...el, rect: next };
  });
}
