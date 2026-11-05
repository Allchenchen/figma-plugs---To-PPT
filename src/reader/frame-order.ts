/**
 * Export page order: sort frames by `frame.name` with natural numeric
 * comparison (not canvas position, not in-frame title text).
 *
 * Shared by the selection preview and `readDocument` so UI and PPTX use one
 * queue. Production code must not hard-code sample names.
 */

export interface NamedFrame {
  id: string;
  name: string;
}

/** Split a trimmed name into alternating text / number tokens. */
export function naturalNameTokens(name: string): Array<string | number> {
  const trimmed = name.trim();
  if (trimmed.length === 0) return [''];
  const parts = trimmed.match(/\d+|\D+/g);
  if (!parts) return [trimmed];
  return parts.map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

/**
 * Compare two Frame names for export order.
 * Numbers compare by value; non-digits use a fixed case-insensitive text order.
 * Returns 0 when keys are equal (caller supplies a stable index tie-break).
 */
export function compareNaturalFrameNames(a: string, b: string): number {
  const ta = naturalNameTokens(a);
  const tb = naturalNameTokens(b);
  const n = Math.max(ta.length, tb.length);
  for (let i = 0; i < n; i++) {
    if (i >= ta.length) return -1;
    if (i >= tb.length) return 1;
    const x = ta[i];
    const y = tb[i];
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x < y ? -1 : 1;
      continue;
    }
    if (typeof x === 'number') return -1; // number before text at same slot
    if (typeof y === 'number') return 1;
    const cmp = x.localeCompare(y, 'en', { sensitivity: 'base', numeric: false });
    if (cmp !== 0) return cmp;
  }
  return 0;
}

/**
 * Stable natural-name sort of the export candidate list.
 * Returns a new array; does not mutate `frames` or rename nodes.
 */
export function sortFramesByName<T extends NamedFrame>(frames: readonly T[]): T[] {
  return frames
    .map((frame, index) => ({ frame, index }))
    .sort((a, b) => {
      const byName = compareNaturalFrameNames(a.frame.name, b.frame.name);
      return byName !== 0 ? byName : a.index - b.index;
    })
    .map(({ frame }) => frame);
}

/** Diagnostic lines: `page → id → name` (1-based page index). */
export function frameExportOrderLines(frames: readonly NamedFrame[]): string[] {
  return frames.map((f, i) => `${i + 1} → ${f.id} → ${f.name}`);
}
