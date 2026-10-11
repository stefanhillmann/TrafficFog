import { describe, expect, it, vi } from 'vitest';
import { SourceError } from '../src/sources/errors';
import {
  BVG_PROFILE,
  buildRadarRequest,
  createHafasRadarSource,
  formatHafasDateTime,
  parseHafasDateTime,
  parseRadarResponse,
} from '../src/sources/hafas';
import fixture from './fixtures/hafas-journeygeopos.json';

const BBOX = { north: 52.545, south: 52.499, east: 13.45, west: 13.376 };

describe('Zeitformat', () => {
  it('formatiert in Berliner Ortszeit (Sommerzeit)', () => {
    expect(formatHafasDateTime(Date.UTC(2026, 9, 10, 14, 29, 3), 'Europe/Berlin')).toEqual({ date: '20261010', time: '162903' });
  });

  it('formatiert in Berliner Ortszeit (Winterzeit, über Mitternacht)', () => {
    expect(formatHafasDateTime(Date.UTC(2026, 11, 31, 23, 30, 0), 'Europe/Berlin')).toEqual({ date: '20270101', time: '003000' });
  });

  it('parst Datum und Uhrzeit zurück', () => {
    expect(parseHafasDateTime('20261010', '162903', 'Europe/Berlin')).toBe(Date.UTC(2026, 9, 10, 14, 29, 3));
    expect(parseHafasDateTime('20260115', '080000', 'Europe/Berlin')).toBe(Date.UTC(2026, 0, 15, 7, 0, 0));
  });

  it('versteht Uhrzeiten mit Tagesversatz', () => {
    expect(parseHafasDateTime('20260115', '01003000', 'Europe/Berlin')).toBe(Date.UTC(2026, 0, 15, 23, 30, 0));
  });

  it('lehnt ungültige Werte ab', () => {
    expect(() => parseHafasDateTime('2026-01-15', '0800', 'Europe/Berlin')).toThrow(SourceError);
  });
});

describe('buildRadarRequest', () => {
  const req = buildRadarRequest(BVG_PROFILE, BBOX, Date.UTC(2026, 9, 10, 14, 29, 3), { maxVehicles: 200, durationSec: 30, stepSec: 10 });
  const r = req.svcReqL[0].req;

  it('nutzt JourneyGeoPos mit Profil-Kennung', () => {
    expect(req.svcReqL[0].meth).toBe('JourneyGeoPos');
    expect(req.client).toEqual(BVG_PROFILE.client);
    expect(req.auth).toEqual(BVG_PROFILE.auth);
    expect(req.ver).toBe('1.72');
  });

  it('kodiert die Bounding Box in Mikrograd', () => {
    expect(r.rect).toEqual({ llCrd: { x: 13376000, y: 52499000 }, urCrd: { x: 13450000, y: 52545000 } });
  });

  it('setzt Zeitraum, Schrittweite und Anzahl', () => {
    expect(r.perSize).toBe(30000);
    expect(r.perStep).toBe(10000);
    expect(r.maxJny).toBe(200);
    expect(r.date).toBe('20261010');
    expect(r.time).toBe('162903');
  });

  it('enthält keine genaueren Koordinaten als die Box', () => {
    const json = JSON.stringify(req);
    expect(json).not.toMatch(/52\.52\d{2,}/);
  });
});

describe('parseRadarResponse', () => {
  const base = Date.UTC(2026, 9, 10, 14, 29, 3);
  const vehicles = parseRadarResponse(fixture, BVG_PROFILE, 0);

  it('liefert ein Fahrzeug pro Fahrt', () => {
    expect(vehicles).toHaveLength(5);
    expect(new Set(vehicles.map((v) => v.id)).size).toBe(5);
  });

  it('übernimmt ID, Linie, Verkehrsmittel und Position', () => {
    const v = vehicles[0];
    expect(v.id).toBe('1|53810|58|86|10102026');
    expect(v.line).toBe('U8');
    expect(v.direction).toBe('Wittenau');
    expect(v.mode).toBe('ubahn');
    expect(v.lat).toBeCloseTo(52.521014, 6);
    expect(v.lon).toBeCloseTo(13.412769, 6);
    expect(v.timestamp).toBe(base);
  });

  it('baut Frames aus mSec und Polylinie', () => {
    const f = vehicles[0].frames!;
    expect(f).toHaveLength(4);
    expect(f.map((x) => x.t - base)).toEqual([0, 10000, 20000, 30000]);
    expect(f[0].lat).toBeCloseTo(52.52102, 5);
    expect(f[3].lat).toBeCloseTo(52.52423, 5);
    expect(f[3].lon).toBeCloseTo(13.40875, 5);
  });

  const make = (jnyL: unknown[], prodL: unknown[] = [], polyL: unknown[] = [], extra: Record<string, unknown> = {}) => ({
    svcResL: [{ err: 'OK', res: { common: { prodL, polyL }, jnyL, ...extra } }],
  });

  it('bildet alle Produktklassen ab und überspringt unbekannte', () => {
    const prodL = [1, 2, 4, 8, 16, 32, 64, 128].map((cls) => ({ cls, name: `L${cls}` }));
    const jnyL = prodL.map((_, i) => ({ jid: `j${i}`, prodX: i, pos: { x: 13400000, y: 52500000 } }));
    const res = parseRadarResponse(make(jnyL, prodL), BVG_PROFILE, 0);
    expect(res.map((v) => v.mode)).toEqual(['sbahn', 'ubahn', 'tram', 'bus', 'ferry', 'regional', 'regional']);
  });

  it('nutzt die Anfragezeit, wenn die Antwort keine Zeit enthält', () => {
    const res = parseRadarResponse(make([{ jid: 'a', prodX: 0, pos: { x: 1, y: 2 } }], [{ cls: 8, name: '100' }]), BVG_PROFILE, 1_700_000_000_456);
    expect(res[0].timestamp).toBe(1_700_000_000_000);
    expect(res[0].frames).toBeUndefined();
  });

  it('verwirft Frames, wenn Polylinie und mSec nicht zusammenpassen', () => {
    const res = parseRadarResponse(
      make([{ jid: 'a', prodX: 0, pos: { x: 1, y: 2 }, ani: { mSec: [0, 10000, 20000], polyG: { polyXL: [0] } } }], [{ cls: 8 }], [{ crdEncYX: 'k_q_IytzpAyC|EeEpKaHrD' }]),
      BVG_PROFILE,
      0,
    );
    expect(res[0].frames).toBeUndefined();
  });

  it('übersteht kaputte Polylinien und fehlende Felder', () => {
    const res = parseRadarResponse(
      make(
        [
          { jid: 'a', prodX: 0, pos: { x: 1, y: 2 }, ani: { mSec: [0, 1], polyG: { polyXL: [0] } } },
          { prodX: 0, pos: { x: 1, y: 2 } },
          { jid: 'c', prodX: 0 },
          { jid: 'd', prodX: 9, pos: { x: 1, y: 2 } },
          { jid: 'a', prodX: 0, pos: { x: 1, y: 2 } },
        ],
        [{ cls: 8 }],
        [{ crdEncYX: 'k_q' }],
      ),
      BVG_PROFILE,
      0,
    );
    expect(res.map((v) => v.id)).toEqual(['a']);
    expect(res[0].frames).toBeUndefined();
  });

  it('wirft bei HAFAS-Fehlern', () => {
    expect(() => parseRadarResponse({ err: 'AUTH', errTxt: 'bad aid' }, BVG_PROFILE, 0)).toThrow(/AUTH/);
    expect(() => parseRadarResponse({ svcResL: [{ err: 'PARSE' }] }, BVG_PROFILE, 0)).toThrow(/PARSE/);
    expect(() => parseRadarResponse({}, BVG_PROFILE, 0)).toThrow(SourceError);
    expect(() => parseRadarResponse(null, BVG_PROFILE, 0)).toThrow(SourceError);
  });

  it('liefert eine leere Liste ohne Fahrzeuge', () => {
    expect(parseRadarResponse({ svcResL: [{ err: 'OK', res: { common: {} } }] }, BVG_PROFILE, 0)).toEqual([]);
  });
});

describe('createHafasRadarSource', () => {
  it('sendet POST mit JSON und parst die Antwort', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }));
    const src = createHafasRadarSource({ id: 't', label: 'T', attribution: 'x', profile: BVG_PROFILE, fetchImpl, now: () => 0 });
    const res = await src.fetchVehicles(BBOX, new AbortController().signal);
    expect(res).toHaveLength(5);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(BVG_PROFILE.endpoint);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string).svcReqL[0].meth).toBe('JourneyGeoPos');
  });

  it('meldet HTTP-Fehler als SourceError', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 }));
    const src = createHafasRadarSource({ id: 't', label: 'T', attribution: 'x', profile: BVG_PROFILE, fetchImpl });
    await expect(src.fetchVehicles(BBOX, new AbortController().signal)).rejects.toMatchObject({ name: 'SourceError', status: 503 });
  });

  it('meldet Netzwerkfehler als SourceError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const src = createHafasRadarSource({ id: 't', label: 'T', attribution: 'x', profile: BVG_PROFILE, fetchImpl });
    await expect(src.fetchVehicles(BBOX, new AbortController().signal)).rejects.toThrow('Netzwerkfehler');
  });
});
