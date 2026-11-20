import { afterEach, describe, expect, it, vi } from 'vitest';
import { deepClone, timeoutSignal } from '../../src/lib/compat';

// ältere Browser (Fernseher, alte Handys): ohne AbortSignal.timeout / structuredClone darf nichts scheitern
describe('Ersatz für neuere Browser-Funktionen', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('timeoutSignal bricht auch ohne AbortSignal.timeout nach der Zeit ab', () => {
    vi.useFakeTimers();
    const orig = AbortSignal.timeout;
    // @ts-expect-error – wie in alten Browsern
    delete AbortSignal.timeout;
    try {
      const s = timeoutSignal(1000);
      expect(s.aborted).toBe(false);
      vi.advanceTimersByTime(1001);
      expect(s.aborted).toBe(true);
    } finally {
      AbortSignal.timeout = orig;
    }
  });

  it('deepClone kopiert auch ohne structuredClone tief', () => {
    vi.stubGlobal('structuredClone', undefined);
    const a = { x: 1, list: [{ y: 2 }], n: null as null };
    const b = deepClone(a);
    expect(b).toEqual(a);
    b.list[0].y = 9;
    expect(a.list[0].y).toBe(2);
  });
});
