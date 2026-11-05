import type {
  CornerRadii,
  ExportOptions,
  ExportStrategy,
  IRDocument,
  IRElement,
  IRImage,
  IRImageSizing,
  IRLine,
  IRPictureShape,
  IRReportEntry,
  IRShape,
  IRSlide,
  IRStroke,
  IRText,
  IRTextLinearGradient,
  IRTextLineHeight,
  IRVectorPath,
  Rect,
} from '../ir/types';
import { summarizeQuality } from '../report/quality';
import {
  topSolidFillColor,
  topSolidFill,
  paintOpacity,
  combineLeafOpacity,
  rgbToHex,
  shouldRasterizeForGroupOpacity,
  resolveTextSolidFill,
} from './colors';
import { applyRootCoverOpacity } from './cover-opacity';
import {
  diamondGradientOnTextBox,
  linearGradientOnTextBox,
  radialGradientOnTextBox,
  type GradientTransform,
  type TextBoxLinearFill,
} from './text-gradient';
import {
  relativeBounds,
  childrenOverflowParent,
  transformedTextRect,
  type Box,
} from './geometry';
import {
  extractCornerRadii,
  maxCornerRadii,
  scaleCornerSource,
  type CornerSource,
} from './corners';
import { sortFramesByName } from './frame-order';
import { letterSpacingPx } from './text';
import { normalizeLineHeight } from '../converter/text-layout';
import { decideFallback, isContainerType, isLayoutFrameType } from './compat';
import { describeNode } from './describe';
import { classifyLine } from './line';
import { dashStyleFromPattern } from './dash';
import {
  detectMime,
  imageFillMode,
  coverSrcRect,
  containFit,
  cropSrcRect,
  tileScale,
  pngPixelSize,
} from './image';
import { imagePlacementRect } from './image-placement';
import { dropImageEdgeCoverShapes } from '../ir/image-cover-strips';
import { dropOccludedCoLocatedImages } from '../ir/image-occlusion';
import { alignScreenRasterToChrome } from '../ir/screen-chrome-align';
import { rasterizedTextDescendantEntries } from './report';
import {
  buildTextParagraphs,
  normalizeFigmaNewlines,
  normalizeTextWithBoundaries,
  decideMixedLineHeightRender,
  parseSvgVisualLines,
  textRunsFromSegments,
  type TextSegmentInput,
} from './text-model';
import {
  partitionChildren,
  unionRect,
  decideMask,
  chooseExportPlacement,
} from './mask';

const IMAGE_SCALE = 2;

function boxOf(node: SceneNode): Box | null {
  const b = node.absoluteBoundingBox;
  return b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null;
}

/** Visual bounds when available (post-effects / post-clip), else AABB. */
function renderBoxOf(node: SceneNode): Box | null {
  if ('absoluteRenderBounds' in node) {
    const r = (node as SceneNode & { absoluteRenderBounds: Box | null }).absoluteRenderBounds;
    if (r && r.width > 0 && r.height > 0) return { x: r.x, y: r.y, width: r.width, height: r.height };
  }
  return boxOf(node);
}

function nodeHasNestedMask(node: SceneNode): boolean {
  if ('isMask' in node && (node as BlendMixin).isMask) return true;
  if ('children' in node) {
    for (const c of (node as ChildrenMixin).children) {
      if (nodeHasNestedMask(c)) return true;
    }
  }
  return false;
}

function sceneSubtreeHasText(node: SceneNode): boolean {
  if (node.type === 'TEXT') return true;
  if ('children' in node) {
    for (const c of (node as ChildrenMixin).children) {
      if (sceneSubtreeHasText(c)) return true;
    }
  }
  return false;
}

function isComplexContentType(type: string): boolean {
  return (
    type === 'VECTOR' ||
    type === 'BOOLEAN_OPERATION' ||
    type === 'STAR' ||
    type === 'POLYGON' ||
    type === 'LINE' ||
    type === 'GROUP' ||
    type === 'FRAME' ||
    type === 'COMPONENT' ||
    type === 'INSTANCE'
  );
}

function resolvedPaints(paints: readonly Paint[] | PluginAPI['mixed']): readonly Paint[] {
  return paints === figma.mixed ? [] : paints;
}

function readStroke(node: GeometryMixin): IRStroke | null {
  const strokes = resolvedPaints(node.strokes);
  if (strokes.length === 0) return null;
  const color = topSolidFillColor(strokes);
  if (!color) return null;
  const weight = typeof node.strokeWeight === 'number' ? node.strokeWeight : 1;
  const stroke: IRStroke = { color, weight };
  if ('dashPattern' in node) {
    const dp = (node as GeometryMixin & { dashPattern: number[] | PluginAPI['mixed'] }).dashPattern;
    if (dp !== figma.mixed && Array.isArray(dp)) {
      const style = dashStyleFromPattern(dp);
      if (style !== 'solid') stroke.dash = style;
    }
  }
  return stroke;
}

/** Structurally-typed result of `getStyledTextSegments` (avoids generic friction). */
interface StyledRunLike {
  characters: string;
  start: number;
  end: number;
  fontSize: number;
  fontName: FontName;
  fontWeight: number;
  fontStyle: FontStyle;
  fills: Paint[];
  letterSpacing: LetterSpacing;
  lineHeight: LineHeight;
  paragraphSpacing: number;
  paragraphIndent: number;
  textCase: TextCase;
  listOptions: TextListOptions;
  listSpacing: number;
  indentation: number;
}

function runLineHeight(value: LineHeight): IRTextLineHeight {
  return value.unit === 'AUTO'
    ? { unit: 'AUTO' }
    : { unit: value.unit, value: value.value };
}

/**
 * Split a TextNode into per-style runs using Figma's styled-text segments.
 * This is the authoritative source for mixed rich text: each run carries its
 * own font size / family / weight / fill color / letter spacing / opacity.
 *
 * `nodeOpacity` is already `inherited × TextNode.opacity` (leaf node factor).
 * Per-run paint opacity is combined here — never push parent-group opacity
 * onto overlapping siblings via this helper.
 */
function buildTextRuns(
  node: TextNode,
  nodeOpacity: number,
  leadingTrim?: LeadingTrim
): TextSegmentInput[] {
  const segments = node.getStyledTextSegments([
    'fontName',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'fills',
    'letterSpacing',
    'textDecoration',
    'lineHeight',
    'paragraphSpacing',
    'paragraphIndent',
    'textCase',
    'listOptions',
    'listSpacing',
    'indentation',
  ]) as unknown as (StyledRunLike & { textDecoration?: TextNode['textDecoration'] })[];

  // Node-level fills carry Fill opacity from the UI (e.g. 80%) even when
  // styled-segment paints omit the `opacity` field.
  const nodeFills =
    node.fills === figma.mixed ? [] : (resolvedPaints(node.fills) as Paint[]);

  return segments.map((seg) => {
    const fill = resolveTextSolidFill(seg.fills ?? [], nodeFills);
    const linear = linearTextFill(seg.fills ?? [], nodeFills, node.width, node.height, nodeOpacity);
    const fillGradient = linear && 'gradient' in linear ? linear.gradient : undefined;
    const linearSolid = linear && 'solid' in linear ? linear.solid : null;
    const fallback = fill || fillGradient || linearSolid ? null : firstGradientStop(seg.fills ?? [], nodeFills);
    const deco = seg.textDecoration;
    return {
      text: normalizeFigmaNewlines(seg.characters),
      start: seg.start,
      end: seg.end,
      fontSize: seg.fontSize,
      fontFamily: seg.fontName.family,
      fontStyle: seg.fontName.style,
      fontWeight: seg.fontWeight,
      color:
        fillGradient?.stops[0]?.color ??
        linearSolid?.color ??
        fill?.color ??
        fallback?.color ??
        '#000000',
      letterSpacing: letterSpacingPx(seg.letterSpacing, seg.fontSize),
      opacity: fillGradient
        ? 1
        : combineLeafOpacity(nodeOpacity, fill?.opacity ?? linearSolid?.opacity ?? fallback?.opacity ?? 1),
      ...(fillGradient ? { fillGradient } : {}),
      underline: deco === 'UNDERLINE' ? true : undefined,
      strikethrough: deco === 'STRIKETHROUGH' ? true : undefined,
      italic: seg.fontStyle === 'ITALIC' ? true : undefined,
      textCase: seg.textCase,
      lineHeight: runLineHeight(seg.lineHeight),
      paragraphSpacing: seg.paragraphSpacing,
      paragraphIndent: seg.paragraphIndent,
      listType: seg.listOptions.type,
      listSpacing: seg.listSpacing,
      indentation: seg.indentation,
      leadingTrim,
    };
  });
}

function visiblePaints(fills: readonly Paint[]): Paint[] {
  return fills.filter((fill) => fill.visible !== false);
}

/**
 * Topmost linear, radial, or diamond gradient on this text layer, mapped onto the text box.
 * A flat projection stays a solid run color. Node opacity is folded into
 * each gradient stop so the run itself stays opaque and is not baked to gray.
 */
function linearTextFill(
  segmentFills: readonly Paint[],
  nodeFills: readonly Paint[],
  width: number,
  height: number,
  nodeOpacity: number
): { gradient: IRTextLinearGradient } | { solid: { color: string; opacity: number } } | undefined {
  const segment = visiblePaints(segmentFills);
  const paints = segment.length > 0 ? segment : visiblePaints(nodeFills);
  const top = paints[paints.length - 1];
  if (!top || (top.type !== 'GRADIENT_LINEAR' && top.type !== 'GRADIENT_RADIAL' && top.type !== 'GRADIENT_DIAMOND')) {
    return undefined;
  }
  const stopInputs = top.gradientStops.map((stop) => ({
    position: stop.position,
    color: stop.color,
    opacity: top.opacity,
  }));
  const mapped =
    top.type === 'GRADIENT_RADIAL'
      ? radialGradientOnTextBox(top.gradientTransform as GradientTransform, width, height, stopInputs)
      : top.type === 'GRADIENT_DIAMOND'
        ? diamondGradientOnTextBox(top.gradientTransform as GradientTransform, width, height, stopInputs)
        : linearGradientOnTextBox(top.gradientTransform as GradientTransform, width, height, stopInputs);
  return mappedTextFill(mapped, nodeOpacity);
}

function mappedTextFill(
  mapped: TextBoxLinearFill | null,
  nodeOpacity: number
): { gradient: IRTextLinearGradient } | { solid: { color: string; opacity: number } } | undefined {
  if (!mapped) return undefined;
  if (mapped.kind === 'solid') return { solid: { color: mapped.color, opacity: mapped.opacity } };
  return {
    gradient: {
      style: mapped.style,
      angle: mapped.angle,
      center: mapped.center,
      stops: mapped.stops.map((stop) => ({
        ...stop,
        opacity: combineLeafOpacity(nodeOpacity, stop.opacity),
      })),
    },
  };
}

/** First stop of a non-linear gradient, so the editable fallback is not black. */
function firstGradientStop(
  segmentFills: readonly Paint[],
  nodeFills: readonly Paint[]
): { color: string; opacity: number } | null {
  const segment = visiblePaints(segmentFills);
  const paints = segment.length > 0 ? segment : visiblePaints(nodeFills);
  const top = paints[paints.length - 1];
  if (!top || top.type === 'SOLID' || top.type === 'IMAGE' || top.type === 'VIDEO') return null;
  if (!('gradientStops' in top) || top.gradientStops.length === 0) return null;
  const stop = top.gradientStops[0]!;
  const alpha = stop.color.a === undefined ? 1 : stop.color.a;
  return {
    color: rgbToHex(stop.color),
    opacity: Math.min(1, Math.max(0, alpha * (top.opacity ?? 1))),
  };
}

function nodeOpacityOf(node: SceneNode): number {
  if ('opacity' in node && typeof (node as BlendMixin).opacity === 'number') {
    return Math.min(1, Math.max(0, (node as BlendMixin).opacity));
  }
  return 1;
}

const fontLoads = new Map<string, Promise<void>>();

function fontKey(font: FontName): string {
  return `${font.family}\0${font.style}`;
}

function ensureFont(font: FontName): Promise<void> {
  const key = fontKey(font);
  const pending = fontLoads.get(key);
  if (pending) return pending;
  const task = figma.loadFontAsync(font).catch((error: unknown) => {
    fontLoads.delete(key);
    throw error;
  });
  fontLoads.set(key, task);
  return task;
}

function fontsOnNode(node: TextNode): FontName[] {
  if (node.fontName === figma.mixed) {
    return node.getRangeAllFontNames(0, node.characters.length);
  }
  return [node.fontName as FontName];
}

function collectFrameFonts(node: SceneNode, fonts: Map<string, FontName>): void {
  if ('visible' in node && node.visible === false) return;
  if (node.type === 'TEXT') {
    for (const font of fontsOnNode(node)) fonts.set(fontKey(font), font);
    return;
  }
  if ('children' in node) {
    for (const child of (node as ChildrenMixin).children) collectFrameFonts(child, fonts);
  }
}

async function preloadFrameFonts(frame: FrameNode): Promise<void> {
  const fonts = new Map<string, FontName>();
  collectFrameFonts(frame, fonts);
  await Promise.all([...fonts.values()].map((font) => ensureFont(font)));
}

async function readText(
  node: TextNode,
  rect: Rect,
  sourceRenderBounds: Rect | undefined,
  zIndex: number,
  inheritedOpacity = 1,
  rotation = 0,
  flipH = false,
  flipV = false,
  containerContext?: IRText['containerContext']
): Promise<IRText> {
  await Promise.all(fontsOnNode(node).map((font) => ensureFont(font)));

  const leafOpacity = combineLeafOpacity(inheritedOpacity, nodeOpacityOf(node));
  const nodeLeadingTrim =
    node.leadingTrim === figma.mixed ? undefined : node.leadingTrim;
  // Capture break kinds from raw Figma characters before LF normalization.
  const { characters, boundaries } = normalizeTextWithBoundaries(node.characters);
  const segments = buildTextRuns(node, leafOpacity, nodeLeadingTrim);
  const runs = textRunsFromSegments(segments);
  const paragraphs = buildTextParagraphs(
    characters,
    segments,
    node.textAlignHorizontal,
    boundaries
  );

  // Flat single-style summary (fallback + paragraph metrics), derived from the
  // first run so uniform text matches the rich-text path exactly.
  const first = runs[0];
  const fontSize = first?.fontSize ?? 14;
  const fontFamily = first?.fontFamily ?? 'Arial';
  const fontStyle = first?.fontStyle;
  const fontWeight = first?.fontWeight ?? 400;
  const color = first?.color ?? '#000000';
  const letterSpacing = first?.letterSpacing ?? 0;

  const rawLineHeight = node.lineHeight as LineHeight;
  const mixedLineHeight = node.lineHeight === figma.mixed;
  const figmaLh = mixedLineHeight
    ? null
    : rawLineHeight.unit === 'AUTO'
      ? ({ unit: 'AUTO' as const })
      : ({ unit: rawLineHeight.unit, value: rawLineHeight.value } as const);
  const lh = mixedLineHeight
    ? ({ px: null, unit: 'MIXED' as const })
    : normalizeLineHeight(figmaLh, fontSize);

  const paragraphSpacing =
    node.paragraphSpacing === figma.mixed ? null : (node.paragraphSpacing as number);
  const paragraphIndent =
    node.paragraphIndent === figma.mixed ? null : (node.paragraphIndent as number);
  const textCase =
    node.textCase === figma.mixed ? ('MIXED' as const) : node.textCase;

  const nodeDeco =
    node.textDecoration === figma.mixed ? 'NONE' : node.textDecoration;

  const result: IRText = {
    id: node.id,
    type: 'text',
    rect,
    rotation,
    flipH,
    flipV,
    // Uniform text: bake full opacity into the layer. Rich text: keep layer
    // opaque and put combined opacity on each run to avoid double application.
    opacity: runs.length > 1 ? 1 : (first?.opacity ?? leafOpacity),
    zIndex,
    characters,
    fontSize,
    fontFamily,
    fontStyle,
    fontWeight,
    color,
    underline: nodeDeco === 'UNDERLINE' || first?.underline ? true : undefined,
    strikethrough:
      nodeDeco === 'STRIKETHROUGH' || first?.strikethrough ? true : undefined,
    letterSpacing,
    lineHeight: lh.px,
    lineHeightUnit: lh.unit,
    lineHeightPercent: lh.percent,
    paragraphSpacing,
    paragraphIndent,
    textAutoResize: node.textAutoResize,
    textCase,
    textAlignHorizontal: node.textAlignHorizontal,
    textAlignVertical: node.textAlignVertical,
    paragraphs,
    boundaries: boundaries.length > 0 ? boundaries : undefined,
    sourceRenderBounds,
    hasMissingFont: node.hasMissingFont,
    leadingTrimMixed: node.leadingTrim === figma.mixed ? true : undefined,
    transform: {
      a: node.absoluteTransform[0][0],
      b: node.absoluteTransform[1][0],
      c: node.absoluteTransform[0][1],
      d: node.absoluteTransform[1][1],
      e: node.absoluteTransform[0][2],
      f: node.absoluteTransform[1][2],
    },
    containerContext,
  };

  if (runs.length > 0) result.runs = runs;

  if (characters.length > 0) {
    try {
      const svg = await node.exportAsync({
        format: 'SVG_STRING',
        svgOutlineText: false,
        contentsOnly: true,
      });
      const visual = parseSvgVisualLines(svg, characters, boundaries);
      result.visualLineStatus = visual.status;
      result.visualLineReason = visual.reason;
      result.sourceSvgViewBox = visual.viewBox;
      if (visual.status === 'exact') result.visualLines = visual.lines;
    } catch (error) {
      result.visualLineStatus = 'unavailable';
      result.visualLineReason =
        error instanceof Error ? error.message : 'SVG text metadata export failed';
    }
  }

  return result;
}

/** Extract a single filled vector path from a node's `fillGeometry`. */
function readVectorPath(node: SceneNode & GeometryMixin): IRVectorPath[] | null {
  const geom = node.fillGeometry;
  if (!geom || geom.length === 0) return null;
  // One custGeom path can only express a single closed sub-path.
  if (geom.length !== 1) return null;
  const p = geom[0];
  if (p.windingRule === 'NONE') return null;
  return [{ windingRule: p.windingRule, data: p.data }];
}

/**
 * A STAR/POLYGON whose `fillGeometry` has multiple sub-paths (a compound or
 * edited vector with holes) cannot be faithfully expressed as one editable
 * custGeom freeform; it must be rasterized rather than regenerated as a regular
 * shape (which would silently change its geometry).
 */
function hasCompoundVectorPath(node: SceneNode & GeometryMixin): boolean {
  return Array.isArray(node.fillGeometry) && node.fillGeometry.length > 1;
}

/**
 * Map local corner radii into the absolute placement box.
 *
 * Figma `cornerRadius` shares the space of `node.width` / `node.height`. IR
 * `rect` comes from `absoluteBoundingBox` (includes Instance / group scale).
 * Without this factor, a scaled Instance keeps local r=10 while the box is
 * already 4× — PPT corners look far too sharp vs Figma.
 */
function absoluteCornerScale(node: SceneNode): number {
  if ('absoluteTransform' in node) {
    const t = (node as LayoutMixin).absoluteTransform;
    const sx = Math.hypot(t[0][0], t[1][0]);
    const sy = Math.hypot(t[0][1], t[1][1]);
    if (sx > 1e-6 && sy > 1e-6) {
      return Math.sqrt(sx * sy);
    }
  }
  const box = boxOf(node);
  if (box && 'width' in node && (node as LayoutMixin).width > 1e-6) {
    return box.width / (node as LayoutMixin).width;
  }
  return 1;
}

function cornerSourceFromRectLike(
  node: RectangleNode | FrameNode | ComponentNode | InstanceNode
): CornerSource {
  const n = node as RectangleNode;
  return {
    cornerRadius: n.cornerRadius === figma.mixed ? undefined : n.cornerRadius,
    topLeftRadius: n.topLeftRadius,
    topRightRadius: n.topRightRadius,
    bottomRightRadius: n.bottomRightRadius,
    bottomLeftRadius: n.bottomLeftRadius,
  };
}

function readRectCornerRadii(node: RectangleNode, width: number, height: number): CornerRadii | null {
  return extractCornerRadii(
    scaleCornerSource(cornerSourceFromRectLike(node), absoluteCornerScale(node)),
    width,
    height
  );
}

function readFrameCornerRadii(
  node: FrameNode | ComponentNode | InstanceNode,
  width: number,
  height: number
): CornerRadii | null {
  return extractCornerRadii(
    scaleCornerSource(cornerSourceFromRectLike(node), absoluteCornerScale(node)),
    width,
    height
  );
}

/** True when `inner` covers ≥98% of `outer` (same absolute space). */
function nearlyFillsBox(inner: Box, outer: Box, frac = 0.98): boolean {
  if (outer.width <= 0 || outer.height <= 0) return false;
  const ix0 = Math.max(inner.x, outer.x);
  const iy0 = Math.max(inner.y, outer.y);
  const ix1 = Math.min(inner.x + inner.width, outer.x + outer.width);
  const iy1 = Math.min(inner.y + inner.height, outer.y + outer.height);
  const iw = Math.max(0, ix1 - ix0);
  const ih = Math.max(0, iy1 - iy0);
  return iw * ih >= outer.width * outer.height * frac;
}

/**
 * Visible silhouette radius for an image fill: own corners, plus any larger
 * radii from a clipping ancestor that this node nearly fills (parent round
 * clip is what Figma shows as the card outline).
 */
function effectiveImageCornerRadii(
  node: RectangleNode,
  width: number,
  height: number
): CornerRadii | null {
  let result = readRectCornerRadii(node, width, height);
  const selfBox = boxOf(node);
  if (!selfBox) return result;

  let parent: BaseNode | null = node.parent;
  while (parent && parent.type !== 'PAGE' && parent.type !== 'DOCUMENT') {
    if (
      (parent.type === 'FRAME' || parent.type === 'COMPONENT' || parent.type === 'INSTANCE') &&
      'clipsContent' in parent &&
      (parent as FrameNode).clipsContent
    ) {
      const frame = parent as FrameNode | ComponentNode | InstanceNode;
      const parentBox = boxOf(frame);
      if (parentBox && nearlyFillsBox(selfBox, parentBox)) {
        const inherited = readFrameCornerRadii(frame, width, height);
        result = maxCornerRadii(result, inherited);
      }
    }
    parent = parent.parent;
  }
  return result;
}

/**
 * Emit a layout Frame/Component/Instance's own fill + stroke as a native rect
 * so bordered cards keep their chrome when we recurse into editable children.
 * Returns null when there is nothing to paint (no solid fill, no stroke).
 */
function readFrameChrome(
  node: FrameNode | ComponentNode | InstanceNode,
  rect: Rect,
  zIndex: number,
  inheritedOpacity = 1
): IRShape | null {
  const solid = topSolidFill(resolvedPaints(node.fills));
  const stroke = readStroke(node);
  if (!solid && !stroke) return null;

  const fillOpacity = solid?.opacity ?? 1;
  const opacity = combineLeafOpacity(
    combineLeafOpacity(inheritedOpacity, nodeOpacityOf(node)),
    // Stroke-only: layer opacity still applies to the stroke via IR opacity.
    solid ? fillOpacity : 1
  );

  return {
    id: `${node.id}:chrome`,
    type: 'shape',
    rect,
    rotation: 0,
    opacity,
    zIndex,
    shapeKind: 'rect',
    fill: solid?.color ?? null,
    stroke,
    cornerRadii: readFrameCornerRadii(node, rect.width, rect.height),
  };
}

/**
 * Native shape from RECT/ELLIPSE/(legacy star path).
 * Stroke-only nodes must keep `fill: null` — never invent `#CCCCCC` or any
 * placeholder gray (that produced full-bleed gray cards on Research-style
 * pages where the content box is a stroked, unfilled rectangle on black).
 * Returns null when there is nothing to paint (no solid fill and no stroke).
 */
function readShape(
  node: SceneNode & GeometryMixin,
  rect: Rect,
  zIndex: number,
  inheritedOpacity = 1
): IRShape | null {
  const shapeKind =
    node.type === 'ELLIPSE'
      ? 'ellipse'
      : node.type === 'STAR'
        ? 'star'
        : node.type === 'POLYGON'
          ? 'polygon'
          : 'rect';
  const solid = topSolidFill(resolvedPaints(node.fills));
  const stroke = readStroke(node);
  if (!solid && !stroke) return null;

  // Paint opacity only applies when there is a solid fill; stroke-only shapes
  // still carry layer opacity for the stroke via IR.opacity.
  const opacity = combineLeafOpacity(
    combineLeafOpacity(inheritedOpacity, nodeOpacityOf(node)),
    solid ? solid.opacity : 1
  );

  const cornerRadii =
    node.type === 'RECTANGLE'
      ? readRectCornerRadii(node as RectangleNode, rect.width, rect.height)
      : null;

  const shape: IRShape = {
    id: node.id,
    type: 'shape',
    rect,
    rotation: 0,
    opacity,
    zIndex,
    shapeKind,
    fill: solid?.color ?? null,
    stroke,
    cornerRadii,
  };

  if (node.type === 'STAR') {
    shape.pointCount = (node as StarNode).pointCount;
    shape.innerRadius = (node as StarNode).innerRadius;
  } else if (node.type === 'POLYGON') {
    shape.pointCount = (node as PolygonNode).pointCount;
  }

  // STAR/POLYGON: keep the actual vector path (incl. rounded corners / edits)
  // so the freeform is vertex-editable and faithful, not a regenerated regular.
  if (node.type === 'STAR' || node.type === 'POLYGON') {
    const path = readVectorPath(node);
    if (path) shape.path = path;
  }

  return shape;
}

/**
 * Rasterize a node. Placement uses render bounds (not unclipped AABB) and the
 * PNG's pixel aspect so Mask Groups are not stretched/shifted.
 */
async function readImage(
  node: SceneNode,
  fallbackRect: Rect,
  zIndex: number,
  inheritedOpacity = 1,
  rootFrame?: FrameNode
): Promise<IRImage> {
  const bytes = await node.exportAsync({
    format: 'PNG',
    constraint: { type: 'SCALE', value: IMAGE_SCALE },
  });

  const rootBox = rootFrame ? boxOf(rootFrame) : null;
  const aabb = rootBox
    ? relativeBounds(boxOf(node), rootBox)
    : fallbackRect;
  const render = rootBox
    ? relativeBounds(renderBoxOf(node), rootBox)
    : null;
  const png = pngPixelSize(bytes);
  const frameSize = rootFrame
    ? { width: rootFrame.width, height: rootFrame.height }
    : { width: fallbackRect.width + fallbackRect.x, height: fallbackRect.height + fallbackRect.y };

  const rect = imagePlacementRect({
    aabb,
    render,
    frame: frameSize,
    pngWidthPx: png?.width,
    pngHeightPx: png?.height,
  });

  // PNG already composites paint/alpha; only propagate inherited×node opacity
  // (do not multiply paint opacity again — that would double-count).
  const opacity = combineLeafOpacity(inheritedOpacity, nodeOpacityOf(node));
  return {
    id: node.id,
    type: 'image',
    rect,
    rotation: 0,
    opacity,
    zIndex,
    data: figma.base64Encode(bytes),
    mimeType: 'image/png',
  };
}

async function tryReadImageFill(
  node: SceneNode,
  rect: Rect,
  zIndex: number,
  inheritedOpacity = 1
): Promise<IRImage | null> {
  // RECTANGLE only. ELLIPSE + IMAGE must go through exportAsync PNG (or
  // picture-shape) so the circular clip is preserved — FigDeck leaf path:
  // hasImageFill on non-container → PNG. A native rectangular picture would
  // show square avatars on Research-style pages.
  if (node.type !== 'RECTANGLE') return null;

  const geom = node as GeometryMixin;
  if ('rotation' in geom && (geom as unknown as { rotation: number }).rotation !== 0) return null;

  // A stroke means this is a shape with an image fill, not a plain picture.
  if (resolvedPaints(geom.strokes).some((s) => s.visible !== false)) return null;

  const fills = resolvedPaints(geom.fills);
  const visible = fills.filter((f) => f.visible !== false);
  const images = visible.filter((f) => f.type === 'IMAGE') as ImagePaint[];
  if (images.length !== 1 || visible.length !== 1) return null;

  const paint = images[0];
  const mode = imageFillMode(paint);
  // filtered/rotated paints are rasterized upstream.
  if (mode === null) return null;
  if (!paint.imageHash) return null;

  const image = figma.getImageByHash(paint.imageHash);
  if (!image) return null;

  const [bytes, size] = await Promise.all([image.getBytesAsync(), image.getSizeAsync()]);
  const mimeType = detectMime(bytes);
  if (!mimeType) return null;

  const boxW = rect.width;
  const boxH = rect.height;
  const img = { width: size.width, height: size.height };

  let sizing: IRImageSizing;
  if (mode === 'cover') {
    sizing = { mode: 'cover', srcRect: coverSrcRect(img, boxW, boxH) };
  } else if (mode === 'contain') {
    const fit = containFit(img, boxW, boxH);
    sizing = { mode: 'contain', fitWidth: fit.w, fitHeight: fit.h };
  } else if (mode === 'tile') {
    const scale = tileScale((paint as ImagePaint).scalingFactor);
    // scalingFactor > 1 (upscaled tile) cannot be a native <a:tile> ratio → rasterize.
    if (!scale) return null;
    sizing = { mode: 'tile', ...scale };
  } else {
    // CROP: imageTransform is unit-space (container→image), not Figma px.
    const t = paint.imageTransform;
    if (!t) return null;
    const srcRect = cropSrcRect(img, boxW, boxH, {
      a: t[0][0],
      b: t[0][1],
      c: t[0][2],
      d: t[1][0],
      e: t[1][1],
      f: t[1][2],
    });
    if (!srcRect) return null; // rotated/sheared/empty-space crop → rasterize
    sizing = { mode: 'crop', srcRect };
  }

  // Preserve RECTANGLE corner clip on the native pic (was dropped → square PPT).
  // Scale local radii into absolute box; inherit larger clip from clipping parent.
  const cornerRadii = effectiveImageCornerRadii(node as RectangleNode, boxW, boxH);
  const cornerSmoothing =
    'cornerSmoothing' in node && typeof (node as RectangleNode).cornerSmoothing === 'number'
      ? (node as RectangleNode).cornerSmoothing
      : 0;

  return {
    id: node.id,
    type: 'image',
    rect,
    rotation: 0,
    opacity: combineLeafOpacity(
      combineLeafOpacity(inheritedOpacity, nodeOpacityOf(node)),
      paintOpacity(paint)
    ),
    zIndex,
    data: figma.base64Encode(bytes),
    mimeType,
    sizing,
    ...(cornerRadii
      ? { cornerRadii, cornerSmoothing, cornerSource: 'node' as const }
      : {}),
  };
}

function readLine(node: LineNode, rect: Rect, zIndex: number, inheritedOpacity = 1): IRLine {
  const strokeFill = topSolidFill(resolvedPaints(node.strokes));
  const color = strokeFill?.color ?? '#000000';
  return {
    id: node.id,
    type: 'line',
    rect,
    rotation: 0,
    opacity: combineLeafOpacity(
      combineLeafOpacity(inheritedOpacity, nodeOpacityOf(node)),
      strokeFill?.opacity ?? 1
    ),
    zIndex,
    color,
    weight: typeof node.strokeWeight === 'number' ? node.strokeWeight : 1,
  };
}

interface Counter {
  value: number;
}

/**
 * Rasterize a set of nodes to a single localized PNG (Figma renders them
 * exactly) without degrading anything outside the set. Uses a temporary group
 * on the page, then removes it.
 *
 * Placement uses the group's measured render/AABB box after grouping so a
 * clipped mask export is not stretched into the unclipped AABB union.
 */
async function exportNodesToImage(
  nodes: SceneNode[],
  rootFrame: FrameNode,
  zIndex: number,
  idPrefix: string
): Promise<IRImage | null> {
  const boxes = nodes
    .map((n) => boxOf(n))
    .filter((b): b is Box => b !== null)
    .map((b) => ({ x: b.x, y: b.y, width: b.width, height: b.height }));
  const unclipped = relativeBounds(unionRect(boxes), boxOf(rootFrame));

  const clones = nodes.map((n) => n.clone());
  let group: GroupNode;
  try {
    for (const c of clones) figma.currentPage.appendChild(c);
    group = figma.group(clones, figma.currentPage);
  } catch {
    for (const c of clones) if (c.parent) c.remove();
    return null;
  }

  try {
    const bytes = await group.exportAsync({
      format: 'PNG',
      constraint: { type: 'SCALE', value: IMAGE_SCALE },
    });
    const measured = relativeBounds(renderBoxOf(group), boxOf(rootFrame));
    const png = pngPixelSize(bytes);
    const preferred = chooseExportPlacement(unclipped, measured);
    if (!preferred) return null;
    const rect = imagePlacementRect({
      aabb: unclipped,
      render: measured,
      frame: { width: rootFrame.width, height: rootFrame.height },
      pngWidthPx: png?.width,
      pngHeightPx: png?.height,
    });
    return {
      id: `${idPrefix}${nodes[0].id}`,
      type: 'image',
      rect,
      rotation: 0,
      opacity: 1,
      zIndex,
      data: figma.base64Encode(bytes),
      mimeType: 'image/png',
    };
  } finally {
    group.remove();
  }
}

function pushReport(
  report: IRReportEntry[],
  nodes: SceneNode[],
  tier: IRReportEntry['tier'],
  reason: string
): void {
  for (const n of nodes) {
    report.push({ nodeId: n.id, nodeName: n.name, nodeType: n.type, tier, reason });
  }
}

function pushRasterizedTextDescendants(
  report: IRReportEntry[],
  nodes: readonly SceneNode[],
  reason: string
): void {
  report.push(...rasterizedTextDescendantEntries(nodes, reason));
}

/**
 * Build the native element that reproduces a mask clip: a picture (rect mask)
 * or a "picture shape" (ellipse/roundRect/star/polygon mask) filled by the
 * rasterized content, so the clip geometry stays editable and only the content
 * is flattened.
 */
function maskPictureElement(
  mask: SceneNode,
  maskBox: Rect,
  contentImage: IRImage,
  srcRect: IRPictureShape['srcRect'],
  shapeKind: 'rect' | 'roundRect' | 'ellipse' | 'star' | 'polygon',
  zIndex: number
): IRElement {
  if (shapeKind === 'rect') {
    return {
      id: `mask:${mask.id}`,
      type: 'image',
      rect: maskBox,
      rotation: 0,
      opacity: 1,
      zIndex,
      data: contentImage.data,
      mimeType: contentImage.mimeType,
      ...(srcRect ? { sizing: { mode: 'crop', srcRect } as IRImageSizing } : {}),
    };
  }

  const ps: IRPictureShape = {
    id: `mask:${mask.id}`,
    type: 'pictureShape',
    rect: maskBox,
    rotation: 0,
    opacity: 1,
    zIndex,
    shapeKind,
    cornerRadii: null,
    data: contentImage.data,
    mimeType: contentImage.mimeType,
    srcRect,
  };

  if (shapeKind === 'roundRect' && mask.type === 'RECTANGLE') {
    ps.cornerRadii = readRectCornerRadii(mask as RectangleNode, maskBox.width, maskBox.height);
  } else if (shapeKind === 'star' || shapeKind === 'polygon') {
    const path = readVectorPath(mask as SceneNode & GeometryMixin);
    if (path) ps.path = path;
    if (mask.type === 'STAR') {
      ps.pointCount = (mask as StarNode).pointCount;
      ps.innerRadius = (mask as StarNode).innerRadius;
    } else if (mask.type === 'POLYGON') {
      ps.pointCount = (mask as PolygonNode).pointCount;
    }
  }

  return ps;
}

/**
 * Export a mask+content segment as one localized PNG. Never splits the mask
 * from its non-text content (that produces the "red rectangle logo" / broken
 * penguin failure mode). Reports explicitly when export fails.
 */
async function rasterizeMaskSegment(
  nodes: SceneNode[],
  rootFrame: FrameNode,
  counter: Counter,
  elements: IRElement[],
  report: IRReportEntry[],
  reason: string,
  inheritedOpacity = 1
): Promise<boolean> {
  const zIndex = counter.value++;
  const img = await exportNodesToImage(nodes, rootFrame, zIndex, 'mask:');
  if (img) {
    // PNG already includes each node's own opacity; only apply ancestor opacity.
    img.opacity = combineLeafOpacity(inheritedOpacity, img.opacity);
    elements.push(img);
    pushReport(report, nodes, 'png', reason);
    pushRasterizedTextDescendants(report, nodes, reason);
    return true;
  }
  // Do NOT fall back to per-node rasterization — that unclips the mask.
  pushReport(report, nodes, 'png', `${reason}; export failed (segment kept together, not emitted)`);
  pushRasterizedTextDescendants(
    report,
    nodes,
    `${reason}; export failed (segment kept together, not emitted)`
  );
  return false;
}

function isMaskSceneNode(node: SceneNode): boolean {
  return 'isMask' in node && Boolean((node as BlendMixin).isMask);
}

/**
 * Mask+media stay one PNG; direct TEXT siblings are peeled and kept native so
 * Auto Layout avatar+quote rows remain editable (not one flattened PNG).
 */
async function emitMaskedSegment(
  nodes: SceneNode[],
  rootFrame: FrameNode,
  counter: Counter,
  elements: IRElement[],
  report: IRReportEntry[],
  reason: string,
  inheritedOpacity: number,
  strategy: ExportStrategy,
  containerContext?: IRText['containerContext']
): Promise<void> {
  const texts = nodes.filter((n): n is TextNode => n.type === 'TEXT');
  const visual = nodes.filter((n) => n.type !== 'TEXT');

  if (texts.length > 0 && visual.length > 0) {
    const visualHasContent = visual.some((n) => !isMaskSceneNode(n));
    if (visualHasContent) {
      await rasterizeMaskSegment(
        visual,
        rootFrame,
        counter,
        elements,
        report,
        `${reason}; text peeled for editability`,
        inheritedOpacity
      );
    } else {
      pushReport(report, visual, 'native', 'mask without non-text content after text peel');
    }
    const ctx: IRText['containerContext'] = containerContext ?? {
      parentId: rootFrame.id,
      parentType: rootFrame.type,
      clipsContent: false,
      insideMaskSegment: false,
    };
    for (const text of texts) {
      await traverse(text, rootFrame, counter, elements, report, inheritedOpacity, strategy, {
        ...ctx,
        insideMaskSegment: false,
      });
    }
    return;
  }

  await rasterizeMaskSegment(
    nodes,
    rootFrame,
    counter,
    elements,
    report,
    reason,
    inheritedOpacity
  );
}

async function handleMaskSegment(
  nodes: SceneNode[],
  rootFrame: FrameNode,
  counter: Counter,
  elements: IRElement[],
  report: IRReportEntry[],
  inheritedOpacity = 1,
  strategy: ExportStrategy = 'editable'
): Promise<void> {
  const mask = nodes[0];
  const content = nodes.slice(1);

  // A lone mask with nothing to mask renders nothing.
  if (content.length === 0) {
    report.push({
      nodeId: mask.id,
      nodeName: mask.name,
      nodeType: mask.type,
      tier: 'native',
      reason: 'mask without content',
    });
    return;
  }

  const maskBox = relativeBounds(boxOf(mask), boxOf(rootFrame));
  const contentBoxes = content
    .map((n) => boxOf(n))
    .filter((b): b is Box => b !== null);
  const contentBox = relativeBounds(unionRect(contentBoxes), boxOf(rootFrame));

  const hasCornerRadii =
    mask.type === 'RECTANGLE' &&
    readRectCornerRadii(mask as RectangleNode, maskBox?.width ?? 0, maskBox?.height ?? 0) !== null;

  const hasCompoundVector =
    (mask.type === 'STAR' || mask.type === 'POLYGON') &&
    hasCompoundVectorPath(mask as SceneNode & GeometryMixin);

  const contentHasNestedMask = content.some((n) => nodeHasNestedMask(n));
  const contentHasComplexType = content.some((n) => isComplexContentType(n.type));
  const figmaMaskType =
    'maskType' in mask ? String((mask as BlendMixin).maskType) : 'ALPHA';

  const decision = decideMask({
    maskType: mask.type,
    maskBox,
    contentBox,
    hasCornerRadii,
    hasCompoundVector,
    figmaMaskType,
    contentCount: content.length,
    contentHasNestedMask,
    contentHasComplexType,
  });

  if (decision.kind === 'drop') {
    pushReport(report, nodes, 'native', 'mask clips all content away');
    return;
  }

  if (decision.kind === 'no-op') {
    // The mask clips nothing; emit the content natively.
    report.push({ nodeId: mask.id, nodeName: mask.name, nodeType: mask.type, tier: 'native', reason: 'mask (no-op)' });
    for (const child of content) {
      await traverse(child, rootFrame, counter, elements, report, inheritedOpacity, strategy);
    }
    return;
  }

  if (decision.kind === 'png') {
    await rasterizeMaskSegment(
      nodes,
      rootFrame,
      counter,
      elements,
      report,
      'mask (local PNG — complex/unsupported clip kept intact)',
      inheritedOpacity
    );
    return;
  }

  // Native picture-shape: rasterize only the content, keep the mask geometry.
  if (!maskBox || !contentBox) {
    await rasterizeMaskSegment(
      nodes,
      rootFrame,
      counter,
      elements,
      report,
      'mask (no measurable bounds → local PNG)',
      inheritedOpacity
    );
    return;
  }

  const zIndex = counter.value++;
  const contentImage = await exportNodesToImage(content, rootFrame, zIndex, 'mask-content:');
  if (!contentImage) {
    // Fall back to the full-segment raster (still one object — never split).
    await rasterizeMaskSegment(
      nodes,
      rootFrame,
      counter,
      elements,
      report,
      'mask (content export failed → local PNG)',
      inheritedOpacity
    );
    return;
  }

  contentImage.opacity = combineLeafOpacity(inheritedOpacity, contentImage.opacity);
  const tier = decision.shapeKind === 'rect' || decision.shapeKind === 'ellipse' ? 'native' : 'ooxml';
  const pic = maskPictureElement(mask, maskBox, contentImage, decision.srcRect, decision.shapeKind, zIndex);
  pic.opacity = contentImage.opacity;
  elements.push(pic);
  pushReport(report, [mask], tier, 'mask (native clip geometry)');
  pushReport(report, content, 'png', 'mask content rasterized inside native clip');
  pushRasterizedTextDescendants(
    report,
    content,
    'mask content rasterized inside native clip'
  );
}

async function traverse(
  node: SceneNode,
  rootFrame: FrameNode,
  counter: Counter,
  elements: IRElement[],
  report: IRReportEntry[],
  inheritedOpacity = 1,
  strategy: ExportStrategy = 'editable',
  containerContext?: IRText['containerContext']
): Promise<void> {
  if ('visible' in node && node.visible === false) return;

  const rect = relativeBounds(boxOf(node), boxOf(rootFrame));
  if (!rect) return;

  const zIndex = counter.value++;
  const selfOpacity = nodeOpacityOf(node);

  // Multi-child container with its own opacity: Figma composites the flattened
  // group. Do NOT multiply opacity onto each child (overlap would be wrong).
  // Editable + TEXT: prefer recurse (avatar/quote rows stay editable); sibling
  // overlap opacity may differ slightly from Figma.
  if (
    isContainerType(node.type) &&
    'children' in node &&
    shouldRasterizeForGroupOpacity(selfOpacity, node.children.length) &&
    !(strategy === 'editable' && sceneSubtreeHasText(node))
  ) {
    report.push({
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      tier: 'png',
      reason: 'group opacity with multiple children',
    });
    pushRasterizedTextDescendants(
      report,
      [node],
      'group opacity with multiple children'
    );
    elements.push(await readImage(node, rect, zIndex, inheritedOpacity, rootFrame));
    return;
  }

  // Single-child (or leaf) path: opacity may be multiplied onto the descendant.
  const childInherited = combineLeafOpacity(inheritedOpacity, selfOpacity);

  if (node.type === 'TEXT') {
    const textNode = node as TextNode;
    const rootBox = boxOf(rootFrame);
    const transformed = rootBox
      ? transformedTextRect(
          textNode.width,
          textNode.height,
          textNode.absoluteTransform,
          rootBox
        )
      : {
          rect,
          rotation: textNode.rotation,
          flipH: false,
          flipV: false,
          skewed: false,
        };
    // readText applies node.opacity again — pass inherited only (not self).
    const text = await readText(
      textNode,
      transformed.rect,
      relativeBounds(renderBoxOf(textNode), rootBox) ?? undefined,
      zIndex,
      inheritedOpacity,
      transformed.rotation,
      transformed.flipH,
      transformed.flipV,
      containerContext
    );
    if (transformed.skewed) {
      const reason = 'text affine shear unsupported by native PowerPoint text shape';
      report.push({
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        tier: 'png',
        reason,
      });
      elements.push(await readImage(node, rect, zIndex, inheritedOpacity, rootFrame));
      return;
    }
    const textDecision = decideMixedLineHeightRender(text, strategy);
    if (textDecision.kind === 'image') {
      report.push({
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        tier: 'png',
        reason: textDecision.reason,
      });
      elements.push(await readImage(node, rect, zIndex, inheritedOpacity, rootFrame));
    } else {
      const reasons = [
        textDecision.kind === 'split'
          ? 'mixed line-height split into editable visual-line text boxes'
          : textDecision.reason,
        text.paragraphs?.some((paragraph) => paragraph.leadingTrim === 'CAP_HEIGHT')
          ? 'leadingTrim=CAP_HEIGHT has no DrawingML equivalent; soft-break lnSpc preserves row spacing — verify cap-top flush vs Figma'
          : undefined,
        text.leadingTrimMixed
          ? 'mixed leadingTrim cannot be segmented by Figma Plugin API; visual verification required'
          : undefined,
        text.hasMissingFont
          ? 'Figma reports a missing source font; PowerPoint substitution and baseline drift are possible'
          : undefined,
        text.textCase === 'LOWER' || text.textCase === 'TITLE'
          ? `textCase=${text.textCase} has no DrawingML cap; characters transformed for visual match`
          : text.textCase === 'MIXED'
            ? 'mixed textCase: per-run cap/transform applied where possible'
            : undefined,
        text.visualLineStatus !== 'exact'
          ? `Figma SVG baseline diagnostics unavailable: ${text.visualLineReason ?? text.visualLineStatus ?? 'unknown'}`
          : undefined,
      ].filter((reason): reason is string => reason !== undefined);
      report.push({
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        tier: 'native',
        reason: reasons.length > 0 ? reasons.join('; ') : undefined,
      });
      elements.push(text);
    }
    return;
  }

  if (node.type === 'LINE') {
    const line = node as LineNode;
    const weight = typeof line.strokeWeight === 'number' ? line.strokeWeight : 1;
    const orientation = classifyLine(rect.width, rect.height, weight);
    if (orientation !== 'diagonal') {
      report.push({ nodeId: node.id, nodeName: node.name, nodeType: node.type, tier: 'native' });
      elements.push(readLine(line, rect, zIndex, inheritedOpacity));
    } else {
      report.push({
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        tier: 'png',
        reason: 'diagonal line',
      });
      elements.push(await readImage(node, rect, zIndex, inheritedOpacity, rootFrame));
    }
    return;
  }

  // Native picture object for a clean image fill (FILL/FIT/CROP).
  const imageFill = await tryReadImageFill(node, rect, zIndex, inheritedOpacity);
  if (imageFill) {
    report.push({ nodeId: node.id, nodeName: node.name, nodeType: node.type, tier: 'native' });
    elements.push(imageFill);
    return;
  }

  // Mask groups / multi-child illustrations / clip frames are decided in
  // decideFallback (whole local PNG). Do NOT surgically demask — that splits
  // clip from content. Enrich NodeDesc with overflow for clipsContent rules.
  const desc = describeNode(node);
  if (
    desc.clipsContent &&
    (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') &&
    'children' in node
  ) {
    const parentBox = boxOf(node);
    if (parentBox) {
      const childBoxes: Box[] = [];
      for (const c of node.children) {
        const b = boxOf(c);
        if (b) childBoxes.push(b);
      }
      desc.childrenOverflow = childrenOverflowParent(parentBox, childBoxes);
    }
  }

  const decision = decideFallback(desc, strategy);

  if (decision.strategy === 'image') {
    report.push({
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      tier: 'png',
      reason: decision.reason,
    });
    pushRasterizedTextDescendants(
      report,
      [node],
      decision.reason ?? 'container rasterized by compatibility decision'
    );
    elements.push(await readImage(node, rect, zIndex, inheritedOpacity, rootFrame));
    return;
  }

  if (node.type === 'RECTANGLE' || node.type === 'ELLIPSE') {
    const shape = readShape(
      node as SceneNode & GeometryMixin,
      rect,
      zIndex,
      inheritedOpacity
    );
    if (shape) {
      report.push({ nodeId: node.id, nodeName: node.name, nodeType: node.type, tier: 'native' });
      elements.push(shape);
    } else {
      report.push({
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        tier: 'native',
        reason: 'empty shape (no visible fill/stroke)',
      });
    }
    return;
  }

  if (isContainerType(node.type) && 'children' in node) {
    // Layout frames: paint fill/stroke chrome first (behind children), then
    // recurse. Prevents bordered cards from losing their box when children
    // stay native/editable, and lets overflowing mascots sit outside the box.
    if (isLayoutFrameType(node.type)) {
      const chrome = readFrameChrome(
        node as FrameNode | ComponentNode | InstanceNode,
        rect,
        zIndex,
        inheritedOpacity
      );
      if (chrome) {
        report.push({
          nodeId: node.id,
          nodeName: node.name,
          nodeType: node.type,
          tier: 'native',
          reason: 'frame chrome (fill/stroke)',
        });
        elements.push(chrome);
      }
    }

    // Always partition masks inside containers (not only the root slide frame)
    // so circular avatars / clipped images stay intact without flattening the
    // entire card (which would clip intentional overflow and kill editability).
    for (const seg of partitionChildren(node.children)) {
      const childContext: IRText['containerContext'] = {
        parentId: node.id,
        parentType: node.type,
        clipsContent:
          'clipsContent' in node ? Boolean((node as FrameNode).clipsContent) : false,
        insideMaskSegment: false,
      };
      if (seg.kind === 'masked') {
        await emitMaskedSegment(
          seg.nodes,
          rootFrame,
          counter,
          elements,
          report,
          'nested mask segment (local PNG, intact)',
          childInherited,
          strategy,
          childContext
        );
      } else {
        for (const child of seg.nodes) {
          await traverse(
            child,
            rootFrame,
            counter,
            elements,
            report,
            childInherited,
            strategy,
            childContext
          );
        }
      }
    }
    return;
  }

  // Unknown-but-native types that slipped through compat → rasterize.
  report.push({
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    tier: 'png',
    reason: 'unhandled type',
  });
  elements.push(await readImage(node, rect, zIndex, inheritedOpacity, rootFrame));
}

/**
 * Visual-fidelity page: one Figma 2× PNG of this frame, same as Export at 2× PNG.
 * The bitmap already includes rotation and layer opacity, so the picture is
 * placed upright at full opacity. The box is the frame size, or the
 * axis-aligned bounds after rotation.
 */
function fidelityFrameSize(frame: FrameNode): { width: number; height: number } {
  const turned = Math.abs(frame.rotation) > 1e-6;
  const bounds = turned ? boxOf(frame) : null;
  return {
    width: bounds && bounds.width > 0 ? bounds.width : frame.width,
    height: bounds && bounds.height > 0 ? bounds.height : frame.height,
  };
}

async function readFidelitySlide(frame: FrameNode, report: IRReportEntry[]): Promise<IRSlide> {
  const size = fidelityFrameSize(frame);
  const backgroundColor = topSolidFillColor(resolvedPaints(frame.fills)) ?? '#FFFFFF';
  const slide = {
    id: frame.id,
    name: frame.name,
    width: size.width,
    height: size.height,
    backgroundColor,
  };
  try {
    const bytes = await frame.exportAsync({
      format: 'PNG',
      constraint: { type: 'SCALE', value: IMAGE_SCALE },
      contentsOnly: true,
    });
    const image: IRImage = {
      id: frame.id,
      type: 'image',
      rect: { x: 0, y: 0, width: size.width, height: size.height },
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      data: figma.base64Encode(bytes),
      mimeType: 'image/png',
    };
    return { ...slide, elements: [image] };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'export failed';
    pushReport(report, [frame], 'png', `frame export failed (${detail})`);
    return { ...slide, elements: [] };
  }
}

async function readSlide(
  frame: FrameNode,
  report: IRReportEntry[],
  strategy: ExportStrategy
): Promise<IRSlide> {
  if (strategy === 'fidelity') return readFidelitySlide(frame, report);
  await preloadFrameFonts(frame);
  const elements: IRElement[] = [];
  const counter: Counter = { value: 0 };
  // Frame-level masks: always keep mask+content as one local PNG (never
  // demask into native shapes). Plain siblings stay independently convertible.
  for (const seg of partitionChildren(frame.children)) {
    const slideContext: IRText['containerContext'] = {
      parentId: frame.id,
      parentType: frame.type,
      clipsContent: frame.clipsContent,
      insideMaskSegment: false,
    };
    if (seg.kind === 'masked') {
      await emitMaskedSegment(
        seg.nodes,
        frame,
        counter,
        elements,
        report,
        'frame-level mask group (local PNG, intact)',
        1,
        strategy,
        slideContext
      );
    } else {
      for (const child of seg.nodes) {
        await traverse(child, frame, counter, elements, report, 1, strategy, slideContext);
      }
    }
  }
  return {
    id: frame.id,
    name: frame.name,
    width: frame.width,
    height: frame.height,
    backgroundColor: topSolidFillColor(resolvedPaints(frame.fills)) ?? '#FFFFFF',
    // Frame layer opacity stays on the veil that covers the images. It is not
    // flattened into the opaque slide background, and it is not pushed onto text.
    // Drop bare solid edge strips that sit on top of screenshots and hide
    // footer/header artwork already present in the bitmap (Path C occlusion).
    // Align inset screen rasters to sibling browser-chrome width (device
    // mockups). Then drop fully covered co-located images so a JPEG+PNG stack
    // of one phone screenshot does not ghost in PPT.
    elements: dropOccludedCoLocatedImages(
      alignScreenRasterToChrome(
        dropImageEdgeCoverShapes(
          applyRootCoverOpacity(
            elements,
            { width: frame.width, height: frame.height },
            nodeOpacityOf(frame)
          )
        )
      )
    ),
  };
}

export async function readDocument(
  selection: readonly SceneNode[],
  options?: Pick<ExportOptions, 'strategy'>
): Promise<IRDocument> {
  const strategy: ExportStrategy = options?.strategy ?? 'editable';
  // Page order is fixed here (natural name sort) before any slide work.
  // Slots are filled by export index — never by task completion time.
  const frames = sortFramesByName(
    selection.filter((n): n is FrameNode => n.type === 'FRAME')
  );
  const slides: IRSlide[] = new Array(frames.length);
  const report: IRReportEntry[] = [];

  for (let exportIndex = 0; exportIndex < frames.length; exportIndex++) {
    slides[exportIndex] = await readSlide(frames[exportIndex], report, strategy);
  }

  const doc: IRDocument = { slides, report: { entries: report } };
  doc.report.summary = summarizeQuality(doc, strategy);
  return doc;
}
