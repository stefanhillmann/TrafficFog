import type { LatLon } from './types';

export const ALEXANDERPLATZ: LatLon = { lat: 52.5219, lon: 13.4132 };

export interface ResolvedPosition {
  pos: LatLon;
  origin: 'gps' | 'url' | 'default';
  note?: string;
}

/** Liest ?at=lat,lon (z. B. für Demos) – bleibt rein lokal. */
export function positionFromUrl(search: string): LatLon | null {
  const at = new URLSearchParams(search).get('at');
  if (!at) return null;
  const [lat, lon] = at.split(',').map((s) => Number(s.trim()));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** Fragt den Standort über die Geolocation-API ab; bei Ablehnung oder Fehler gilt der Alexanderplatz. */
export async function resolvePosition(search: string): Promise<ResolvedPosition> {
  const fromUrl = positionFromUrl(search);
  if (fromUrl) return { pos: fromUrl, origin: 'url' };
  if (!('geolocation' in navigator)) {
    return { pos: ALEXANDERPLATZ, origin: 'default', note: 'Kein Standortzugriff verfügbar – Mitte ist der Alexanderplatz.' };
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ pos: { lat: p.coords.latitude, lon: p.coords.longitude }, origin: 'gps' }),
      (err) =>
        resolve({
          pos: ALEXANDERPLATZ,
          origin: 'default',
          note:
            err.code === err.PERMISSION_DENIED
              ? 'Standort nicht freigegeben – Mitte ist der Alexanderplatz.'
              : 'Standort nicht ermittelbar – Mitte ist der Alexanderplatz.',
        }),
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 300_000 },
    );
  });
}
