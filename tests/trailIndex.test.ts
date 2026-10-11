import { describe, expect, it } from 'vitest';
import { distanceToSegment, TrailIndex } from '../src/trailIndex';

const bus = { id: 'b', mode: 'bus' as const, line: 'M41', direction: 'Sonnenallee' };
const tram = { id: 't', mode: 'tram' as const, line: 'M10' };

/** fährt ein Fahrzeug in kleinen Schritten von (x0,y) nach (x1,y) */
function drive(idx: TrailIndex, meta: typeof bus | typeof tram, x0: number, x1: number, y: number, t0: number, others: object[] = []) {
  let t = t0;
  const step = x1 > x0 ? 2 : -2;
  for (let x = x0; step > 0 ? x <= x1 : x >= x1; x += step) {
    idx.update([{ ...meta, x, y, broken: false }, ...(others as never[])], t);
    t += 100;
  }
  return t;
}

describe('distanceToSegment', () => {
  it('misst senkrecht zum Segment und an den Enden', () => {
    expect(distanceToSegment(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(distanceToSegment(-4, 3, 0, 0, 10, 0)).toBe(5);
    expect(distanceToSegment(1, 1, 2, 2, 2, 2)).toBeCloseTo(Math.SQRT2);
  });
});

describe('TrailIndex', () => {
  it('findet die Spur unter dem Zeiger mit Linie und Richtung', () => {
    const idx = new TrailIndex();
    const t = drive(idx, bus, 0, 300, 0, 0);
    const hit = idx.nearest(150, 4, 10, t, 60_000);
    expect(hit?.meta).toEqual(bus);
    expect(hit?.active).toBe(true);
    expect(hit?.distance).toBeCloseTo(4, 0);
    expect(hit?.head.x).toBeCloseTo(300, 0);
    // Spurstück bei x≈150 wurde nach ~7,5 s durchfahren, jetzt ist t = 15 s
    expect(hit!.wallAge).toBeGreaterThan(7_000);
    expect(hit!.wallAge).toBeLessThan(8_500);
  });

  it('liefert nichts außerhalb des Radius', () => {
    const idx = new TrailIndex();
    const t = drive(idx, bus, 0, 300, 0, 0);
    expect(idx.nearest(150, 40, 10, t, 60_000)).toBeNull();
  });

  it('wählt die nächstgelegene von zwei Spuren', () => {
    const idx = new TrailIndex();
    let t = drive(idx, bus, 0, 300, 0, 0);
    t = drive(idx, tram, 0, 300, 20, t, [{ ...bus, x: 300, y: 0, broken: false }]);
    expect(idx.nearest(100, 14, 10, t, 60_000)?.meta.id).toBe('t');
    expect(idx.nearest(100, 6, 10, t, 60_000)?.meta.id).toBe('b');
  });

  it('verbindet keine Punkte über eine Unterbrechung hinweg', () => {
    const idx = new TrailIndex();
    let t = drive(idx, bus, 0, 100, 0, 0);
    idx.update([{ ...bus, x: 500, y: 0, broken: true }], t);
    t = drive(idx, bus, 500, 600, 0, t + 100);
    expect(idx.nearest(300, 0, 10, t, 60_000)).toBeNull();
    expect(idx.path('b', t, 60_000)).toHaveLength(2);
  });

  it('ignoriert verblasste Spurstücke und räumt sie auf', () => {
    const idx = new TrailIndex();
    let t = drive(idx, bus, 0, 300, 0, 0); // dauert 15 s
    t += 60_000;
    // Fahrzeug steht seitdem am Ende
    idx.update([{ ...bus, x: 300, y: 0, broken: false }], t);
    expect(idx.nearest(50, 0, 10, t, 30_000)).toBeNull();
    idx.prune(t, 30_000);
    expect(idx.path('b', t, 30_000).flat().length).toBeLessThanOrEqual(2);
  });

  it('meldet verschwundene Fahrzeuge als inaktiv und entfernt sie nach Ablauf', () => {
    const idx = new TrailIndex();
    let t = drive(idx, bus, 0, 300, 0, 0);
    idx.update([], t);
    expect(idx.nearest(150, 0, 10, t, 60_000)?.active).toBe(false);
    t += 61_000;
    idx.prune(t, 60_000);
    expect(idx.size).toBe(0);
  });

  it('speichert Punkte nur grob, damit die Suche billig bleibt', () => {
    const idx = new TrailIndex(12);
    const t = drive(idx, bus, 0, 1200, 0, 0); // 600 Updates
    const pts = idx.path('b', t, 1e9).flat().length;
    expect(pts).toBeGreaterThan(90);
    expect(pts).toBeLessThan(110);
  });
});

describe('TrailIndex Punktbudget', () => {
  it('hält bei unendlicher Nachleuchtdauer die Obergrenze ein und behält die jüngsten Punkte', () => {
    const idx = new TrailIndex(1, 500);
    let t = 0;
    for (let i = 0; i < 2000; i++) {
      idx.update([{ ...bus, x: i * 2, y: 0, broken: false }], t);
      t += 100;
      if (i % 50 === 0) idx.prune(t, Infinity);
    }
    idx.prune(t, Infinity);
    expect(idx.pointCount).toBeLessThanOrEqual(500);
    expect(idx.nearest(3990, 0, 5, t, Infinity)?.meta.id).toBe('b');
    expect(idx.nearest(10, 0, 5, t, Infinity)).toBeNull();
  });
});
