import { decodePolyline, suggestedMaxVehicles } from '../geo';
import type { BBox, Frame, Mode, Vehicle, VehicleSource } from '../types';
import { SourceError } from './errors';

/**
 * Generischer Adapter für HAFAS-„mgate“-Schnittstellen (Methode JourneyGeoPos,
 * die Radar-Abfrage). Ein Profil beschreibt Endpoint, Client-Kennung und die
 * Zuordnung der Produkt-Bitmasken zu Verkehrsmitteln.
 */
export interface HafasProfile {
  endpoint: string;
  auth: { type: string; aid: string };
  client: Record<string, string | number>;
  ext: string;
  ver: string;
  lang?: string;
  /** Produkt-Bitmaske (prodL[].cls) → Verkehrsmittel */
  products: Record<number, Mode>;
  /** Zeitzone für die date/time-Felder */
  timeZone: string;
}

/** BVG-Web-App-Profil, entnommen aus dem Open-Source-Projekt hafas-client (p/bvg). */
export const BVG_PROFILE: HafasProfile = {
  endpoint: 'https://bvg.hafas.cloud/apps/gate',
  auth: { type: 'AID', aid: 'dVg4TZbW8anjx9ztPwe2uk4LVRi9wO' },
  client: { type: 'WEB', id: 'VBB', v: 10002, name: 'webapp' },
  ext: 'BVG.1',
  ver: '1.72',
  lang: 'de',
  products: { 1: 'sbahn', 2: 'ubahn', 4: 'tram', 8: 'bus', 16: 'ferry', 32: 'regional', 64: 'regional' },
  timeZone: 'Europe/Berlin',
};

export interface RadarOptions {
  /** Höchstzahl; ohne Angabe passend zur Fläche der Box */
  maxVehicles?: number;
  /** Zeitraum der vorausberechneten Frames in Sekunden */
  durationSec: number;
  /** Abstand zwischen zwei Frames in Sekunden */
  stepSec: number;
}

export const DEFAULT_RADAR_OPTIONS: RadarOptions = { durationSec: 35, stepSec: 5 };

/** Formatiert einen Zeitpunkt als HAFAS-Datum (YYYYMMDD) und -Uhrzeit (HHMMSS) in der Zielzeitzone. */
export function formatHafasDateTime(when: number, timeZone: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(when))
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}${parts.month}${parts.day}`, time: `${parts.hour}${parts.minute}${parts.second}` };
}

/** Wandelt HAFAS-Datum und -Uhrzeit in der Zielzeitzone in Unix-ms um. */
export function parseHafasDateTime(date: string, time: string, timeZone: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(date);
  // HAFAS kann Uhrzeiten über Mitternacht als DDHHMMSS kodieren
  const tm = /^(\d{2})?(\d{2})(\d{2})(\d{2})$/.exec(time);
  if (!m || !tm) throw new SourceError(`Ungültige HAFAS-Zeit: ${date} ${time}`);
  const dayOffset = tm[1] ? Number(tm[1]) : 0;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3] + dayOffset, +tm[2], +tm[3], +tm[4]);
  // Offset der Zielzeitzone zu diesem Zeitpunkt bestimmen (zweimal für Zeitumstellungen)
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const f = formatHafasDateTime(guess, timeZone);
    const shown = Date.UTC(+f.date.slice(0, 4), +f.date.slice(4, 6) - 1, +f.date.slice(6, 8), +f.time.slice(0, 2), +f.time.slice(2, 4), +f.time.slice(4, 6));
    guess += asUtc - shown;
  }
  return guess;
}

export function buildRadarRequest(profile: HafasProfile, bbox: BBox, when: number, opts: RadarOptions = DEFAULT_RADAR_OPTIONS) {
  const { date, time } = formatHafasDateTime(when, profile.timeZone);
  const micro = (v: number) => Math.round(v * 1e6);
  return {
    lang: profile.lang ?? 'de',
    svcReqL: [
      {
        meth: 'JourneyGeoPos',
        req: {
          maxJny: opts.maxVehicles ?? suggestedMaxVehicles(bbox),
          onlyRT: false,
          date,
          time,
          rect: {
            llCrd: { x: micro(bbox.west), y: micro(bbox.south) },
            urCrd: { x: micro(bbox.east), y: micro(bbox.north) },
          },
          perSize: opts.durationSec * 1000,
          perStep: opts.stepSec * 1000,
          ageOfReport: true,
          trainPosMode: 'CALC',
        },
      },
    ],
    auth: profile.auth,
    client: profile.client,
    ext: profile.ext,
    ver: profile.ver,
  };
}

/* Ausschnitt der Antwortstruktur, soweit wir sie lesen */
interface RawProduct {
  cls?: number;
  name?: string;
  nameS?: string;
  prodCtx?: { line?: string };
}
interface RawPoly {
  crdEncYX?: string;
}
interface RawJourney {
  jid?: string;
  prodX?: number;
  pos?: { x: number; y: number };
  dirTxt?: string;
  ani?: { mSec?: number[]; polyG?: { polyXL?: number[] } };
}
interface RawResponse {
  err?: string;
  errTxt?: string;
  svcResL?: {
    err?: string;
    errTxt?: string;
    res?: {
      date?: string;
      time?: string;
      jnyL?: RawJourney[];
      common?: { prodL?: RawProduct[]; polyL?: RawPoly[] };
    };
  }[];
}

/**
 * Wandelt eine JourneyGeoPos-Antwort in Fahrzeuge um.
 * `requestTime` dient als Bezug für die Frames, falls die Antwort keine Zeit enthält.
 */
export function parseRadarResponse(json: unknown, profile: HafasProfile, requestTime: number): Vehicle[] {
  const raw = json as RawResponse;
  if (!raw || typeof raw !== 'object') throw new SourceError('Leere Antwort');
  if (raw.err && raw.err !== 'OK') throw new SourceError(`HAFAS-Fehler ${raw.err}${raw.errTxt ? `: ${raw.errTxt}` : ''}`);
  const svc = raw.svcResL?.[0];
  if (!svc) throw new SourceError('Antwort ohne svcResL');
  if (svc.err && svc.err !== 'OK') throw new SourceError(`HAFAS-Fehler ${svc.err}${svc.errTxt ? `: ${svc.errTxt}` : ''}`);
  const res = svc.res;
  if (!res) throw new SourceError('Antwort ohne res');

  const base = res.date && res.time ? parseHafasDateTime(res.date, res.time, profile.timeZone) : Math.floor(requestTime / 1000) * 1000;
  const prodL = res.common?.prodL ?? [];
  const polyL = res.common?.polyL ?? [];
  const vehicles: Vehicle[] = [];
  const seen = new Set<string>();

  for (const j of res.jnyL ?? []) {
    if (!j.jid || !j.pos || seen.has(j.jid)) continue;
    const prod = j.prodX !== undefined ? prodL[j.prodX] : undefined;
    const mode = prod?.cls !== undefined ? profile.products[prod.cls] : undefined;
    if (!mode) continue;
    seen.add(j.jid);

    const lat = j.pos.y / 1e6;
    const lon = j.pos.x / 1e6;
    let frames: Frame[] | undefined;
    const mSec = j.ani?.mSec;
    const polyIdx = j.ani?.polyG?.polyXL?.[0];
    const enc = polyIdx !== undefined ? polyL[polyIdx]?.crdEncYX : undefined;
    if (mSec && mSec.length > 1 && enc) {
      try {
        const pts = decodePolyline(enc);
        // Die Radar-Polylinie enthält genau einen Punkt pro Frame
        if (pts.length === mSec.length) {
          frames = pts.map((p, i) => ({ t: base + mSec[i], lat: p.lat, lon: p.lon }));
        }
      } catch {
        frames = undefined;
      }
    }

    const line = (prod?.prodCtx?.line ?? prod?.nameS ?? prod?.name ?? '').trim();
    const direction = j.dirTxt?.trim() || undefined;
    vehicles.push({ id: j.jid, mode, line, direction, lat, lon, timestamp: base, frames });
  }
  return vehicles;
}

export interface HafasSourceConfig {
  id: string;
  label: string;
  attribution: string;
  profile: HafasProfile;
  pollIntervalMs?: number;
  radar?: Partial<RadarOptions>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function createHafasRadarSource(cfg: HafasSourceConfig): VehicleSource {
  const radar = { ...DEFAULT_RADAR_OPTIONS, ...cfg.radar };
  const doFetch = cfg.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = cfg.now ?? (() => Date.now());
  return {
    id: cfg.id,
    label: cfg.label,
    attribution: cfg.attribution,
    pollIntervalMs: cfg.pollIntervalMs ?? 25_000,
    async fetchVehicles(bbox, signal) {
      const when = now();
      const body = buildRadarRequest(cfg.profile, bbox, when, radar);
      let resp: Response;
      try {
        resp = await doFetch(cfg.profile.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
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
      return parseRadarResponse(json, cfg.profile, when);
    },
  };
}
