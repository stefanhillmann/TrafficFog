import { describe, expect, it, vi } from 'vitest';
import { SourceError } from '../src/sources/errors';
import { buildRadarUrl, createTransportRestSource, parseRadar } from '../src/sources/transportRest';

const BBOX = { north: 52.545, south: 52.499, east: 13.45, west: 13.376 };

/** Aufbau nach hafas-client/hafas-rest-api (FPTF), gekürzt */
const movement = (overrides: Record<string, unknown> = {}) => ({
  direction: 'S Spandau Bhf (Berlin)',
  tripId: '1|23456|0|86|10102026',
  line: { type: 'line', id: 's7', name: 'S7', mode: 'train', product: 'suburban' },
  location: { type: 'location', latitude: 52.521, longitude: 13.411 },
  nextStopovers: [],
  frames: [
    { origin: { id: '900100003' }, destination: { id: '900100004' }, t: 0 },
    { origin: { id: '900100003' }, destination: { id: '900100004' }, t: 10000 },
    { origin: { id: '900100003' }, destination: { id: '900100004' }, t: 20000 },
  ],
  polyline: {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [13.411, 52.521] } },
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [13.408, 52.5215] } },
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [13.405, 52.522] } },
    ],
  },
  ...overrides,
});

describe('buildRadarUrl', () => {
  it('setzt Box und Parameter', () => {
    const u = new URL(buildRadarUrl('https://v6.vbb.transport.rest', BBOX));
    expect(u.origin + u.pathname).toBe('https://v6.vbb.transport.rest/radar');
    expect(u.searchParams.get('north')).toBe('52.545');
    expect(u.searchParams.get('west')).toBe('13.376');
    expect(u.searchParams.get('south')).toBe('52.499');
    expect(u.searchParams.get('east')).toBe('13.45');
    expect(u.searchParams.get('polylines')).toBe('true');
    expect(u.searchParams.get('duration')).toBe('30');
  });

  it('funktioniert mit und ohne abschließenden Schrägstrich', () => {
    expect(buildRadarUrl('https://x.test/api/', BBOX)).toMatch(/^https:\/\/x\.test\/api\/radar\?/);
    expect(buildRadarUrl('https://x.test/api', BBOX)).toMatch(/^https:\/\/x\.test\/api\/radar\?/);
  });
});

describe('parseRadar', () => {
  it('parst das v6-Format mit Frames', () => {
    const [v] = parseRadar({ movements: [movement()], realtimeDataUpdatedAt: 1 }, 1_000_000);
    expect(v).toMatchObject({ id: '1|23456|0|86|10102026', mode: 'sbahn', line: 'S7', direction: 'S Spandau Bhf (Berlin)', lat: 52.521, lon: 13.411, timestamp: 1_000_000 });
    expect(v.frames).toEqual([
      { t: 1_000_000, lat: 52.521, lon: 13.411 },
      { t: 1_010_000, lat: 52.5215, lon: 13.408 },
      { t: 1_020_000, lat: 52.522, lon: 13.405 },
    ]);
  });

  it('parst das ältere Array-Format', () => {
    expect(parseRadar([movement()], 0)).toHaveLength(1);
  });

  it('bildet Produkte auf Verkehrsmittel ab', () => {
    const products = ['suburban', 'subway', 'tram', 'bus', 'ferry', 'express', 'regional', 'taxi'];
    const res = parseRadar(
      products.map((p, i) => movement({ tripId: `t${i}`, line: { name: p, product: p } })),
      0,
    );
    expect(res.map((v) => v.mode)).toEqual(['sbahn', 'ubahn', 'tram', 'bus', 'ferry', 'regional', 'regional']);
  });

  it('lässt Frames weg, wenn keine Polylinie vorhanden ist', () => {
    const [v] = parseRadar([movement({ polyline: undefined })], 0);
    expect(v.frames).toBeUndefined();
  });

  it('überspringt unvollständige und doppelte Einträge', () => {
    const res = parseRadar(
      [movement(), movement(), movement({ tripId: undefined }), movement({ tripId: 'x', location: { latitude: null } }), movement({ tripId: 'y', line: undefined })],
      0,
    );
    expect(res).toHaveLength(1);
  });

  it('wirft bei unerwartetem Format', () => {
    expect(() => parseRadar({ error: 'x' }, 0)).toThrow(SourceError);
    expect(() => parseRadar('oops', 0)).toThrow(SourceError);
  });
});

describe('createTransportRestSource', () => {
  it('fragt /radar ab und parst die Antwort', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ movements: [movement()] }), { status: 200 }));
    const src = createTransportRestSource({ id: 't', label: 'T', baseUrl: 'https://x.test/', attribution: 'x', fetchImpl, now: () => 5 });
    const res = await src.fetchVehicles(BBOX, new AbortController().signal);
    expect(res[0].timestamp).toBe(5);
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toContain('/radar?');
  });

  it('meldet HTTP 503 als SourceError', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }));
    const src = createTransportRestSource({ id: 't', label: 'T', baseUrl: 'https://x.test/', attribution: 'x', fetchImpl });
    await expect(src.fetchVehicles(BBOX, new AbortController().signal)).rejects.toMatchObject({ status: 503 });
  });
});
