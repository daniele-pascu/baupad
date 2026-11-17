import { beforeEach, describe, expect, it } from 'vitest';

/** localStorage/sessionStorage im Speicher nachbilden (Tests laufen ohne Browser) */
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
const g = globalThis as unknown as { localStorage: MemStorage; sessionStorage: MemStorage };
g.localStorage = new MemStorage();
g.sessionStorage = new MemStorage();

const lock = await import('../../src/lib/app-lock');

beforeEach(() => {
  g.localStorage.clear();
  g.sessionStorage.clear();
  lock.disableLock();
});

describe('App-Sperre', () => {
  it('PIN: nur 4 bis 8 Ziffern, gespeichert nur als Prüfwert', async () => {
    expect(lock.validPin('123')).toBe(false);
    expect(lock.validPin('12a4')).toBe(false);
    expect(lock.validPin('123456789')).toBe(false);
    expect(lock.validPin('2468')).toBe(true);
    await expect(lock.setPin('12')).rejects.toThrow('4 bis 8 Ziffern');
    await lock.setPin('2468');
    const raw = g.localStorage.getItem('baupad.appLock')!;
    expect(raw).not.toContain('2468');
    expect(await lock.checkPin('2468')).toBe(true);
    expect(await lock.checkPin('2469')).toBe(false);
    expect(await lock.checkPin('')).toBe(false);
  });

  it('PIN ändern behält Zeit; ausschalten entfernt alles', async () => {
    await lock.setPin('1111', 5);
    await lock.setPin('2222');
    expect(lock.lockConfig()?.after).toBe(5);
    expect(await lock.checkPin('1111')).toBe(false);
    lock.disableLock();
    expect(lock.lockConfig()).toBeNull();
    expect(lock.isLocked()).toBe(false);
  });

  it('gesperrt beim Öffnen; im selben Tab bis zur gewählten Zeit offen; „sofort“ immer gesperrt', async () => {
    await lock.setPin('1234', 5);
    // eingerichtet in diesem Tab → offen
    expect(lock.lockedOnStart()).toBe(false);
    // App geschlossen (neuer Tab ohne sessionStorage) → gesperrt
    g.sessionStorage.clear();
    expect(lock.lockedOnStart()).toBe(true);
    lock.unlock();
    expect(lock.lockedOnStart()).toBe(false);
    // im Hintergrund: unter 5 Minuten offen, darüber gesperrt
    const t = Date.now();
    g.sessionStorage.setItem('baupad.hiddenAt', String(t - 4 * 60_000));
    expect(lock.lockedOnStart(t)).toBe(false);
    g.sessionStorage.setItem('baupad.hiddenAt', String(t - 6 * 60_000));
    expect(lock.lockedOnStart(t)).toBe(true);
    lock.setLockAfter(0);
    g.sessionStorage.removeItem('baupad.hiddenAt');
    expect(lock.lockedOnStart()).toBe(true);
    lock.lockNow();
    expect(lock.isLocked()).toBe(true);
    lock.unlock();
    expect(lock.isLocked()).toBe(false);
  });

  it('falsche PINs: ab der fünften warten (30 s, dann doppelt), bei der zehnten Daten löschen', () => {
    const now = 1_000_000;
    const r: { count: number; wait: number; wipe: boolean }[] = [];
    for (let i = 0; i < 10; i++) r.push(lock.registerFail(now));
    expect(r.slice(0, 4).every((x) => x.wait === 0 && !x.wipe)).toBe(true);
    expect(r[4]).toEqual({ count: 5, wait: 30_000, wipe: false });
    expect(r[5].wait).toBe(60_000);
    expect(r[8]).toMatchObject({ count: 9, wipe: false });
    expect(r[9]).toMatchObject({ count: 10, wipe: true });
    expect(lock.fails().until).toBe(now + r[9].wait);
    lock.resetFails();
    expect(lock.fails()).toEqual({ count: 0, until: 0 });
  });
});
