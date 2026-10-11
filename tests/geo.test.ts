import { describe, expect, it } from 'vitest';
import { bboxAreaKm2, bboxAround, createProjection, suggestedMaxVehicles, decodePolyline, distanceMeters, METERS_PER_DEG_LAT, roundCoord, roundLatLon } from '../src/geo';

const ALEX = { lat: 52.5219, lon: 13.4132 };

describe('createProjection', () => {
  const p = createProjection(ALEX);

  it('bildet den Ursprung auf (0, 0) ab', () => {
    expect(p.toLocal(ALEX)).toEqual({ x: 0, y: 0 });
  });

  it('liefert Meter nach Norden und Osten', () => {
    const north = p.toLocal({ lat: ALEX.lat + 1000 / METERS_PER_DEG_LAT, lon: ALEX.lon });
    expect(north.x).toBeCloseTo(0, 6);
    expect(north.y).toBeCloseTo(1000, 6);

    // 1 Längengrad ist in Berlin ~ cos(52.5°) mal so lang wie ein Breitengrad
    const east = p.toLocal({ lat: ALEX.lat, lon: ALEX.lon + 0.01 });
    expect(east.x).toBeCloseTo(0.01 * METERS_PER_DEG_LAT * Math.cos((ALEX.lat * Math.PI) / 180), 6);
    expect(east.x).toBeGreaterThan(670);
    expect(east.x).toBeLessThan(690);
  });

  it('ist umkehrbar', () => {
    const q = { lat: 52.5401, lon: 13.3704 };
    const { x, y } = p.toLocal(q);
    const back = p.toLatLon(x, y);
    expect(back.lat).toBeCloseTo(q.lat, 10);
    expect(back.lon).toBeCloseTo(q.lon, 10);
  });

  it('stimmt im 2-km-Radius mit der Distanzformel überein', () => {
    const q = { lat: 52.5371, lon: 13.4352 };
    const { x, y } = p.toLocal(q);
    expect(Math.hypot(x, y)).toBeCloseTo(distanceMeters(ALEX, q), 0);
  });
});

describe('roundCoord / roundLatLon', () => {
  it('rundet auf 3 Nachkommastellen', () => {
    expect(roundCoord(52.52194)).toBe(52.522);
    expect(roundCoord(13.41249)).toBe(13.412);
    expect(roundCoord(13.4125)).toBe(13.413);
  });

  it('behandelt Darstellungsfehler und negative Werte', () => {
    expect(roundCoord(1.0005)).toBe(1.001);
    expect(roundCoord(-0.0005)).toBe(-0.001);
    expect(roundCoord(-73.98765)).toBe(-73.988);
  });

  it('unterstützt andere Genauigkeiten', () => {
    expect(roundCoord(52.52194, 2)).toBe(52.52);
    expect(roundCoord(52.52194, 0)).toBe(53);
  });

  it('rundet beide Koordinaten', () => {
    expect(roundLatLon({ lat: 52.521912, lon: 13.413245 })).toEqual({ lat: 52.522, lon: 13.413 });
  });

  it('weicht höchstens ~80 m von der echten Position ab', () => {
    const exact = { lat: 52.52149, lon: 13.41349 };
    expect(distanceMeters(exact, roundLatLon(exact))).toBeLessThan(80);
  });
});

describe('bboxAround', () => {
  const box = bboxAround(roundLatLon(ALEX), 2500);

  it('hat höchstens 3 Nachkommastellen', () => {
    for (const v of Object.values(box)) expect(v).toBe(Math.round(v * 1000) / 1000);
  });

  it('deckt mindestens den Radius in jede Richtung ab', () => {
    const c = roundLatLon(ALEX);
    expect(distanceMeters(c, { lat: box.north, lon: c.lon })).toBeGreaterThanOrEqual(2500);
    expect(distanceMeters(c, { lat: box.south, lon: c.lon })).toBeGreaterThanOrEqual(2500);
    expect(distanceMeters(c, { lat: c.lat, lon: box.east })).toBeGreaterThanOrEqual(2500);
    expect(distanceMeters(c, { lat: c.lat, lon: box.west })).toBeGreaterThanOrEqual(2500);
  });

  it('ist nur um die Rundung größer als nötig', () => {
    const c = roundLatLon(ALEX);
    expect(distanceMeters(c, { lat: box.north, lon: c.lon })).toBeLessThan(2500 + 112);
    expect(distanceMeters(c, { lat: c.lat, lon: box.east })).toBeLessThan(2500 + 70);
  });

  it('liefert für Berlin die erwarteten Werte', () => {
    expect(box).toEqual({ north: 52.545, south: 52.499, east: 13.45, west: 13.376 });
  });

  it('ist in Nord-Süd- und Ost-West-Richtung geordnet', () => {
    expect(box.north).toBeGreaterThan(box.south);
    expect(box.east).toBeGreaterThan(box.west);
  });
});

describe('decodePolyline', () => {
  it('dekodiert das Beispiel aus der Google-Dokumentation', () => {
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(pts).toEqual([
      { lat: 38.5, lon: -120.2 },
      { lat: 40.7, lon: -120.95 },
      { lat: 43.252, lon: -126.453 },
    ]);
  });

  it('dekodiert eine HAFAS-Radar-Polylinie', () => {
    const pts = decodePolyline('k_q_IytzpAyC|EeEpKaHrD');
    expect(pts).toHaveLength(4);
    expect(pts[0].lat).toBeCloseTo(52.52102, 5);
    expect(pts[0].lon).toBeCloseTo(13.41277, 5);
  });

  it('wirft bei abgeschnittener Eingabe', () => {
    expect(() => decodePolyline('k_q_Iyt')).toThrow();
  });
});

describe('suggestedMaxVehicles', () => {
  it('wächst mit der Fläche zwischen 256 und 2500', () => {
    const c = { lat: 52.522, lon: 13.413 };
    const small = bboxAround(c, 1000);
    const mid = bboxAround(c, 2500);
    const big = bboxAround(c, 10_000);
    expect(bboxAreaKm2(mid)).toBeCloseTo(25.5, 0);
    expect(suggestedMaxVehicles(small)).toBe(256);
    expect(suggestedMaxVehicles(mid)).toBe(256);
    expect(suggestedMaxVehicles(big)).toBeGreaterThan(2000);
    expect(suggestedMaxVehicles(bboxAround(c, 50_000))).toBe(2500);
  });
});
