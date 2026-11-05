import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readDocument } from '../src/reader/reader';

function installFigma(): void {
  (globalThis as unknown as { figma: unknown }).figma = {
    mixed: Symbol('mixed'),
    base64Encode: (bytes: Uint8Array) => Buffer.from(bytes).toString('base64'),
  };
}

function frame(partial: Record<string, unknown> = {}) {
  const exportAsync = vi.fn(async () => new Uint8Array([1, 2, 3, 4]));
  return {
    type: 'FRAME' as const,
    id: '1:1',
    name: 'O-1',
    width: 1920,
    height: 1080,
    rotation: 0,
    opacity: 0.4,
    fills: [{ type: 'SOLID' as const, visible: true, color: { r: 1, g: 0, b: 0 } }],
    absoluteBoundingBox: { x: 10, y: 20, width: 1920, height: 1080 },
    get children(): never[] {
      throw new Error('fidelity walked the layers');
    },
    ...partial,
    exportAsync: (partial.exportAsync as typeof exportAsync | undefined) ?? exportAsync,
  };
}

describe('visual fidelity exports one 2x image per frame', () => {
  beforeEach(() => installFigma());

  it('places a 2x PNG of the frame and does not walk its layers', async () => {
    const node = frame();
    const doc = await readDocument([node as never], { strategy: 'fidelity' });
    expect(node.exportAsync).toHaveBeenCalledTimes(1);
    expect(node.exportAsync).toHaveBeenCalledWith({
      format: 'PNG',
      constraint: { type: 'SCALE', value: 2 },
      contentsOnly: true,
    });
    expect(doc.slides).toHaveLength(1);
    expect(doc.slides[0]).toMatchObject({
      id: '1:1',
      name: 'O-1',
      width: 1920,
      height: 1080,
      backgroundColor: '#FF0000',
    });
    expect(doc.slides[0].elements).toEqual([
      {
        id: '1:1',
        type: 'image',
        rect: { x: 0, y: 0, width: 1920, height: 1080 },
        rotation: 0,
        opacity: 1,
        zIndex: 0,
        data: Buffer.from([1, 2, 3, 4]).toString('base64'),
        mimeType: 'image/png',
      },
    ]);
  });

  it('uses the rotated bounds and does not rotate the picture again', async () => {
    const node = frame({
      rotation: 90,
      absoluteBoundingBox: { x: 0, y: 0, width: 1080, height: 1920 },
    });
    const doc = await readDocument([node as never], { strategy: 'fidelity' });
    expect(doc.slides[0].width).toBe(1080);
    expect(doc.slides[0].height).toBe(1920);
    expect(doc.slides[0].elements[0]).toMatchObject({
      rect: { x: 0, y: 0, width: 1080, height: 1920 },
      rotation: 0,
      opacity: 1,
    });
  });

  it('reports a failed export once and does not retry at 1x', async () => {
    const exportAsync = vi.fn(async () => {
      throw new Error('too large');
    });
    const node = frame({ exportAsync });
    const doc = await readDocument([node as never], { strategy: 'fidelity' });
    expect(exportAsync).toHaveBeenCalledTimes(1);
    expect(doc.slides[0].elements).toEqual([]);
    expect(doc.report.entries[0].reason).toContain('export failed');
    expect(doc.report.entries[0].reason).toContain('too large');
  });

  it('leaves editable export on the layer path', async () => {
    const exportAsync = vi.fn();
    const node = frame({ children: [], exportAsync, fills: [] });
    const doc = await readDocument([node as never], { strategy: 'editable' });
    expect(exportAsync).not.toHaveBeenCalled();
    expect(doc.slides[0].elements).toEqual([]);
    expect(doc.slides[0].backgroundColor).toBe('#FFFFFF');
  });
});
