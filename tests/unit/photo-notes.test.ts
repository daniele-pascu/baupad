import { describe, expect, it } from 'vitest';
import { photoNoteUpdates } from '../../src/lib/photo-notes';

const d = (number: number, photoIds: string[], label: string | null = null) => ({ number, label, photoIds, deletedAt: null });

describe('Fotovermerk folgt der Messung', () => {
  it('neue Nummer → Vermerk nachgezogen; eigene Beschreibungen bleiben', () => {
    const photos = [
      { id: 'a', description: 'Aufmaß N-1 Nr. 3' },
      { id: 'b', description: 'Riss an der Stütze' },
      { id: 'c', description: 'Aufmaß N-1 Nr. 4' },
    ];
    expect(photoNoteUpdates('Aufmaß N-1', [d(4, ['a', 'b']), d(4, ['c'])], photos)).toEqual([{ id: 'a', description: 'Aufmaß N-1 Nr. 4' }]);
  });
  it('Kennzeichnung und geänderte Plannummer', () => {
    expect(photoNoteUpdates('Aufmaß N-2', [d(5, ['a'], 'Wand A')], [{ id: 'a', description: 'Aufmaß N-1 Nr. 5' }])).toEqual([{ id: 'a', description: 'Aufmaß N-2 Nr. Wand A' }]);
  });
  it('Fotos ohne Messung und gelöschte Messungen bleiben unverändert', () => {
    expect(photoNoteUpdates('Aufmaß N-1', [{ ...d(2, ['a']), deletedAt: 1 }], [{ id: 'a', description: 'Aufmaß N-1 Nr. 1' }, { id: 'x', description: 'Aufmaß N-1 Nr. 9' }])).toEqual([]);
  });
});
