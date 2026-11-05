import type { NodeDesc, PaintDesc } from './compat';

function toPaintDesc(paint: Paint): PaintDesc {
  switch (paint.type) {
    case 'SOLID':
      return { type: 'SOLID', visible: paint.visible !== false };
    case 'IMAGE':
      return { type: 'IMAGE', visible: paint.visible !== false };
    case 'GRADIENT_LINEAR':
    case 'GRADIENT_RADIAL':
    case 'GRADIENT_ANGULAR':
    case 'GRADIENT_DIAMOND':
      return { type: 'GRADIENT', visible: paint.visible !== false };
    default:
      return { type: 'OTHER', visible: paint.visible !== false };
  }
}

function resolvePaints(
  paints: readonly Paint[] | PluginAPI['mixed']
): PaintDesc[] | 'MIXED' {
  if (paints === figma.mixed) return 'MIXED';
  return paints.map(toPaintDesc);
}

/**
 * Convert a Figma SceneNode into a serializable, figma-free `NodeDesc`
 * so the pure compatibility module can be unit-tested without a sandbox.
 */
export function describeNode(node: SceneNode): NodeDesc {
  const desc: NodeDesc = {
    type: node.type,
    visible: 'visible' in node ? node.visible : undefined,
  };

  if ('blendMode' in node) desc.blendMode = node.blendMode;
  if ('rotation' in node) desc.rotation = node.rotation;
  if ('isMask' in node) desc.isMask = node.isMask;
  if ('maskType' in node) desc.maskType = node.maskType;
  if ('clipsContent' in node) {
    desc.clipsContent = Boolean((node as FrameNode).clipsContent);
  }

  if ('fills' in node) {
    desc.fills = resolvePaints((node as GeometryMixin).fills);
  }
  if ('strokes' in node) {
    desc.strokes = resolvePaints((node as GeometryMixin).strokes);
  }
  if ('effects' in node) {
    desc.hasEffects = Array.isArray((node as BlendMixin).effects)
      ? (node as BlendMixin).effects.some((e) => e.visible !== false)
      : false;
  }
  if ('children' in node) {
    const children = (node as FrameNode | GroupNode | ComponentNode | InstanceNode | SectionNode)
      .children;
    desc.children = children.map(describeNode);
  }

  return desc;
}
