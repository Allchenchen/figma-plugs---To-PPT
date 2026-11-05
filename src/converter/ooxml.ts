/**
 * Custom OOXML (DrawingML) string builders for geometry that PptxGenJS cannot
 * express through its public API. These run during post-processing and swap in
 * the correct markup for tiled image fills, mask geometry, and editable
 * freeform (`custGeom`) picture shapes.
 *
 * Coordinates are in slide **pt** after page mapping (1920×1080 pt system;
 * 1 pt = 12700 EMU). An optional `scale` factor is for residual local scaling.
 */

import type { SrcRect } from '../ir/types';
import { parseSvgPath, type PathCommand } from './polygon';
import { EMU_PER_PT } from './units';

/** @deprecated Prefer EMU_PER_PT — slide space is pt, not 96dpi px. */
export const EMU_PER_PX = EMU_PER_PT;

function emu(pt: number, scale: number): number {
  return Math.round(pt * scale * EMU_PER_PT);
}

/** `<a:srcRect>` crop edge fractions (already clamped to 0..100000). */
export function srcRectXml(r: SrcRect): string {
  return `<a:srcRect l="${r.l}" r="${r.r}" t="${r.t}" b="${r.b}"/>`;
}

/**
 * `<a:tile>` for Figma TILE fills. `sx`/`sy` scale the source image (100000 =
 * 100%), so a Figma `scalingFactor` maps directly. Anchored top-left with no
 * offset, matching Figma's repeat origin.
 */
export function tileXml(scaleX: number, scaleY: number): string {
  return `<a:tile algn="tl" flip="none" sx="${scaleX}" sy="${scaleY}" tx="0" ty="0"/>`;
}

// ---- custGeom generation ----

interface Pt {
  x: number;
  y: number;
}

function ptEmu(p: Pt, scale: number): string {
  return `<a:pt x="${emu(p.x, scale)}" y="${emu(p.y, scale)}"/>`;
}

function pathMoveTo(p: Pt, scale: number): string {
  return `<a:moveTo>${ptEmu(p, scale)}</a:moveTo>`;
}

function pathLnTo(p: Pt, scale: number): string {
  return `<a:lnTo>${ptEmu(p, scale)}</a:lnTo>`;
}

function pathQuad(c: { x1: number; y1: number; x: number; y: number }, scale: number): string {
  return `<a:quadBezTo><a:pt x="${emu(c.x1, scale)}" y="${emu(c.y1, scale)}"/>${ptEmu({ x: c.x, y: c.y }, scale)}</a:quadBezTo>`;
}

function pathCubic(
  c: { x1: number; y1: number; x2: number; y2: number; x: number; y: number },
  scale: number
): string {
  return (
    `<a:cubicBezTo>` +
    `<a:pt x="${emu(c.x1, scale)}" y="${emu(c.y1, scale)}"/>` +
    `<a:pt x="${emu(c.x2, scale)}" y="${emu(c.y2, scale)}"/>` +
    ptEmu({ x: c.x, y: c.y }, scale) +
    `</a:cubicBezTo>`
  );
}

/** Wrap path commands (px) into a `<a:custGeom>` whose path spans `wPx × hPx`. */
export function custGeomXml(commands: PathCommand[], wPx: number, hPx: number, scale = 1): string {
  const body: string[] = [];
  for (const c of commands) {
    switch (c.cmd) {
      case 'M':
        body.push(pathMoveTo(c, scale));
        break;
      case 'L':
        body.push(pathLnTo(c, scale));
        break;
      case 'Q':
        body.push(pathQuad(c, scale));
        break;
      case 'C':
        body.push(pathCubic(c, scale));
        break;
      case 'Z':
        body.push('<a:close/>');
        break;
    }
  }
  return (
    `<a:custGeom><a:avLst/><a:gdLst></a:gdLst><a:ahLst/><a:cxnLst></a:cxnLst>` +
    `<a:rect l="l" t="t" r="r" b="b"/><a:pathLst>` +
    `<a:path w="${emu(wPx, scale)}" h="${emu(hPx, scale)}">${body.join('')}</a:path>` +
    `</a:pathLst></a:custGeom>`
  );
}

/** custGeom for a Figma vector path `data` string (px). */
export function custGeomFromPathXml(data: string, wPx: number, hPx: number, scale = 1): string {
  return custGeomXml(parseSvgPath(data), wPx, hPx, scale);
}

/** custGeom for a closed polygon of straight vertices (px). */
export function custGeomFromVerticesXml(
  vertices: Pt[],
  wPx: number,
  hPx: number,
  scale = 1
): string {
  const commands: PathCommand[] = vertices.map((v, i) => ({
    cmd: (i === 0 ? 'M' : 'L') as 'M' | 'L',
    x: v.x,
    y: v.y,
  }));
  commands.push({ cmd: 'Z' });
  return custGeomXml(commands, wPx, hPx, scale);
}

/**
 * custGeom for a rounded rectangle with independent corner radii (px).
 * Mirrors `shapeRender`'s `roundedRectPoints` but emits DrawingML directly.
 */
export function roundRectCustGeomXml(
  wPx: number,
  hPx: number,
  tl: number,
  tr: number,
  br: number,
  bl: number,
  scale = 1
): string {
  const commands: PathCommand[] = [
    { cmd: 'M', x: tl, y: 0 },
    { cmd: 'L', x: wPx - tr, y: 0 },
    { cmd: 'Q', x1: wPx, y1: 0, x: wPx, y: tr },
    { cmd: 'L', x: wPx, y: hPx - br },
    { cmd: 'Q', x1: wPx, y1: hPx, x: wPx - br, y: hPx },
    { cmd: 'L', x: bl, y: hPx },
    { cmd: 'Q', x1: 0, y1: hPx, x: 0, y: hPx - bl },
    { cmd: 'L', x: 0, y: tl },
    { cmd: 'Q', x1: 0, y1: 0, x: tl, y: 0 },
    { cmd: 'Z' },
  ];
  return custGeomXml(commands, wPx, hPx, scale);
}

/** True when all four radii are equal (within exact float match after extract). */
export function cornersAreUniform(tl: number, tr: number, br: number, bl: number): boolean {
  return tl === tr && tr === br && br === bl;
}

/**
 * OOXML roundRect `adj` from a uniform corner radius.
 *
 * DrawingML guides use short-side units: `corner = ss * adj / 100000`.
 * Therefore `adj = clamp(r, 0, ss/2) / ss * 100000`.
 *
 * Do NOT use `2·r/ss·100000` (that treats adj as a fraction of *half* the
 * short side while still scaling by 100000 — doubles the visible radius).
 * Equivalently, half-side normalization must use 50000, not 100000.
 *
 * `wPx` / `hPx` / `radiusPx` must share one space; `scale` maps into slide pt.
 * Because adj is a pure ratio, page scale cancels and does not need a second
 * multiply beyond scaling both radius and sides together.
 */
export function roundRectAdj(radiusPx: number, wPx: number, hPx: number): number {
  const minSide = Math.min(wPx, hPx);
  if (minSide <= 0) return 0;
  const effective = Math.min(Math.max(0, radiusPx), minSide / 2);
  if (effective <= 0) return 0;
  return Math.round(Math.min(100000, Math.max(0, (effective / minSide) * 100000)));
}

/** Inverse of `roundRectAdj` (ignores clamp beyond ss/2). */
export function radiusFromRoundRectAdj(adj: number, wPx: number, hPx: number): number {
  const minSide = Math.min(wPx, hPx);
  if (minSide <= 0) return 0;
  return (minSide * Math.min(100000, Math.max(0, adj))) / 100000;
}

/**
 * Native `prstGeom roundRect` for a uniform corner radius.
 */
export function roundRectPrstGeomXml(
  radiusPx: number,
  wPx: number,
  hPx: number,
  scale = 1
): string {
  const w = wPx * scale;
  const h = hPx * scale;
  const r = Math.max(0, radiusPx * scale);
  const minSide = Math.min(w, h);
  if (minSide <= 0 || r <= 0) {
    return `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`;
  }
  const adj = roundRectAdj(r, w, h);
  if (adj <= 0) {
    return `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`;
  }
  return `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst></a:prstGeom>`;
}

/**
 * Geometry markup for an IRImage rounded clip. Uniform + unsmoothed → prstGeom;
 * independent radii or cornerSmoothing > 0 → custGeom (quadratic approx).
 */
export function imageCornerGeometryXml(
  wPx: number,
  hPx: number,
  tl: number,
  tr: number,
  br: number,
  bl: number,
  scale = 1,
  cornerSmoothing = 0
): string {
  if (cornersAreUniform(tl, tr, br, bl) && cornerSmoothing <= 1e-6) {
    return roundRectPrstGeomXml(tl, wPx, hPx, scale);
  }
  return roundRectCustGeomXml(wPx, hPx, tl, tr, br, bl, scale);
}

/** `<a:prstGeom prst="ellipse">` used for elliptical mask picture shapes. */
export const ELLIPSE_GEOM_XML = `<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>`;
