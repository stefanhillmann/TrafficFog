import type { BBox, LatLon } from './types';

/** mittlerer Erdradius in Metern */
export const EARTH_RADIUS = 6_371_008.8;
const DEG = Math.PI / 180;
/** Meter pro Breitengrad */
export const METERS_PER_DEG_LAT = EARTH_RADIUS * DEG;

/**
 * Äquirektangulare Projektion um einen Ursprung. Liefert Meter, x nach Osten,
 * y nach Norden. Für Radien von wenigen Kilometern ist der Fehler vernachlässigbar.
 */
export interface LocalProjection {
  origin: LatLon;
  toLocal(p: LatLon): { x: number; y: number };
  toLatLon(x: number, y: number): LatLon;
}

export function createProjection(origin: LatLon): LocalProjection {
  const kx = METERS_PER_DEG_LAT * Math.cos(origin.lat * DEG);
  const ky = METERS_PER_DEG_LAT;
  return {
    origin,
    toLocal: (p) => ({ x: (p.lon - origin.lon) * kx, y: (p.lat - origin.lat) * ky }),
    toLatLon: (x, y) => ({ lat: origin.lat + y / ky, lon: origin.lon + x / kx }),
  };
}

/** Rundet auf `decimals` Nachkommastellen (Standard 3 ≈ 111 m Breite / 68 m Länge in Berlin). */
export function roundCoord(value: number, decimals = 3): number {
  const f = 10 ** decimals;
  // Number.EPSILON gleicht Darstellungsfehler wie 1.0005 → 1.000 aus
  return Math.round((value + Math.sign(value) * Number.EPSILON) * f) / f;
}

export function roundLatLon(p: LatLon, decimals = 3): LatLon {
  return { lat: roundCoord(p.lat, decimals), lon: roundCoord(p.lon, decimals) };
}

/**
 * Bounding Box mit `radiusMeters` um `center`. Die Kanten werden nach außen auf
 * `decimals` Stellen gerundet, damit die Box die gewünschte Fläche sicher abdeckt
 * und keine genaueren Koordinaten als nötig verlässt.
 */
export function bboxAround(center: LatLon, radiusMeters: number, decimals = 3): BBox {
  const dLat = radiusMeters / METERS_PER_DEG_LAT;
  const dLon = radiusMeters / (METERS_PER_DEG_LAT * Math.cos(center.lat * DEG));
  const f = 10 ** decimals;
  const up = (v: number) => roundCoord(Math.ceil(v * f - 1e-9) / f, decimals);
  const down = (v: number) => roundCoord(Math.floor(v * f + 1e-9) / f, decimals);
  return {
    north: up(center.lat + dLat),
    south: down(center.lat - dLat),
    east: up(center.lon + dLon),
    west: down(center.lon - dLon),
  };
}

/** Fläche einer Bounding Box in km² */
export function bboxAreaKm2(b: BBox): number {
  const midLat = ((b.north + b.south) / 2) * DEG;
  const h = (b.north - b.south) * METERS_PER_DEG_LAT;
  const w = (b.east - b.west) * METERS_PER_DEG_LAT * Math.cos(midLat);
  return (h * w) / 1e6;
}

/**
 * Höchstzahl der angefragten Fahrzeuge passend zur Fläche: ~6 Fahrzeuge/km²
 * deckt auch die Berliner Innenstadt ab; mindestens 256, höchstens 2500.
 */
export function suggestedMaxVehicles(b: BBox): number {
  return Math.min(2500, Math.max(256, Math.round(bboxAreaKm2(b) * 6)));
}

/** Distanz in Metern (äquirektangulare Näherung, für kurze Strecken ausreichend). */
export function distanceMeters(a: LatLon, b: LatLon): number {
  const x = (b.lon - a.lon) * DEG * Math.cos(((a.lat + b.lat) / 2) * DEG);
  const y = (b.lat - a.lat) * DEG;
  return Math.hypot(x, y) * EARTH_RADIUS;
}

/** Dekodiert eine Google-kodierte Polylinie (Genauigkeit 1e-5), wie HAFAS sie liefert. */
export function decodePolyline(encoded: string, precision = 5): LatLon[] {
  const out: LatLon[] = [];
  const factor = 10 ** precision;
  let i = 0;
  let lat = 0;
  let lon = 0;
  while (i < encoded.length) {
    for (let k = 0; k < 2; k++) {
      let shift = 0;
      let result = 0;
      let b: number;
      do {
        if (i >= encoded.length) throw new Error('Polylinie abgeschnitten');
        b = encoded.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (k === 0) lat += delta;
      else lon += delta;
    }
    out.push({ lat: lat / factor, lon: lon / factor });
  }
  return out;
}
