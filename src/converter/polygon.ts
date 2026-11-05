/**
 * Regular polygon / star vertex math (px), used as a fallback for native
 * custGeom freeform shapes. Pure and unit-testable (no Figma global).
 */

import { ptToInch } from './units';

export interface Vertex {
  x: number;
  y: number;
}

/**
 * Vertices of a regular N-gon inscribed in the node box, first vertex up.
 * Radius uses min(width, height) so a non-square box yields a centered polygon.
 */
export function polygonVertices(width: number, height: number, n: number): Vertex[] {
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2;
  const out: Vertex[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

/**
 * Vertices of a regular star (alternating outer/inner), first outer point up.
 * `innerRadius` is Figma's 0..1 ratio of the outer radius.
 */
export function starVertices(
  width: number,
  height: number,
  n: number,
  innerRadius: number
): Vertex[] {
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2;
  const ir = r * Math.min(1, Math.max(0, innerRadius));
  const out: Vertex[] = [];
  for (let i = 0; i < n; i++) {
    const aOut = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const aIn = aOut + Math.PI / n;
    out.push({ x: cx + r * Math.cos(aOut), y: cy + r * Math.sin(aOut) });
    out.push({ x: cx + ir * Math.cos(aIn), y: cy + ir * Math.sin(aIn) });
  }
  return out;
}

// ---- Figma SVG path data → PowerPoint custGeom ----

export type PathCommand =
  | { cmd: 'M'; x: number; y: number }
  | { cmd: 'L'; x: number; y: number }
  | { cmd: 'Q'; x1: number; y1: number; x: number; y: number }
  | { cmd: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { cmd: 'Z' };

const TOKEN_RE = /[A-Za-z]|[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g;

/**
 * Parse a Figma vector path `data` string (the M/L/Q/C/Z subset) into a
 * normalized command list. Tolerates commands with or without surrounding
 * spaces (e.g. both `M 0 0` and `M0 0`).
 */
export function parseSvgPath(data: string): PathCommand[] {
  const tokens = data.match(TOKEN_RE) ?? [];
  const out: PathCommand[] = [];
  let cmd = '';
  let i = 0;
  const num = (): number => {
    const v = Number(tokens[i]);
    i++;
    return Number.isFinite(v) ? v : 0;
  };
  while (i < tokens.length) {
    const tok = tokens[i];
    if (/[A-Za-z]/.test(tok)) {
      const c = tok.toUpperCase();
      if (c === 'Z') {
        out.push({ cmd: 'Z' });
        cmd = '';
      } else {
        cmd = c;
      }
      i++;
      continue;
    }
    switch (cmd) {
      case 'M':
        out.push({ cmd: 'M', x: num(), y: num() });
        cmd = 'L'; // implicit lineto after moveTo
        break;
      case 'L':
        out.push({ cmd: 'L', x: num(), y: num() });
        break;
      case 'Q':
        out.push({ cmd: 'Q', x1: num(), y1: num(), x: num(), y: num() });
        break;
      case 'C':
        out.push({ cmd: 'C', x1: num(), y1: num(), x2: num(), y2: num(), x: num(), y: num() });
        break;
      default:
        // Stray number with no active command; skip it defensively.
        i++;
        break;
    }
  }
  // A trailing implicit close is added by the caller when needed.
  return out;
}

/** Convert parsed commands into pptxgenjs custGeom points (px → inches). */
export function commandsToPoints(commands: PathCommand[]): unknown[] {
  const points: unknown[] = [];
  for (const c of commands) {
    switch (c.cmd) {
      case 'M':
        points.push({ x: ptToInch(c.x), y: ptToInch(c.y), moveTo: true });
        break;
      case 'L':
        points.push({ x: ptToInch(c.x), y: ptToInch(c.y) });
        break;
      case 'Q':
        points.push({
          x: ptToInch(c.x),
          y: ptToInch(c.y),
          curve: { type: 'quadratic', x1: ptToInch(c.x1), y1: ptToInch(c.y1) },
        });
        break;
      case 'C':
        points.push({
          x: ptToInch(c.x),
          y: ptToInch(c.y),
          curve: {
            type: 'cubic',
            x1: ptToInch(c.x1),
            y1: ptToInch(c.y1),
            x2: ptToInch(c.x2),
            y2: ptToInch(c.y2),
          },
        });
        break;
      case 'Z':
        points.push({ close: true });
        break;
    }
  }
  return points;
}

/** SVG path `data` → pptxgenjs custGeom points (px → inches). */
export function svgPathToPoints(data: string): unknown[] {
  return commandsToPoints(parseSvgPath(data));
}
