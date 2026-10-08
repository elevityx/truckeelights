import { describe, expect, it } from 'vitest';
import { orderQueue, publicPathFor } from './adminPhotos';
import type { AdminPhoto } from './types';

const p = (id: string, createdAt: string): AdminPhoto => ({
  id, houseId: 'h', address: 'a', status: 'pending', uploadPath: 'x', publicPath: null, createdAt,
});

describe('orderQueue', () => {
  const rows = [p('b', '2026-10-02T00:00:00Z'), p('a', '2026-10-01T00:00:00Z'), p('c', '2026-10-03T00:00:00Z')];
  it('pending is oldest first', () => expect(orderQueue(rows, 'pending').map((r) => r.id)).toEqual(['a', 'b', 'c']));
  it('approved is newest first', () => expect(orderQueue(rows, 'approved').map((r) => r.id)).toEqual(['c', 'b', 'a']));
  it('does not mutate', () => {
    orderQueue(rows, 'pending');
    expect(rows[0].id).toBe('b');
  });
});

describe('publicPathFor', () => {
  it('uses a fresh name in the house folder, never the upload name', () => {
    const a = publicPathFor('house1', crypto.randomUUID());
    const b = publicPathFor('house1', crypto.randomUUID());
    expect(a).toMatch(/^house1\/[0-9a-f-]{36}\.jpg$/);
    expect(a).not.toBe(b);
  });
});
