import { describe, it, expect } from 'vitest';
import { dashStyleFromPattern, pptxDashType } from '../src/reader/dash';
import { shapeRender } from '../src/converter/shape';
import type { IRShape } from '../src/ir/types';

describe('dashStyleFromPattern (FigDeck heuristic)', () => {
  it('empty → solid', () => {
    expect(dashStyleFromPattern([])).toBe('solid');
    expect(dashStyleFromPattern(null)).toBe('solid');
    expect(dashStyleFromPattern(undefined)).toBe('solid');
  });

  it('short first segment → dot', () => {
    expect(dashStyleFromPattern([1, 2])).toBe('dot');
    expect(dashStyleFromPattern([2, 4])).toBe('dot');
  });

  it('longer first segment → dash', () => {
    expect(dashStyleFromPattern([4, 4])).toBe('dash');
    expect(dashStyleFromPattern([8, 2])).toBe('dash');
  });
});

describe('pptxDashType', () => {
  it('maps to pptxgenjs dashType', () => {
    expect(pptxDashType('solid')).toBe('solid');
    expect(pptxDashType('dash')).toBe('dash');
    expect(pptxDashType('dot')).toBe('sysDot');
  });
});

describe('shapeRender dash', () => {
  it('emits dashType on stroke (red dotted underline case)', () => {
    const layer: IRShape = {
      id: 'u',
      type: 'shape',
      rect: { x: 0, y: 0, width: 200, height: 2 },
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      shapeKind: 'rect',
      fill: null,
      stroke: { color: '#FF0000', weight: 2, dash: 'dot' },
      cornerRadii: null,
    };
    const { options } = shapeRender(layer);
    expect(options.line).toMatchObject({ color: 'FF0000', dashType: 'sysDot' });
  });
});
