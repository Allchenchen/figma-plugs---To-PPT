import type { IRTextLinearGradient } from '../ir/types';
import { rgbToHex } from './colors';

/** Figma `gradientTransform`: maps the text box into gradient space. */
export type GradientTransform = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
];

export interface LinearGradientStopInput {
  /** 0..1 along the full handle, before clipping to the text box. */
  position: number;
  color: { r: number; g: number; b: number; a?: number };
  /** Paint opacity 0..1. Multiplied into the stop alpha. */
  opacity?: number;
}

const EPS = 1e-4;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * PowerPoint UI angle. 0° is left-to-right, clockwise, with +y pointing down
 * (90° top-to-bottom, 180° right-to-left, 270° bottom-to-top).
 */
export function powerpointGradientAngle(dx: number, dy: number): number {
  if (Math.hypot(dx, dy) < EPS) return 0;
  const degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
  return round4(((degrees % 360) + 360) % 360);
}

interface Point {
  x: number;
  y: number;
}

/**
 * `gradientTransform` maps the text box into gradient space.
 * The two linear handles are the inverse applied to (0, 0.5) and (1, 0.5).
 */
function invertGradientTransform(transform: GradientTransform): GradientTransform | null {
  const a = transform[0][0];
  const c = transform[0][1];
  const e = transform[0][2];
  const b = transform[1][0];
  const d = transform[1][1];
  const f = transform[1][2];
  const det = a * d - c * b;
  if (Math.abs(det) < 1e-8) return null;
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  const ie = -(ia * e + ic * f);
  const iff = -(ib * e + id * f);
  return [
    [ia, ic, ie],
    [ib, id, iff],
  ];
}

function gradientPoint(
  transform: GradientTransform,
  gx: number,
  gy: number,
  width: number,
  height: number
): Point {
  const intoLayer = invertGradientTransform(transform) ?? transform;
  return {
    x: (intoLayer[0][0] * gx + intoLayer[0][1] * gy + intoLayer[0][2]) * width,
    y: (intoLayer[1][0] * gx + intoLayer[1][1] * gy + intoLayer[1][2]) * height,
  };
}

/** Layer-space ends of the linear gradient. */
export function linearGradientHandles(
  transform: GradientTransform,
  width: number,
  height: number
): { start: Point; end: Point } {
  return {
    start: gradientPoint(transform, 0, 0.5, width, height),
    end: gradientPoint(transform, 1, 0.5, width, height),
  };
}

/** Where a point sits on the gradient line. 0 is the start handle, 1 is the end handle. */
function parameterOnLine(point: Point, start: Point, end: Point): number | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < EPS * EPS) return null;
  return ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
}

/**
 * Gradient-parameter range covered by the text box.
 * The extremes of a linear function on a rectangle are at the corners.
 */
function textBoxParameterRange(
  start: Point,
  end: Point,
  width: number,
  height: number
): { t0: number; t1: number } | null {
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: 0, y: height },
    { x: width, y: height },
  ];
  const values: number[] = [];
  for (const corner of corners) {
    const t = parameterOnLine(corner, start, end);
    if (t !== null) values.push(t);
  }
  if (values.length === 0) return null;
  return { t0: Math.min(...values), t1: Math.max(...values) };
}

interface ResolvedStop {
  position: number;
  color: string;
  opacity: number;
}

function resolveStop(stop: LinearGradientStopInput): ResolvedStop {
  const alpha = stop.color.a === undefined ? 1 : clamp01(stop.color.a);
  const paint = stop.opacity === undefined ? 1 : clamp01(stop.opacity);
  return {
    position: clamp01(stop.position),
    color: rgbToHex(stop.color),
    opacity: clamp01(alpha * paint),
  };
}

function channel(hex: string, index: number): number {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
}

function lerpHex(from: string, to: string, t: number): string {
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  const r = mix(channel(from, 0), channel(to, 0));
  const g = mix(channel(from, 1), channel(to, 1));
  const b = mix(channel(from, 2), channel(to, 2));
  return rgbToHex({ r: r / 255, g: g / 255, b: b / 255 });
}

function colorAt(stops: ResolvedStop[], position: number): ResolvedStop {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (position <= first.position) return { ...first, position };
  if (position >= last.position) return { ...last, position };
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const left = sorted[i]!;
    const right = sorted[i + 1]!;
    if (position > right.position) continue;
    const span = right.position - left.position;
    const t = span < EPS ? 0 : (position - left.position) / span;
    return {
      position,
      color: lerpHex(left.color, right.color, t),
      opacity: left.opacity + (right.opacity - left.opacity) * t,
    };
  }
  return { ...last, position };
}

export interface TextBoxSolidFill {
  kind: 'solid';
  color: string;
  /** 0..1. Paint opacity × stop alpha. Node opacity is applied by the reader. */
  opacity: number;
}

export type TextBoxLinearFill = (IRTextLinearGradient & { kind: 'gradient' }) | TextBoxSolidFill;

function samePaint(a: ResolvedStop, b: ResolvedStop): boolean {
  return a.color === b.color && Math.abs(a.opacity - b.opacity) <= 0.001;
}

/**
 * Map one Figma linear gradient onto a text box.
 * The four corners projected onto the gradient line are the colors on the box.
 * A range with more than one color becomes a linear fill across the box.
 * One color across the whole box stays solid.
 */
export function linearGradientOnTextBox(
  transform: GradientTransform,
  width: number,
  height: number,
  stops: readonly LinearGradientStopInput[]
): TextBoxLinearFill | null {
  if (!(width > 0) || !(height > 0) || stops.length === 0) return null;
  const resolved = stops.map(resolveStop).sort((a, b) => a.position - b.position);
  const { start, end } = linearGradientHandles(transform, width, height);
  const range = textBoxParameterRange(start, end, width, height);
  const sample = (t: number): ResolvedStop => {
    const color = colorAt(resolved, t);
    return { ...color, opacity: round4(color.opacity) };
  };
  if (!range || range.t1 - range.t0 < EPS) {
    const flat = sample(range?.t0 ?? resolved[0]!.position);
    return { kind: 'solid', color: flat.color, opacity: flat.opacity };
  }
  const { t0, t1 } = range;
  const span = t1 - t0;
  const mapped: ResolvedStop[] = [];
  const push = (stop: ResolvedStop) => {
    const position = round4(clamp01(stop.position));
    const previous = mapped[mapped.length - 1];
    if (previous && Math.abs(previous.position - position) <= EPS) {
      mapped[mapped.length - 1] = { ...stop, position };
      return;
    }
    mapped.push({ ...stop, position, opacity: round4(stop.opacity) });
  };
  push({ ...sample(t0), position: 0 });
  for (const stop of resolved) {
    if (stop.position <= t0 + EPS || stop.position >= t1 - EPS) continue;
    push({ ...stop, position: (stop.position - t0) / span });
  }
  push({ ...sample(t1), position: 1 });
  mapped.sort((a, b) => a.position - b.position);
  if (mapped.every((stop) => samePaint(stop, mapped[0]!))) {
    return { kind: 'solid', color: mapped[0]!.color, opacity: mapped[0]!.opacity };
  }
  return {
    kind: 'gradient',
    style: 'linear',
    angle: powerpointGradientAngle(end.x - start.x, end.y - start.y),
    stops: mapped,
  };
}

/** Where the ray from the focus through this point leaves the unit square. */
function rectangleExit(fx: number, fy: number, dx: number, dy: number): number | null {
  const scales: number[] = [];
  if (dx > 1e-8) scales.push((1 - fx) / dx);
  else if (dx < -1e-8) scales.push((0 - fx) / dx);
  if (dy > 1e-8) scales.push((1 - fy) / dy);
  else if (dy < -1e-8) scales.push((0 - fy) / dy);
  const forward = scales.filter((scale) => scale > 1e-6);
  return forward.length === 0 ? null : Math.min(...forward);
}

/**
 * PowerPoint path-gradient position. 0 is the focus. 1 is where the ray leaves
 * the circle (radial) or the text box (diamond). Office draws `path="circle"`
 * by scaling that circle about the focus.
 */
function powerpointPathParameter(
  focus: Point,
  point: Point,
  width: number,
  height: number,
  style: 'radial' | 'diamond'
): number {
  const fx = focus.x / width;
  const fy = focus.y / height;
  const dx = point.x / width - fx;
  const dy = point.y / height - fy;
  const length = dx * dx + dy * dy;
  if (length < 1e-12) return 0;
  if (style === 'diamond') {
    const exit = rectangleExit(fx, fy, dx, dy);
    return exit && exit > 0 ? Math.min(1, 1 / exit) : 0;
  }
  const ox = fx - 0.5;
  const oy = fy - 0.5;
  const b = 2 * (ox * dx + oy * dy);
  const c = ox * ox + oy * oy - 0.25;
  const disc = b * b - 4 * length * c;
  if (disc < 0) return 1;
  const root = Math.sqrt(disc);
  const exit = Math.max((-b + root) / (2 * length), (-b - root) / (2 * length));
  return exit > 1e-6 ? Math.min(1, 1 / exit) : 1;
}

function handleBasis(
  center: Point,
  edgeX: Point,
  edgeY: Point
): { rx: Point; ry: Point; det: number } | null {
  const rx = { x: edgeX.x - center.x, y: edgeX.y - center.y };
  const ry = { x: edgeY.x - center.x, y: edgeY.y - center.y };
  const det = rx.x * ry.y - rx.y * ry.x;
  if (Math.abs(det) < 1e-6) return null;
  return { rx, ry, det };
}

/** Figma radial (distance) or diamond (max axis) parameter. 0 is the center, 1 is the edge handle. */
function figmaPathParameter(point: Point, center: Point, edgeX: Point, edgeY: Point, metric: 'radial' | 'diamond'): number {
  const basis = handleBasis(center, edgeX, edgeY);
  const vx = point.x - center.x;
  const vy = point.y - center.y;
  if (!basis) {
    const length = Math.hypot(edgeX.x - center.x, edgeX.y - center.y);
    return length < 1e-6 ? 0 : Math.hypot(vx, vy) / length;
  }
  const u = (vx * basis.ry.y - vy * basis.ry.x) / basis.det;
  const v = (basis.rx.x * vy - basis.rx.y * vx) / basis.det;
  return metric === 'diamond' ? Math.max(Math.abs(u), Math.abs(v)) : Math.hypot(u, v);
}

/**
 * Radial or diamond text fill. The center handle stays the focus. Stop positions
 * are where those colors fall on the text box, so the letters keep Figma's colors
 * instead of the unused center color.
 */
function pathGradientOnTextBox(
  transform: GradientTransform,
  width: number,
  height: number,
  stops: readonly LinearGradientStopInput[],
  style: 'radial' | 'diamond'
): TextBoxLinearFill | null {
  if (!(width > 0) || !(height > 0) || stops.length === 0) return null;
  const resolved = stops.map(resolveStop).sort((a, b) => a.position - b.position);
  const center = gradientPoint(transform, 0.5, 0.5, width, height);
  const edgeX = gradientPoint(transform, 1, 0.5, width, height);
  const edgeY = gradientPoint(transform, 0.5, 1, width, height);
  const mapped: ResolvedStop[] = [];
  const byPosition = new Map<number, { stop: ResolvedStop; distance: number; gradient: number }>();
  const push = (position: number, color: ResolvedStop, distance: number, gradient: number) => {
    const rounded = round4(Math.min(1, Math.max(0, position)));
    const next = { position: rounded, color: color.color, opacity: round4(color.opacity) };
    const current = byPosition.get(rounded);
    if (current && current.distance >= distance) return;
    byPosition.set(rounded, { stop: next, distance, gradient });
  };
  push(0, colorAt(resolved, 0), 0, 0);
  const y = height / 2;
  for (let xIndex = 0; xIndex <= 8; xIndex += 1) {
    const point = { x: (width * xIndex) / 8, y };
    const parameter = powerpointPathParameter(center, point, width, height, style);
    const gradient = figmaPathParameter(point, center, edgeX, edgeY, style);
    const color = colorAt(resolved, gradient);
    const distance = Math.hypot(point.x - center.x, point.y - center.y);
    push(parameter, color, distance, gradient);
  }
  let furthest = 0;
  for (const entry of [...byPosition.values()].sort((a, b) => a.stop.position - b.stop.position)) {
    if (entry.gradient + EPS < furthest) continue;
    furthest = entry.gradient;
    mapped.push(entry.stop);
  }
  if (mapped[mapped.length - 1]!.position < 1) {
    mapped.push({ ...mapped[mapped.length - 1]!, position: 1 });
  }
  if (mapped.every((stop) => samePaint(stop, mapped[0]!))) {
    return { kind: 'solid', color: mapped[0]!.color, opacity: mapped[0]!.opacity };
  }
  return {
    kind: 'gradient',
    style,
    angle: 0,
    center: { x: round4(center.x / width), y: round4(center.y / height) },
    stops: mapped,
  };
}

/** Radial text fill. Position 0 is the center handle. */
export function radialGradientOnTextBox(
  transform: GradientTransform,
  width: number,
  height: number,
  stops: readonly LinearGradientStopInput[]
): TextBoxLinearFill | null {
  return pathGradientOnTextBox(transform, width, height, stops, 'radial');
}

/** Diamond text fill, written as PowerPoint's rectangular path gradient. */
export function diamondGradientOnTextBox(
  transform: GradientTransform,
  width: number,
  height: number,
  stops: readonly LinearGradientStopInput[]
): TextBoxLinearFill | null {
  return pathGradientOnTextBox(transform, width, height, stops, 'diamond');
}
