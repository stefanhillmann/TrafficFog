import { describe, expect, it } from 'vitest';
import { Fleet, MAX_EXTRAPOLATION_MS } from '../src/fleet';
import { createProjection } from '../src/geo';
import { estimatePosition } from '../src/motion';
import { nextDelay } from '../src/poller';
import { Fader } from '../src/render/fader';
import { createSimSource } from '../src/sources/sim';
import { resolveSource, SOURCES } from '../src/sources/registry';

const frames = [
  { t: 0, x: 0, y: 0 },
  { t: 10_000, x: 100, y: 0 },
  { t: 20_000, x: 100, y: 50 },
];

describe('estimatePosition', () => {
  it('interpoliert zwischen Frames', () => {
    expect(estimatePosition(frames, [], 5_000, 4000)).toEqual({ x: 50, y: 0, vx: 10, vy: 0 });
    expect(estimatePosition(frames, [], 15_000, 4000)).toMatchObject({ x: 100, y: 25 });
  });

  it('hält vor dem ersten Frame an dessen Position', () => {
    expect(estimatePosition(frames, [], -1000, 4000)).toMatchObject({ x: 0, y: 0 });
  });

  it('schreibt nach dem letzten Frame begrenzt fort', () => {
    expect(estimatePosition(frames, [], 22_000, 4000)).toMatchObject({ x: 100, y: 60 });
    // nach der Grenze bleibt das Fahrzeug stehen
    const late = estimatePosition(frames, [], 60_000, 4000)!;
    expect(late).toMatchObject({ x: 100, y: 70, vx: 0, vy: 0, stale: true });
  });

  it('schreibt ohne Frames aus den letzten zwei Positionen fort, höchstens maxMs', () => {
    const history = [
      { t: 0, x: 0, y: 0 },
      { t: 20_000, x: 200, y: 0 },
    ];
    expect(estimatePosition([], history, 22_000, 4000)).toMatchObject({ x: 220, vx: 10 });
    expect(estimatePosition([], history, 50_000, 4000)).toMatchObject({ x: 240, vx: 0 });
  });

  it('nutzt zu weit auseinanderliegende Beobachtungen nicht', () => {
    const history = [
      { t: 0, x: 0, y: 0 },
      { t: 300_000, x: 200, y: 0 },
    ];
    expect(estimatePosition([], history, 302_000, 4000)).toEqual({ x: 200, y: 0, vx: 0, vy: 0 });
  });

  it('liefert null ohne Daten', () => {
    expect(estimatePosition([], [], 0, 4000)).toBeNull();
  });
});

describe('Fleet', () => {
  const proj = createProjection({ lat: 52.52, lon: 13.4 });
  const v = (id: string, lat: number, t: number) => ({ id, mode: 'bus' as const, line: '100', lat, lon: 13.4, timestamp: t });

  it('verfolgt Fahrzeuge über Abfragen und entfernt verschwundene', () => {
    const fleet = new Fleet(proj);
    fleet.ingest([v('a', 52.52, 0), v('b', 52.52, 0)], 0);
    fleet.ingest([v('a', 52.5201, 20_000)], 20_000);
    expect(fleet.vehicles.size).toBe(2);
    fleet.ingest([v('a', 52.5202, 40_000)], 40_000);
    expect([...fleet.vehicles.keys()]).toEqual(['a']);
  });

  it('korrigiert kleine Sprünge weich und unterbricht große', () => {
    const fleet = new Fleet(proj);
    fleet.ingest([v('a', 52.52, 0)], 0);
    fleet.step(0, 16);
    const tv = fleet.vehicles.get('a')!;
    tv.broken = false;
    // 11 m weiter: weiche Korrektur
    fleet.ingest([v('a', 52.5201, 1_000)], 1_000);
    fleet.step(1_000, 16);
    expect(tv.broken).toBe(false);
    expect(tv.y).toBeLessThan(11);
    // 1,1 km weiter: Spur unterbrechen
    fleet.ingest([v('a', 52.53, 2_000)], 2_000);
    expect(tv.broken).toBe(true);
  });

  it('wertet einen Stillstand mangels Daten nicht als Halt', () => {
    const fleet = new Fleet(proj);
    const moving = { ...v('a', 52.52, 0), frames: [{ t: 0, lat: 52.52, lon: 13.4 }, { t: 10_000, lat: 52.5201, lon: 13.4 }] };
    fleet.ingest([moving], 0);
    for (let t = 0; t < 30_000; t += 100) fleet.step(t, 100);
    expect(fleet.vehicles.get('a')!.stillFor).toBe(0);
  });

  it('erkennt stehende Fahrzeuge', () => {
    const fleet = new Fleet(proj);
    fleet.ingest([v('a', 52.52, 0)], 0);
    fleet.ingest([v('a', 52.52, 20_000)], 20_000);
    for (let t = 20_000; t < 23_000; t += 100) fleet.step(t, 100);
    expect(fleet.vehicles.get('a')!.stillFor).toBeGreaterThan(2_500);
  });

  it('begrenzt die Fortschreibung ohne Frames', () => {
    expect(MAX_EXTRAPOLATION_MS).toBeLessThanOrEqual(5_000);
  });
});

describe('Fader', () => {
  it('blendet nach der Nachleuchtdauer auf ~5 % ab', () => {
    for (const T of [15, 75, 240]) {
      const f = new Fader(T);
      let remaining = 1;
      for (let i = 0; i < T * 60; i++) remaining *= 1 - f.next(1 / 60);
      expect(remaining).toBeGreaterThan(0.03);
      expect(remaining).toBeLessThan(0.08);
    }
  });

  it('gibt nie winzige, wirkungslose Abzüge aus', () => {
    const f = new Fader(240);
    for (let i = 0; i < 10_000; i++) {
      const a = f.next(1 / 60);
      expect(a === 0 || a >= 0.02 - 1e-9).toBe(true);
    }
  });
});

describe('nextDelay', () => {
  it('nutzt das Intervall ohne Fehler und wächst bei Fehlern bis zur Obergrenze', () => {
    expect(nextDelay(25_000, 0)).toBe(25_000);
    expect(nextDelay(25_000, 1)).toBe(50_000);
    expect(nextDelay(25_000, 2)).toBe(100_000);
    expect(nextDelay(25_000, 10)).toBe(120_000);
  });
});

describe('Quellen', () => {
  it('wählt BVG als Standard und Sim per Parameter', () => {
    expect(resolveSource('').source?.id).toBe('bvg');
    expect(resolveSource('?source=sim').source?.simulated).toBe(true);
    expect(resolveSource('?source=vbb-rest').source?.id).toBe('vbb-rest');
  });

  it('fällt bei unbekannter Quelle nicht still zurück', () => {
    const r = resolveSource('?source=foo');
    expect(r.source).toBeUndefined();
    expect(r.error).toMatch(/foo/);
  });

  it('jede registrierte Quelle erfüllt die Schnittstelle', () => {
    for (const [key, entry] of Object.entries(SOURCES)) {
      const s = entry.create(new URLSearchParams());
      expect(s.id).toBe(key);
      expect(s.pollIntervalMs).toBeGreaterThanOrEqual(5_000);
      expect(typeof s.fetchVehicles).toBe('function');
    }
  });

  it('die Simulation liefert Fahrzeuge mit Frames innerhalb der Box', async () => {
    const box = { north: 52.545, south: 52.499, east: 13.45, west: 13.376 };
    const list = await createSimSource({ now: () => 1_000_000 }).fetchVehicles(box, new AbortController().signal);
    expect(list.length).toBeGreaterThan(10);
    for (const v of list) {
      expect(v.lat).toBeLessThanOrEqual(box.north);
      expect(v.lat).toBeGreaterThanOrEqual(box.south);
      expect(v.frames!.length).toBeGreaterThan(1);
    }
    expect(new Set(list.map((v) => v.mode)).size).toBeGreaterThanOrEqual(5);
  });
});

describe('Fader unendlich und lange Dauer', () => {
  it('blendet bei Infinity nie aus', () => {
    const f = new Fader(Infinity);
    for (let i = 0; i < 100_000; i++) expect(f.next(1 / 60)).toBe(0);
  });

  it('hält auch 60 Minuten Nachleuchten korrekt ein', () => {
    const f = new Fader(3600);
    let remaining = 1;
    for (let i = 0; i < 3600 * 10; i++) remaining *= 1 - f.next(0.1);
    expect(remaining).toBeGreaterThan(0.03);
    expect(remaining).toBeLessThan(0.08);
  });
});
