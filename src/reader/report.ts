import type { IRReportEntry } from '../ir/types';

export interface ReportNode {
  id: string;
  name: string;
  type: string;
  readonly children?: readonly ReportNode[];
}

/** Report each nested TextNode whose editability is lost inside a raster unit. */
export function rasterizedTextDescendantEntries(
  nodes: readonly ReportNode[],
  reason: string
): IRReportEntry[] {
  const entries: IRReportEntry[] = [];
  const visit = (node: ReportNode): void => {
    if (node.type === 'TEXT') {
      entries.push({
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        tier: 'png',
        reason: `${reason}; text embedded in rasterized container`,
      });
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of nodes) {
    for (const child of node.children ?? []) visit(child);
  }
  return entries;
}
