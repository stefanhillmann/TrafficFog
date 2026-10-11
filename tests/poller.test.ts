import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Poller } from '../src/poller';
import type { VehicleSource } from '../src/types';

const BBOX = { north: 1, south: 0, east: 1, west: 0 };

function source(impl: (signal: AbortSignal) => Promise<never[]>): VehicleSource & { calls: number } {
  const s = {
    id: 'test',
    label: 'Test',
    attribution: '',
    pollIntervalMs: 25_000,
    calls: 0,
    fetchVehicles: (_bbox: unknown, signal: AbortSignal) => {
      s.calls++;
      return impl(signal);
    },
  };
  return s;
}

describe('Poller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it('fragt im Abstand des Quell-Intervalls ab', async () => {
    const src = source(async () => []);
    const p = new Poller(src, () => BBOX, () => {}, () => {});
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(src.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(24_000);
    expect(src.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(src.calls).toBe(2);
    p.dispose();
  });

  it('fragt bei häufigem Stop/Start nicht öfter ab als erlaubt', async () => {
    // hängender Server; die Anfrage endet erst durch Abbruch (wie fetch)
    const src = source(
      (signal) =>
        new Promise<never[]>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    );
    const p = new Poller(src, () => BBOX, () => {}, () => {});
    for (let i = 0; i < 60; i++) {
      p.start();
      await vi.advanceTimersByTimeAsync(1_000);
      p.stop();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    // 120 s mit Zeitüberschreitung nach 15 s und Backoff: höchstens alle 25 s eine Anfrage
    expect(src.calls).toBeLessThanOrEqual(Math.ceil(120_000 / 25_000));
    p.dispose();
  });

  it('erhöht den Abstand nach Fehlern und meldet den Status', async () => {
    const src = source(async () => {
      throw new Error('HTTP 503');
    });
    const statuses: string[] = [];
    const p = new Poller(src, () => BBOX, () => {}, (s) => statuses.push(s.state));
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(p.status).toMatchObject({ state: 'error', failures: 1, lastError: 'HTTP 503' });
    await vi.advanceTimersByTimeAsync(49_000);
    expect(src.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(src.calls).toBe(2);
    expect(statuses).toContain('error');
    p.dispose();
  });

  it('wirft Fehler nie nach außen', async () => {
    const src = source(async () => {
      throw new TypeError('kaputt');
    });
    const onData = vi.fn();
    const p = new Poller(src, () => BBOX, onData, () => {});
    p.start();
    await expect(vi.advanceTimersByTimeAsync(100_000)).resolves.not.toThrow();
    expect(onData).not.toHaveBeenCalled();
    p.dispose();
  });

  it('zieht die Abfrage nach requestSoon vor, hält aber den Mindestabstand ein', async () => {
    const src = source(async () => []);
    const p = new Poller(src, () => BBOX, () => {}, () => {});
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(src.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(3_000);
    p.requestSoon(8_000);
    await vi.advanceTimersByTimeAsync(4_900);
    expect(src.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(src.calls).toBe(2);
    p.dispose();
  });
});
