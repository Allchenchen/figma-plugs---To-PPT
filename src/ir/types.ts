/**
 * Intermediate Representation (IR)
 * Independent of the Figma Plugin API and PptxGenJS.
 *
 * Conventions:
 *  - coordinates/sizes are in Figma px, relative to the slide top-left corner
 *  - colors are `#RRGGBB` (uppercase hex)
 *  - rotation is clockwise degrees
 *  - opacity is 0..1
 *  - image data is base64 WITHOUT the `data:...;base64,` prefix
 */

export type ColorHex = string;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CornerRadii {
  tl: number;
  tr: number;
  br: number;
  bl: number;
}

export type IRDashStyle = 'solid' | 'dash' | 'dot';

export interface IRStroke {
  color: ColorHex;
  /** px */
  weight: number;
  /** FigDeck-compatible dash mapping from Figma `dashPattern`. */
  dash?: IRDashStyle;
}

/**
 * A crop rectangle expressed the way PowerPoint `<a:srcRect>` does:
 * fractions (in 1000ths of a percent, 0..100000) of the source image to
 * remove from each edge. `l`/`t` remove from the left/top, `r`/`b` from the
 * right/bottom.
 */
export interface SrcRect {
  l: number;
  r: number;
  t: number;
  b: number;
}

export type IRShapeKind = 'rect' | 'ellipse' | 'polygon' | 'star';

/**
 * A single Figma vector sub-path (from `GeometryMixin.fillGeometry` /
 * `vectorPaths`). `data` is an SVG path string using the M/L/Q/C/Z subset.
 */
export interface IRVectorPath {
  windingRule: 'NONZERO' | 'EVENODD' | 'NONE';
  data: string;
}

export interface IRBase {
  id: string;
  rect: Rect;
  /** clockwise degrees */
  rotation: number;
  /** 0..1 */
  opacity: number;
  /** paint order; lower = behind */
  zIndex: number;
}

/** Explicit break captured from Figma source characters (R-TXT-27). */
export type IRTextBoundaryKind = 'paragraphBreak' | 'softBreak';

export interface IRTextBoundary {
  /** Index of the normalized `\n` in `IRText.characters`. */
  index: number;
  /** UTF-16 index in the original Figma `node.characters` before normalization. */
  sourceIndex: number;
  /** 1 for most breaks; 2 for `\r\n`. */
  sourceLength: number;
  kind: IRTextBoundaryKind;
  /** Escaped source form for logs, e.g. `\\n`, `\\u2028`, `\\r\\n`. */
  sourceCharacter: string;
}

export interface IRText extends IRBase {
  type: 'text';
  characters: string;
  /**
   * Explicit paragraph / soft breaks from Figma source (or visual-wrap bake).
   * Indexes into normalized `characters`. Auto-wrap without a source mark is
   * NOT recorded here — that stays on `visualLines`.
   */
  boundaries?: IRTextBoundary[];
  /** px */
  fontSize: number;
  fontFamily: string;
  /** Original Figma font style name, e.g. Regular / Medium / Semibold. */
  fontStyle?: string;
  /** 100..900 */
  fontWeight: number;
  color: ColorHex;
  /** px */
  letterSpacing: number;
  /**
   * Absolute line height in px (null = Figma AUTO).
   * Prefer `lineHeightUnit` for PPT mapping — percent must not be collapsed
   * solely into Exact-pt spacing.
   */
  lineHeight: number | null;
  /** Preserved Figma unit so Normalizer can choose Multiple vs Exact. */
  lineHeightUnit?: 'AUTO' | 'MIXED' | 'PERCENT' | 'PIXELS';
  /** When unit is PERCENT, the raw Figma percent (e.g. 150). */
  lineHeightPercent?: number;
  /** px; null = no extra space between paragraphs (or mixed). */
  paragraphSpacing?: number | null;
  /** px; null means mixed paragraph indentation. */
  paragraphIndent?: number | null;
  /** Original Figma resizing semantics, retained for conservative PPT mapping. */
  textAutoResize?: 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE';
  /** Node-level case styling; mixed/range-level cases remain a reported limit. */
  textCase?: 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE' | 'SMALL_CAPS' | 'SMALL_CAPS_FORCED' | 'MIXED';
  textAlignHorizontal: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  textAlignVertical: 'TOP' | 'CENTER' | 'BOTTOM';
  underline?: boolean;
  strikethrough?: boolean;
  /**
   * Mixed rich-text runs (one per distinct style span). Present when the node
   * has more than one styled run; the flat fields above remain a single-style
   * summary used as the fallback and for paragraph-level metrics.
   */
  runs?: IRTextRun[];
  /** Logical paragraphs split on explicit newlines. */
  paragraphs?: IRTextParagraph[];
  /** Figma visual wrapping reconstructed from SVG text metadata. */
  visualLines?: IRTextVisualLine[];
  visualLineStatus?: 'exact' | 'unavailable' | 'mismatch';
  visualLineReason?: string;
  /**
   * When true, Figma SVG visual rows (≥2, exact) were baked into `\n` / soft breaks.
   * OOXML may set `wrap="none"` only after multiline structure is confirmed (R-TXT-25).
   */
  visualWrapLocked?: boolean;
  /** Figma SVG viewport used to interpret visual-line baseline coordinates. */
  sourceSvgViewBox?: Rect;
  /** Figma's rendered bounds relative to the exported root frame. */
  sourceRenderBounds?: Rect;
  /** True when Figma reports that at least one source font is unavailable. */
  hasMissingFont?: boolean;
  leadingTrimMixed?: boolean;
  /** Original cumulative affine transform retained for diagnostics. */
  transform?: { a: number; b: number; c: number; d: number; e: number; f: number };
  flipH?: boolean;
  flipV?: boolean;
  /** Container semantics; conversion still uses the same TextNode pipeline. */
  containerContext?: {
    parentId?: string;
    parentType?: string;
    clipsContent: boolean;
    insideMaskSegment: boolean;
  };
}

/** IRText is the text-box level of the text model. */
export type IRTextBox = IRText;

export type IRTextLineHeight =
  | { unit: 'AUTO' }
  | { unit: 'PERCENT'; value: number }
  | { unit: 'PIXELS'; value: number };

/** One color stop of a linear text fill, already mapped onto the text box. */
export interface IRTextGradientStop {
  /** 0..1 across the text box. 0 is the start of the in-box gradient segment. */
  position: number;
  color: ColorHex;
  /** 0..1. Includes the stop's own alpha. */
  opacity: number;
}

/**
 * Text fill gradient. `linear` uses `angle` (PowerPoint UI: 0° left-to-right,
 * clockwise). `radial` and `diamond` use `center` in this text box (0..1, may
 * lie outside). Absent `style` means linear.
 */
export interface IRTextLinearGradient {
  style?: 'linear' | 'radial' | 'diamond';
  angle: number;
  /** Radial center in the text box. */
  center?: { x: number; y: number };
  stops: IRTextGradientStop[];
}

/** A single styled span of text (font size / family / weight / color / spacing). */
export interface IRTextRun {
  /** UTF-16 offsets in the TextNode characters string. */
  start?: number;
  end?: number;
  text: string;
  /** px */
  fontSize: number;
  fontFamily: string;
  /** Original Figma style name; weight/italic remain separately normalized. */
  fontStyle?: string;
  /** 100..900 */
  fontWeight: number;
  color: ColorHex;
  /** px */
  letterSpacing: number;
  /**
   * Effective glyph opacity 0..1 for this span, computed once in the Reader as
   * `inherited(single-child) × node.opacity × paint.opacity` (see
   * `combineLeafOpacity` / `buildTextRuns`). Converter maps this to PptxGenJS
   * run `transparency` only — must not multiply the same sources again.
   * Absent / 1 = fully opaque. Layer-level `IRText.opacity` is the uniform
   * fallback when runs omit opacity (rich text keeps layer at 1).
   */
  opacity?: number;
  underline?: boolean;
  strikethrough?: boolean;
  italic?: boolean;
  textCase?: 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE' | 'SMALL_CAPS' | 'SMALL_CAPS_FORCED';
  /**
   * Linear gradient text fill for this span. Absent when the Figma fill is solid.
   * `color` stays the first stop so a host that drops the gradient still has a color.
   */
  fillGradient?: IRTextLinearGradient;
}

export interface IRTextParagraph {
  /** UTF-16 range excluding the terminating newline. */
  start: number;
  end: number;
  lineHeight: IRTextLineHeight | null;
  mixedLineHeight: boolean;
  paragraphSpacing: number | null;
  paragraphSpaceBefore?: number | null;
  paragraphIndent: number | null;
  textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  listType?: 'ORDERED' | 'UNORDERED' | 'NONE';
  listSpacing?: number | null;
  indentation?: number | null;
  leadingTrim?: 'CAP_HEIGHT' | 'NONE';
  /**
   * Kind of explicit break that ends this row (the `\n` at `end`).
   * Absent on the final row. Soft → prefer `<a:br/>`; paragraph → `<a:p>`
   * unless R-TXT-21 metric merge applies.
   */
  breakAfter?: IRTextBoundaryKind;
}

export interface IRTextVisualLine {
  /** UTF-16 range excluding explicit newline characters. */
  start: number;
  end: number;
  text: string;
  /** Coordinates within the exported TextNode SVG viewBox. */
  x: number;
  baselineY: number;
  paragraphIndex: number;
  /**
   * Measured baseline-to-baseline distance to the next visual line (px in SVG
   * space), when a following line exists. Never invented from font averages.
   */
  lineHeightPx?: number;
}

export interface IRShape extends IRBase {
  type: 'shape';
  shapeKind: IRShapeKind;
  /** Solid fill; `null` = no fill (stroke-only chrome, e.g. bordered Frame). */
  fill: ColorHex | null;
  stroke: IRStroke | null;
  /** px; rect only */
  cornerRadii: CornerRadii | null;
  /** polygon/star only */
  pointCount?: number;
  /** star only, 0..1 */
  innerRadius?: number;
  /**
   * Actual Figma vector path (STAR/POLYGON and edited vectors). When present
   * it takes precedence over `pointCount`/`innerRadius` regeneration.
   */
  path?: IRVectorPath[];
}

/** MIME of an embedded image (detected from magic bytes). */
export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

/**
 * How an IRImage's ORIGINAL bytes should be fitted into its box.
 * Absent = the bytes are a flattened PNG that already fills the rect exactly.
 *
 * `cover`/`crop` carry a PowerPoint `<a:srcRect>` (computed from the image's
 * natural size) that is injected during OOXML post-processing; `contain`
 * carries the letterboxed display size (the image is placed centered, uncropped);
 * `tile` carries the Figma TILE scaling (Figma `scalingFactor`) as PowerPoint
 * `<a:tile>` ratios, injected during post-processing.
 */
export type IRImageSizing =
  | { mode: 'cover'; srcRect: SrcRect }
  | { mode: 'contain'; fitWidth: number; fitHeight: number }
  | { mode: 'crop'; srcRect: SrcRect }
  | { mode: 'tile'; scaleX: number; scaleY: number };

export interface IRImage extends IRBase {
  type: 'image';
  /** base64 bytes, no data: prefix */
  data: string;
  mimeType: ImageMimeType;
  /** present when these are the original fill-image bytes (native image object) */
  sizing?: IRImageSizing;
  /**
   * Rounded clip of the RECTANGLE that owns the image fill (Figma px).
   * Applied in OOXML post-process as `prstGeom roundRect` (uniform, smooth=0)
   * or `custGeom` (independent / smoothed). Absent / null = square pic.
   */
  cornerRadii?: CornerRadii | null;
  /** Figma `cornerSmoothing` 0..1; >0 prefers custGeom over prstGeom. */
  cornerSmoothing?: number;
  /** Radii come from the image node itself (parent-clip rounding is out of scope). */
  cornerSource?: 'node';
}

/**
 * A picture clipped to a mask's geometry (the "picture shape" technique).
 * Produced for ellipse/round-rect/star/polygon masks so the clip geometry stays
 * an editable native shape while the content is a replaceable picture. For a
 * plain rectangular mask we instead emit a regular `IRImage` with a crop srcRect.
 */
export interface IRPictureShape extends IRBase {
  type: 'pictureShape';
  /** Clip geometry: `roundRect` uses `cornerRadii`; `star`/`polygon` use `path`. */
  shapeKind: 'ellipse' | 'roundRect' | 'star' | 'polygon';
  cornerRadii: CornerRadii | null;
  path?: IRVectorPath[];
  pointCount?: number;
  innerRadius?: number;
  /** base64 content bytes, no data: prefix */
  data: string;
  mimeType: ImageMimeType;
  /** crop aligning the content image into the mask box; null = fills exactly */
  srcRect: SrcRect | null;
}

export interface IRLine extends IRBase {
  type: 'line';
  /** line stroke color */
  color: ColorHex;
  /** px */
  weight: number;
}

export type IRElement = IRText | IRShape | IRImage | IRPictureShape | IRLine;

export interface IRSlide {
  id: string;
  name: string;
  /** px */
  width: number;
  height: number;
  backgroundColor: ColorHex;
  elements: IRElement[];
}

/** Three-tier conversion: native PPT → custom OOXML → local PNG fallback. */
export type RenderTier = 'native' | 'ooxml' | 'png';

export interface IRReportEntry {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  tier: RenderTier;
  reason?: string;
}

/** Dual quality summary: visual-structure accounting vs native editability. */
export interface IRQualitySummary {
  strategy: ExportStrategy;
  slideCount: number;
  /** Flattened IR objects placed on slides (not Figma node count). */
  irElementCount: number;
  byType: Partial<Record<IRElement['type'], number>>;
  tiers: { native: number; ooxml: number; png: number };
  /**
   * IR objects that remain independently editable in PPT:
   * text / shape / line / pictureShape / image-with-sizing (native picture).
   * Flattened PNG leaves (no sizing) count as raster, not editable content.
   */
  nativeEditableCount: number;
  rasterObjectCount: number;
  /** nativeEditableCount / irElementCount (0 when empty). */
  nativeEditableShare: number;
  /**
   * True when a slide looks like a near-full-bleed single raster
   * (discouraged whole-page screenshot pattern).
   */
  wholeSlideRasterSuspect: boolean;
  topReasons: { reason: string; count: number }[];
}

export interface IRReport {
  entries: IRReportEntry[];
  summary?: IRQualitySummary;
}

export interface IRDocument {
  slides: IRSlide[];
  report: IRReport;
}

// ---- postMessage protocol ----

export type ExportSizePreset = 'frame' | '16x9' | '4x3';
export type ExportStrategy = 'editable' | 'fidelity';

export interface ExportOptions {
  sizePreset: ExportSizePreset;
  strategy: ExportStrategy;
}

export type UIMessageToPlugin =
  | { type: 'export'; options: ExportOptions }
  | { type: 'cancel' };

export type PluginMessageToUI =
  | { type: 'selection'; count: number; names: string[] }
  | { type: 'progress'; message: string }
  | { type: 'document'; document: IRDocument }
  | { type: 'error'; message: string };
