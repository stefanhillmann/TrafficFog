import { suggestedMaxVehicles } from '../geo';
import type { BBox, Frame, Mode, Vehicle, VehicleSource } from '../types';
import { SourceError } from './errors';

/**
 * Adapter für transport.rest-Instanzen (hafas-rest-api) mit /radar-Endpunkt,
 * z. B. https://v6.vbb.transport.rest. Liefert dieselben HAFAS-Radar-Daten,
 * aufbereitet im FPTF-Format.
 */

const PRODUCTS: Record<string, Mode> = {
  suburban: 'sbahn',
  subway: 'ubahn',
  tram: 'tram',
  bus: 'bus',
  ferry: 'ferry',
  express: 'regional',
  regional: 'regional',
};

export interface RadarQuery {
  /** Höchstzahl; ohne Angabe passend zur Fläche der Box */
  results?: number;
  durationSec: number;
  frames: number;
}

export const DEFAULT_QUERY: RadarQuery = { durationSec: 30, frames: 4 };

export function buildRadarUrl(baseUrl: string, bbox: BBox, q: RadarQuery = DEFAULT_QUERY): string {
  const u = new URL('radar', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const p = u.searchParams;
  p.set('north', String(bbox.north));
  p.set('west', String(bbox.west));
  p.set('south', String(bbox.south));
  p.set('east', String(bbox.east));
  p.set('results', String(q.results ?? suggestedMaxVehicles(bbox)));
  p.set('duration', String(q.durationSec));
  p.set('frames', String(q.frames));
  p.set('polylines', 'true');
  p.set('pretty', 'false');
  return u.toString();
}

interface RawMovement {
  tripId?: string;
  direction?: string | null;
  line?: { name?: string; product?: string; mode?: string };
  location?: { latitude?: number; longitude?: number };
  frames?: { t?: number }[];
  polyline?: { features?: { geometry?: { coordinates?: [number, number] } }[] };
}

/**
 * Parst die /radar-Antwort. v6 liefert `{movements, realtimeDataUpdatedAt}`,
 * ältere Versionen ein reines Array. Frame-Zeiten sind relativ zur Anfrage.
 */
export function parseRadar(json: unknown, requestTime: number): Vehicle[] {
  let movements: unknown;
  if (Array.isArray(json)) movements = json;
  else if (json && typeof json === 'object' && Array.isArray((json as { movements?: unknown }).movements)) {
    movements = (json as { movements: unknown[] }).movements;
  } else throw new SourceError('Unerwartetes Antwortformat');

  const out: Vehicle[] = [];
  const seen = new Set<string>();
  for (const m of movements as RawMovement[]) {
    const lat = m.location?.latitude;
    const lon = m.location?.longitude;
    const mode = m.line?.product ? PRODUCTS[m.line.product] : undefined;
    if (!m.tripId || typeof lat !== 'number' || typeof lon !== 'number' || !mode || seen.has(m.tripId)) continue;
    seen.add(m.tripId);

    let frames: Frame[] | undefined;
    const fs = m.frames ?? [];
    const pts = m.polyline?.features ?? [];
    if (fs.length > 1 && pts.length === fs.length) {
      const candidate: Frame[] = [];
      for (let i = 0; i < fs.length; i++) {
        const c = pts[i].geometry?.coordinates;
        const t = fs[i].t;
        if (!c || typeof t !== 'number') break;
        candidate.push({ t: requestTime + t, lat: c[1], lon: c[0] });
      }
      if (candidate.length === fs.length) frames = candidate;
    }

    const direction = m.direction?.trim() || undefined;
    out.push({ id: m.tripId, mode, line: (m.line?.name ?? '').trim(), direction, lat, lon, timestamp: requestTime, frames });
  }
  return out;
}

export interface TransportRestConfig {
  id: string;
  label: string;
  baseUrl: string;
  attribution: string;
  pollIntervalMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function createTransportRestSource(cfg: TransportRestConfig): VehicleSource {
  const doFetch = cfg.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = cfg.now ?? (() => Date.now());
  return {
    id: cfg.id,
    label: cfg.label,
    attribution: cfg.attribution,
    // dokumentiertes Limit: 100 Anfragen/min für alle Nutzer zusammen
    pollIntervalMs: cfg.pollIntervalMs ?? 30_000,
    async fetchVehicles(bbox, signal) {
      const when = now();
      let resp: Response;
      try {
        resp = await doFetch(buildRadarUrl(cfg.baseUrl, bbox), {
          signal,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          headers: { Accept: 'application/json' },
        });
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        throw new SourceError('Netzwerkfehler', { cause: e });
      }
      if (!resp.ok) throw new SourceError(`HTTP ${resp.status}`, { status: resp.status });
      let json: unknown;
      try {
        json = await resp.json();
      } catch (e) {
        throw new SourceError('Antwort ist kein JSON', { cause: e });
      }
      return parseRadar(json, when);
    },
  };
}
