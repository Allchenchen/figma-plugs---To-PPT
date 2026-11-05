/**
 * Compatibility / fallback decision module.
 * Pure: takes a resolved `NodeDesc` (no figma global) and returns whether a
 * node should be rasterized to PNG or kept as a native PPT object.
 *
 * Alignment with FigDeck (code.js): containers (FRAME/GROUP/COMPONENT/INSTANCE)
 * ALWAYS recurse when the subtree has TEXT — never flatten a whole Auto Layout
 * / card just for effects, blendMode, or rotation. Only leaf complexity, mask
 * clusters without text, clip-overflow without text, and illustration packs
 * without text become local PNG.
 */

export type PaintDesc =
  | { type: 'SOLID'; visible: boolean }
  | { type: 'IMAGE'; visible: boolean }
  | { type: 'GRADIENT'; visible: boolean }
  | { type: 'OTHER'; visible: boolean };

export interface NodeDesc {
  type: string;
  visible?: boolean;
  blendMode?: string;
  fills?: PaintDesc[] | 'MIXED';
  strokes?: PaintDesc[] | 'MIXED';
  hasEffects?: boolean;
  rotation?: number;
  isMask?: boolean;
  maskType?: string;
  clipsContent?: boolean;
  childrenOverflow?: boolean;
  children?: NodeDesc[];
}

export interface FallbackDecision {
  strategy: 'native' | 'image';
  reason?: string;
}

/** Export mode: fidelity flattens more containers; editable prefers recurse. */
export type CompatMode = 'editable' | 'fidelity';

const COMPLEX_TYPES = new Set([
  'VECTOR',
  'BOOLEAN_OPERATION',
  'STAR',
  'POLYGON',
]);

const CONTAINER_TYPES = new Set([
  'FRAME',
  'GROUP',
  'COMPONENT',
  'INSTANCE',
  'SECTION',
]);

const LAYOUT_FRAME_TYPES = new Set(['FRAME', 'COMPONENT', 'INSTANCE']);

export function isContainerType(type: string): boolean {
  return CONTAINER_TYPES.has(type);
}

export function isLayoutFrameType(type: string): boolean {
  return LAYOUT_FRAME_TYPES.has(type);
}

export function isNativeShapeType(type: string): boolean {
  return type === 'RECTANGLE' || type === 'ELLIPSE';
}

export function nodeHasMask(node: NodeDesc): boolean {
  if (node.isMask) return true;
  if (!node.children) return false;
  return node.children.some(nodeHasMask);
}

export function subtreeHasText(node: NodeDesc): boolean {
  if (node.type === 'TEXT') return true;
  if (!node.children) return false;
  return node.children.some(subtreeHasText);
}

function isComplexVisualType(type: string): boolean {
  return COMPLEX_TYPES.has(type);
}

/** Every leaf is vector-like and there is no TEXT (illustration pack). */
export function subtreeIsIllustrationOnly(node: NodeDesc): boolean {
  if (node.type === 'TEXT') return false;
  if (!node.children || node.children.length === 0) {
    return isComplexVisualType(node.type);
  }
  return node.children.every(subtreeIsIllustrationOnly);
}

export function hasFrameChrome(node: NodeDesc): boolean {
  if (!isLayoutFrameType(node.type)) return false;
  if (node.fills && node.fills !== 'MIXED') {
    if (node.fills.some((f) => f.visible !== false && f.type === 'SOLID')) return true;
  }
  if (node.strokes && node.strokes !== 'MIXED') {
    if (node.strokes.some((s) => s.visible !== false)) return true;
  }
  return false;
}

export function decideFallback(
  node: NodeDesc,
  mode: CompatMode = 'editable'
): FallbackDecision {
  if (node.type === 'TEXT') return { strategy: 'native' };

  // Text-bearing containers stay recursive so Auto Layout quotes/avatars remain
  // editable. Effects / blend / rotation on the container itself are dropped.
  const textBearingContainer = isContainerType(node.type) && subtreeHasText(node);

  if (node.blendMode && node.blendMode !== 'NORMAL' && node.blendMode !== 'PASS_THROUGH') {
    if (!textBearingContainer) {
      return { strategy: 'image', reason: `blendMode=${node.blendMode}` };
    }
  }

  if (COMPLEX_TYPES.has(node.type)) {
    return { strategy: 'image', reason: `complex type=${node.type}` };
  }

  if (node.rotation && node.rotation !== 0) {
    if (!textBearingContainer) {
      return { strategy: 'image', reason: 'rotation not yet supported natively' };
    }
  }

  if (node.hasEffects) {
    if (!textBearingContainer) {
      return { strategy: 'image', reason: 'effects present' };
    }
  }

  if (node.isMask) {
    return { strategy: 'image', reason: 'mask node' };
  }

  // Mask cluster GROUPs without TEXT stay one PNG. With TEXT, recurse so quotes
  // stay editable; mask+media still PNG via partitionChildren peel.
  if ((node.type === 'GROUP' || node.type === 'SECTION') && nodeHasMask(node)) {
    if (!subtreeHasText(node)) {
      return { strategy: 'image', reason: 'mask group (local PNG, intact)' };
    }
  }

  if (isLayoutFrameType(node.type) && node.clipsContent && node.childrenOverflow) {
    // editable + text: prefer recurse (clip may be imperfect). fidelity keeps PNG.
    if (!subtreeHasText(node) || mode === 'fidelity') {
      return { strategy: 'image', reason: 'clipsContent with overflow' };
    }
  }

  if (isLayoutFrameType(node.type) && node.fills && node.fills !== 'MIXED') {
    const visible = node.fills.filter((f) => f.visible !== false);
    if (visible.some((f) => f.type === 'IMAGE' || f.type === 'GRADIENT' || f.type === 'OTHER')) {
      return { strategy: 'image', reason: 'frame image/gradient fill' };
    }
    if (visible.length > 1) {
      return { strategy: 'image', reason: 'frame multiple fills' };
    }
  }

  // Fidelity mode: lock multi-child containers as one local PNG for pixel match.
  // Mask/clip rules above still win; never demask. Editable mode skips this.
  if (
    mode === 'fidelity' &&
    isContainerType(node.type) &&
    node.children &&
    node.children.length > 1 &&
    !subtreeHasText(node)
  ) {
    return { strategy: 'image', reason: 'fidelity: multi-child container' };
  }

  // Editable (FigDeck-aligned): only flatten illustration packs with no TEXT.
  if (
    mode === 'editable' &&
    isContainerType(node.type) &&
    node.children &&
    node.children.length > 1 &&
    !subtreeHasText(node) &&
    subtreeIsIllustrationOnly(node)
  ) {
    return { strategy: 'image', reason: 'illustration cluster (no text)' };
  }

  // Leaf fills: image/gradient → PNG (ellipse+image keeps circular clip).
  if (node.fills && node.fills !== 'MIXED' && node.fills.length > 0 && !isLayoutFrameType(node.type)) {
    const visible = node.fills.filter((f) => f.visible !== false);
    if (visible.some((f) => f.type === 'IMAGE' || f.type === 'GRADIENT' || f.type === 'OTHER')) {
      return { strategy: 'image', reason: 'image/gradient/complex fill' };
    }
    if (visible.length > 1) {
      return { strategy: 'image', reason: 'multiple fills' };
    }
  }

  if (node.strokes && node.strokes !== 'MIXED' && node.strokes.some((s) => s.visible !== false)) {
    if (!isNativeShapeType(node.type) && !isLayoutFrameType(node.type)) {
      return { strategy: 'image', reason: 'stroke on non-native shape' };
    }
  }

  return { strategy: 'native' };
}

export function isNative(node: NodeDesc, mode: CompatMode = 'editable'): boolean {
  return decideFallback(node, mode).strategy === 'native';
}
