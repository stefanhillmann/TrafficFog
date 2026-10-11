/** Verkehrsmittel, auf die jede Quelle ihre eigenen Kategorien abbildet. */
export type Mode = 'sbahn' | 'ubahn' | 'tram' | 'bus' | 'regional' | 'ferry';

export const MODES: readonly Mode[] = ['sbahn', 'ubahn', 'tram', 'bus', 'regional', 'ferry'];

export interface LatLon {
  lat: number;
  lon: number;
}

/** Eine vorausberechnete Position zu einem absoluten Zeitpunkt. */
export interface Frame extends LatLon {
  /** Unix-Zeit in Millisekunden */
  t: number;
}

/** Einheitliches Fahrzeugobjekt, das jeder Adapter liefert. */
export interface Vehicle extends LatLon {
  /** stabil über mehrere Abfragen hinweg (z. B. Fahrt-ID) */
  id: string;
  mode: Mode;
  /** Linienname, z. B. "S7", "M10", "100" */
  line: string;
  /** Fahrtziel bzw. Richtung, falls bekannt */
  direction?: string;
  /** Zeitpunkt, zu dem lat/lon gilt (Unix-ms) */
  timestamp: number;
  /** aufsteigend nach t sortiert; leer oder fehlend, wenn die Quelle keine liefert */
  frames?: Frame[];
}

export interface BBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

/**
 * Schnittstelle für Datenquellen. Neue Quellen implementieren dieses Interface
 * und werden in `sources/registry.ts` eingetragen.
 */
export interface VehicleSource {
  /** Kennung für ?source=… */
  readonly id: string;
  /** Kurzer Anzeigename für die Statuszeile */
  readonly label: string;
  /** Namensnennung der Daten, wird in der Fußzeile angezeigt */
  readonly attribution: string;
  /** Minimaler Abstand zwischen zwei Abfragen */
  readonly pollIntervalMs: number;
  /** true für simulierte Daten – wird in der Oberfläche gekennzeichnet */
  readonly simulated?: boolean;
  fetchVehicles(bbox: BBox, signal: AbortSignal): Promise<Vehicle[]>;
}
