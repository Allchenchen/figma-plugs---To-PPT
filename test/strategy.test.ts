import { describe, it, expect } from 'vitest';
import { decideFallback } from '../src/reader/compat';

describe('editable vs fidelity strategy', () => {
  const card = {
    type: 'FRAME',
    fills: [{ type: 'SOLID' as const, visible: true }],
    strokes: [{ type: 'SOLID' as const, visible: true }],
    children: [
      { type: 'TEXT' },
      { type: 'RECTANGLE' },
      { type: 'GROUP', children: [{ type: 'VECTOR' }, { type: 'VECTOR' }] },
    ],
  };

  it('editable: layout frame with text stays native (recurse)', () => {
    expect(decideFallback(card, 'editable').strategy).toBe('native');
  });

  it('fidelity: a container with editable text still recurses through the unified text path', () => {
    expect(decideFallback(card, 'fidelity')).toEqual({ strategy: 'native' });
  });

  it('both modes keep mask GROUPs intact as PNG', () => {
    const maskGroup = {
      type: 'GROUP',
      children: [{ type: 'ELLIPSE', isMask: true }, { type: 'RECTANGLE' }],
    };
    expect(decideFallback(maskGroup, 'editable').reason).toMatch(/mask group/);
    expect(decideFallback(maskGroup, 'fidelity').reason).toMatch(/mask group/);
  });

  it('editable: GROUP with text + ellipse image still recurses', () => {
    expect(
      decideFallback(
        {
          type: 'GROUP',
          children: [
            { type: 'ELLIPSE', fills: [{ type: 'IMAGE', visible: true }] },
            { type: 'TEXT' },
          ],
        },
        'editable'
      ).strategy
    ).toBe('native');
  });

  it('fidelity: same GROUP preserves its text subtree', () => {
    expect(
      decideFallback(
        {
          type: 'GROUP',
          children: [
            { type: 'ELLIPSE', fills: [{ type: 'IMAGE', visible: true }] },
            { type: 'TEXT' },
          ],
        },
        'fidelity'
      )
    ).toEqual({ strategy: 'native' });
  });

  it.each(['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE'] as const)(
    '%s text subtree uses the native recursive path in both modes',
    (type) => {
      const container = {
        type,
        children: [{ type: 'TEXT' }, { type: 'RECTANGLE' }],
      };
      expect(decideFallback(container, 'editable')).toEqual({ strategy: 'native' });
      expect(decideFallback(container, 'fidelity')).toEqual({ strategy: 'native' });
    }
  );
});
