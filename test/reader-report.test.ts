import { describe, expect, it } from 'vitest';
import { rasterizedTextDescendantEntries } from '../src/reader/report';

describe('rasterized text reporting', () => {
  it('records nested TextNode IDs and editability loss for rasterized containers', () => {
    expect(
      rasterizedTextDescendantEntries(
        [
          {
            id: 'group',
            name: 'Card',
            type: 'GROUP',
            children: [
              {
                id: 'instance',
                name: 'Nested instance',
                type: 'INSTANCE',
                children: [{ id: 'text-1', name: 'Title', type: 'TEXT' }],
              },
            ],
          },
        ],
        'mask group'
      )
    ).toEqual([
      {
        nodeId: 'text-1',
        nodeName: 'Title',
        nodeType: 'TEXT',
        tier: 'png',
        reason: 'mask group; text embedded in rasterized container',
      },
    ]);
  });
});
