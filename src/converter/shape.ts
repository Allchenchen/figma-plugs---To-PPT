import type { IRLine, IRShape } from '../ir/types';
import { round2 } from './units';
import { slidePtToInch } from './page-scale';
import { stripHash, opacityToTransparency, compositeColorOverBackground } from './colors';
import { polygonVertices, starVertices, svgPathToPoints } from './polygon';
import { pptxDashType } from '../reader/dash';

export type ShapeName = 'rect' | 'roundRect' | 'ellipse' | 'custGeom';

export interface ShapeRender {
  shape: ShapeName;
  options: Record<string, unknown>;
}

function independent(radii: { tl: number; tr: number; br: number; bl: number }): boolean {
  return !(radii.tl === radii.tr && radii.tr === radii.br && radii.br === radii.bl);
}

/** CustGeom path for a rounded rect with independent corner radii (inches). */
export function roundedRectPoints(
  w: number,
  h: number,
  tl: number,
  tr: number,
  br: number,
  bl: number
): unknown[] {
  return [
    { x: tl, y: 0, moveTo: true },
    { x: w - tr, y: 0 },
    { x: w, y: tr, curve: { type: 'quadratic', x1: w, y1: 0 } },
    { x: w, y: h - br },
    { x: w - br, y: h, curve: { type: 'quadratic', x1: w, y1: h } },
    { x: bl, y: h },
    { x: 0, y: h - bl, curve: { type: 'quadratic', x1: 0, y1: h } },
    { x: 0, y: tl },
    { x: tl, y: 0, curve: { type: 'quadratic', x1: 0, y1: 0 } },
    { close: true },
  ];
}

/** Vertices (px) → custGeom points (inches): first vertex moveTo, then close. */
export function custGeomPoints(vertices: { x: number; y: number }[]): unknown[] {
  const points: unknown[] = vertices.map((v, i) => ({
    x: slidePtToInch(v.x),
    y: slidePtToInch(v.y),
    ...(i === 0 ? { moveTo: true } : {}),
  }));
  points.push({ close: true });
  return points;
}

/**
 * Build pptxgenjs addShape options + shape name from an IRShape.
 * A fill that sits on the empty slide background is baked onto `backdropHex`
 * so hosts that composite shape transparency against white do not turn
 * near-black cards into medium gray.
 * A fill that already covers other content keeps its opacity, so it composites
 * over that content instead of becoming an opaque plate.
 */
export function shapeRender(
  layer: IRShape,
  backdropHex = '#FFFFFF',
  options?: { bakeFill?: boolean }
): ShapeRender {
  const bakeFill = options?.bakeFill !== false;
  const x = slidePtToInch(layer.rect.x);
  const y = slidePtToInch(layer.rect.y);
  const w = slidePtToInch(layer.rect.width);
  const h = slidePtToInch(layer.rect.height);

  let fillHex = layer.fill;
  let fillOpacity = layer.opacity;
  if (bakeFill && fillHex && fillOpacity < 1 - 1e-6) {
    fillHex = compositeColorOverBackground(fillHex, fillOpacity, backdropHex);
    fillOpacity = 1;
  }

  const base: Record<string, unknown> = {
    x,
    y,
    w,
    h,
    // Stroke-only (bordered / divider) must stay unfilled — never invent gray.
    fill: fillHex ? { color: stripHash(fillHex) } : { type: 'none' },
    line: { type: 'none' },
  };

  if (fillHex && fillOpacity < 1) {
    base.fill = {
      color: stripHash(fillHex),
      transparency: opacityToTransparency(fillOpacity),
    };
  }

  if (layer.stroke) {
    const line: Record<string, unknown> = {
      color: stripHash(layer.stroke.color),
      // After page mapping, stroke weight is already in pt (1:1 with Figma px×scale).
      width: round2(layer.stroke.weight),
    };
    if (layer.stroke.dash && layer.stroke.dash !== 'solid') {
      line.dashType = pptxDashType(layer.stroke.dash);
    }
    // Stroke-only shapes: IR.opacity is the stroke alpha (no fill to bake).
    if (!layer.fill && layer.opacity < 1 - 1e-6) {
      line.transparency = opacityToTransparency(layer.opacity);
    }
    base.line = line;
  }

  if (layer.shapeKind === 'ellipse') {
    return { shape: 'ellipse', options: base };
  }

  if (layer.shapeKind === 'polygon' || layer.shapeKind === 'star') {
    // Prefer the node's actual vector path (editable freeform, keeps curves).
    if (layer.path && layer.path.length === 1) {
      base.points = svgPathToPoints(layer.path[0].data);
      return { shape: 'custGeom', options: base };
    }
    const n = Math.max(3, Math.round(layer.pointCount ?? 5));
    const vertices =
      layer.shapeKind === 'star'
        ? starVertices(layer.rect.width, layer.rect.height, n, layer.innerRadius ?? 0.5)
        : polygonVertices(layer.rect.width, layer.rect.height, n);
    base.points = custGeomPoints(vertices);
    return { shape: 'custGeom', options: base };
  }

  const radii = layer.cornerRadii;
  if (radii && independent(radii)) {
    base.points = roundedRectPoints(
      w,
      h,
      slidePtToInch(radii.tl),
      slidePtToInch(radii.tr),
      slidePtToInch(radii.br),
      slidePtToInch(radii.bl)
    );
    return { shape: 'custGeom', options: base };
  }

  const r = radii ? radii.tl : 0;
  if (r > 0) {
    base.rectRadius = slidePtToInch(r);
    return { shape: 'roundRect', options: base };
  }

  return { shape: 'rect', options: base };
}

/** Build pptxgenjs addShape options for a native (straight) line. */
export function lineRender(layer: IRLine): { shape: 'rect'; options: Record<string, unknown> } {
  const fill: Record<string, unknown> = { color: stripHash(layer.color) };
  if (layer.opacity < 1) {
    fill.transparency = opacityToTransparency(layer.opacity);
  }
  return {
    shape: 'rect',
    options: {
      x: slidePtToInch(layer.rect.x),
      y: slidePtToInch(layer.rect.y),
      w: slidePtToInch(layer.rect.width),
      h: slidePtToInch(layer.rect.height),
      fill,
      line: { type: 'none' },
    },
  };
}
