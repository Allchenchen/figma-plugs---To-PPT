import { describe, it, expect } from 'vitest';
import { summarizeQuality, formatQualityReport } from '../src/report/quality';
import type { IRDocument } from '../src/ir/types';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

function doc(partial: Partial<IRDocument['slides'][0]> & { elements: IRDocument['slides'][0]['elements'] }): IRDocument {
  return {
    slides: [
      {
        id: 's1',
        name: 'S',
        width: 1920,
        height: 1080,
        backgroundColor: '#000000',
        ...partial,
      },
    ],
    report: {
      entries: [
        { nodeId: '1', nodeName: 't', nodeType: 'TEXT', tier: 'native' },
        { nodeId: '2', nodeName: 'v', nodeType: 'VECTOR', tier: 'png', reason: 'complex type=VECTOR' },
      ],
    },
  };
}

describe('summarizeQuality', () => {
  it('counts native editable vs flattened raster separately', () => {
    const d = doc({
      elements: [
        {
          id: 't',
          type: 'text',
          rect: { x: 0, y: 0, width: 100, height: 40 },
          rotation: 0,
          opacity: 1,
          zIndex: 0,
          characters: 'Hi',
          fontSize: 16,
          fontFamily: 'Arial',
          fontWeight: 400,
          color: '#FFF',
          letterSpacing: 0,
          lineHeight: null,
          textAlignHorizontal: 'LEFT',
          textAlignVertical: 'TOP',
        },
        {
          id: 'img',
          type: 'image',
          rect: { x: 0, y: 0, width: 50, height: 50 },
          rotation: 0,
          opacity: 1,
          zIndex: 1,
          data: PNG,
          mimeType: 'image/png',
        },
      ],
    });
    const s = summarizeQuality(d, 'editable');
    expect(s.nativeEditableCount).toBe(1);
    expect(s.rasterObjectCount).toBe(1);
    expect(s.nativeEditableShare).toBeCloseTo(0.5);
    expect(s.tiers.png).toBe(1);
    expect(s.wholeSlideRasterSuspect).toBe(false);
  });

  it('flags near-full-bleed single raster as whole-slide suspect', () => {
    const d = doc({
      elements: [
        {
          id: 'full',
          type: 'image',
          rect: { x: 0, y: 0, width: 1920, height: 1080 },
          rotation: 0,
          opacity: 1,
          zIndex: 0,
          data: PNG,
          mimeType: 'image/png',
        },
      ],
    });
    expect(summarizeQuality(d).wholeSlideRasterSuspect).toBe(true);
  });

  it('does not count sized native pictures as raster', () => {
    const d = doc({
      elements: [
        {
          id: 'pic',
          type: 'image',
          rect: { x: 10, y: 10, width: 200, height: 200 },
          rotation: 0,
          opacity: 1,
          zIndex: 0,
          data: PNG,
          mimeType: 'image/png',
          sizing: { mode: 'cover', srcRect: { l: 0, r: 0, t: 0, b: 0 } },
        },
      ],
    });
    const s = summarizeQuality(d);
    expect(s.nativeEditableCount).toBe(1);
    expect(s.rasterObjectCount).toBe(0);
  });

  it('formatQualityReport includes dual sections', () => {
    const d = doc({
      elements: [
        {
          id: 't',
          type: 'text',
          rect: { x: 0, y: 0, width: 10, height: 10 },
          rotation: 0,
          opacity: 1,
          zIndex: 0,
          characters: 'a',
          fontSize: 12,
          fontFamily: 'Arial',
          fontWeight: 400,
          color: '#000',
          letterSpacing: 0,
          lineHeight: null,
          textAlignHorizontal: 'LEFT',
          textAlignVertical: 'TOP',
        },
      ],
    });
    const text = formatQualityReport(summarizeQuality(d, 'fidelity'), d.report.entries);
    expect(text).toContain('视觉一致优先');
    expect(text).toContain('原生可编辑性');
    expect(text).toContain('complex type=VECTOR');
  });
});
