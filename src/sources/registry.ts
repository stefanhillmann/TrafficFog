import type { VehicleSource } from '../types';
import { BVG_PROFILE, createHafasRadarSource } from './hafas';
import { createSimSource } from './sim';
import { createTransportRestSource } from './transportRest';

export interface SourceEntry {
  description: string;
  /** erhält die URL-Parameter, falls eine Quelle eigene Optionen anbietet */
  create: (params: URLSearchParams) => VehicleSource;
}

/**
 * Alle verfügbaren Datenquellen. Eine neue Quelle braucht nur einen Eintrag hier:
 * Schlüssel = Wert für ?source=…, Wert = Fabrik, die eine VehicleSource erzeugt.
 */
export const SOURCES: Record<string, SourceEntry> = {
  bvg: {
    description: 'BVG-HAFAS-Radar (inoffiziell, Standard)',
    create: () =>
      createHafasRadarSource({
        id: 'bvg',
        label: 'BVG-Radar',
        attribution: 'Fahrzeugdaten: BVG/VBB via HAFAS',
        profile: BVG_PROFILE,
      }),
  },
  'vbb-rest': {
    description: 'transport.rest, Instanz v6.vbb',
    create: () =>
      createTransportRestSource({
        id: 'vbb-rest',
        label: 'v6.vbb.transport.rest',
        baseUrl: 'https://v6.vbb.transport.rest/',
        attribution: 'Fahrzeugdaten: VBB via transport.rest',
      }),
  },
  'bvg-rest': {
    description: 'transport.rest, Instanz v6.bvg',
    create: () =>
      createTransportRestSource({
        id: 'bvg-rest',
        label: 'v6.bvg.transport.rest',
        baseUrl: 'https://v6.bvg.transport.rest/',
        attribution: 'Fahrzeugdaten: BVG via transport.rest',
      }),
  },
  sim: {
    description: 'Simulierte Fahrzeuge (Demo); ?density=1…10 vervielfacht die Fahrzeuge',
    create: (params) => createSimSource({ density: Number(params.get('density')) || 1 }),
  },
};

export const DEFAULT_SOURCE = 'bvg';

/** Wählt die Quelle anhand von ?source=…; unbekannte Werte führen zu einem Fehler statt zu einem stillen Wechsel. */
export function resolveSource(search: string): { source?: VehicleSource; requested: string; error?: string } {
  const params = new URLSearchParams(search);
  const requested = params.get('source')?.trim() || DEFAULT_SOURCE;
  const entry = SOURCES[requested];
  if (!entry) {
    return { requested, error: `Unbekannte Quelle „${requested}“. Verfügbar: ${Object.keys(SOURCES).join(', ')}` };
  }
  return { requested, source: entry.create(params) };
}
