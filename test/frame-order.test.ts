import { describe, it, expect } from 'vitest';
import {
  compareNaturalFrameNames,
  frameExportOrderLines,
  naturalNameTokens,
  sortFramesByName,
} from '../src/reader/frame-order';

describe('naturalNameTokens', () => {
  it('splits digits and text, including multiple number spans', () => {
    expect(naturalNameTokens('0-10')).toEqual([0, '-', 10]);
    expect(naturalNameTokens('page-2-item-10')).toEqual(['page-', 2, '-item-', 10]);
  });

  it('trims for the comparison key without renaming the source', () => {
    expect(naturalNameTokens('  0-2  ')).toEqual([0, '-', 2]);
  });
});

describe('compareNaturalFrameNames / sortFramesByName', () => {
  it('orders 0-1 … 0-11 by numeric value, not lexicographic string order', () => {
    const shuffled = ['0-10', '0-2', '0-1', '0-11', '0-3'].map((name, i) => ({
      id: `id-${i}`,
      name,
    }));
    expect(sortFramesByName(shuffled).map((f) => f.name)).toEqual([
      '0-1',
      '0-2',
      '0-3',
      '0-10',
      '0-11',
    ]);
  });

  it('ignores selection order: any shuffle yields the same page order', () => {
    const names = ['0-11', '0-1', '0-10', '0-3', '0-2'];
    const a = sortFramesByName(names.map((name, i) => ({ id: `a${i}`, name })));
    const b = sortFramesByName(
      [...names].reverse().map((name, i) => ({ id: `b${i}`, name }))
    );
    expect(a.map((f) => f.name)).toEqual(b.map((f) => f.name));
    expect(a.map((f) => f.name)).toEqual(['0-1', '0-2', '0-3', '0-10', '0-11']);
  });

  it('keeps relative order for identical names (stable, no drop)', () => {
    const frames = [
      { id: 'first', name: 'Cover' },
      { id: 'second', name: 'Cover' },
      { id: 'third', name: '0-1' },
    ];
    const ordered = sortFramesByName(frames);
    expect(ordered.map((f) => f.id)).toEqual(['third', 'first', 'second']);
    expect(ordered.filter((f) => f.name === 'Cover')).toHaveLength(2);
  });

  it('compares every numeric segment, not only the first', () => {
    const frames = [
      { id: 'a', name: 'sec-1-item-10' },
      { id: 'b', name: 'sec-1-item-2' },
      { id: 'c', name: 'sec-2-item-1' },
    ];
    expect(sortFramesByName(frames).map((f) => f.name)).toEqual([
      'sec-1-item-2',
      'sec-1-item-10',
      'sec-2-item-1',
    ]);
  });

  it('sorts only the provided export set (partial selection)', () => {
    const selected = [
      { id: 'x', name: '0-11' },
      { id: 'y', name: '0-2' },
    ];
    expect(sortFramesByName(selected).map((f) => f.name)).toEqual(['0-2', '0-11']);
  });

  it('uses Frame name, not in-frame title text', () => {
    // Same display title "Overview" inside both; Frame names differ.
    const frames = [
      { id: 'b', name: '0-10', titleText: 'Overview' },
      { id: 'a', name: '0-2', titleText: 'Overview' },
    ];
    expect(sortFramesByName(frames).map((f) => f.id)).toEqual(['a', 'b']);
  });

  it('does not mutate the input array or Frame names', () => {
    const frames = [
      { id: '1', name: '0-10' },
      { id: '2', name: '0-2' },
    ];
    const copy = frames.map((f) => ({ ...f }));
    const ordered = sortFramesByName(frames);
    expect(frames).toEqual(copy);
    expect(ordered[0].name).toBe('0-2');
    expect(frames[0].name).toBe('0-10');
  });
});

describe('export index binding (async completion order)', () => {
  it('assembles slides by fixed index even when tasks finish out of order', async () => {
    const frames = sortFramesByName([
      { id: 'slow', name: '0-1' },
      { id: 'fast', name: '0-2' },
      { id: 'mid', name: '0-10' },
    ]);
    // Simulate parallel work finishing as 0-10, then 0-2, then 0-1.
    const delayMs: Record<string, number> = { '0-1': 30, '0-2': 10, '0-10': 0 };
    const slots: Array<{ id: string; name: string } | undefined> = new Array(frames.length);

    await Promise.all(
      frames.map(async (frame, exportIndex) => {
        await new Promise((r) => setTimeout(r, delayMs[frame.name]));
        slots[exportIndex] = { id: frame.id, name: frame.name };
      })
    );

    expect(slots.map((s) => s!.name)).toEqual(['0-1', '0-2', '0-10']);
    expect(frameExportOrderLines(slots as { id: string; name: string }[])).toEqual([
      '1 → slow → 0-1',
      '2 → fast → 0-2',
      '3 → mid → 0-10',
    ]);
  });
});

describe('compareNaturalFrameNames edge', () => {
  it('treats equal keys as 0 so the stable index tie-break can apply', () => {
    expect(compareNaturalFrameNames('0-1', '0-1')).toBe(0);
    expect(compareNaturalFrameNames(' 0-1 ', '0-1')).toBe(0);
  });
});
