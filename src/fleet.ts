import type { LocalProjection } from './geo';
import { estimatePosition, type Sample } from './motion';
import type { Mode, Vehicle } from './types';

/** Wie lange ohne Frames höchstens fortgeschrieben wird */
export const MAX_EXTRAPOLATION_MS = 4_000;
/** Ab dieser Abweichung wird nicht weich korrigiert, sondern die Spur unterbrochen */
const TELEPORT_METERS = 250;
/** Zeitkonstante der weichen Korrektur */
const CORRECTION_TAU_MS = 1_800;
/** Unterhalb dieser Geschwindigkeit gilt ein Fahrzeug als stehend */
const STATIONARY_SPEED = 0.6;

export interface TrackedVehicle {
  id: string;
  mode: Mode;
  line: string;
  direction?: string;
  frames: Sample[];
  history: Sample[];
  /** Polling-Durchlauf, in dem das Fahrzeug zuletzt enthalten war */
  lastSeenPoll: number;
  /** aktuelle Anzeigeposition in lokalen Metern */
  x: number;
  y: number;
  speed: number;
  /** Korrekturversatz, der nach einer neuen Abfrage abklingt */
  offX: number;
  offY: number;
  /** wie lange das Fahrzeug schon steht (ms) */
  stillFor: number;
  /** true, wenn die Spur im nächsten Frame nicht mit der vorherigen Position verbunden werden soll */
  broken: boolean;
  /** Kennung für den Renderer (Zufallsstreuung, Strichphase …) */
  seed: number;
  initialized: boolean;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/** Hält alle bekannten Fahrzeuge und berechnet ihre Anzeigepositionen pro Animationsframe. */
export class Fleet {
  readonly vehicles = new Map<string, TrackedVehicle>();
  private poll = 0;

  constructor(private projection: LocalProjection) {}

  /** Übernimmt das Ergebnis einer Abfrage. */
  ingest(list: Vehicle[], now: number): void {
    this.poll++;
    const p = this.projection;
    for (const v of list) {
      const local = p.toLocal(v);
      const frames = (v.frames ?? []).map((f) => ({ t: f.t, ...p.toLocal(f) }));
      let tv = this.vehicles.get(v.id);
      if (!tv) {
        tv = {
          id: v.id,
          mode: v.mode,
          line: v.line,
          direction: v.direction,
          frames,
          history: [],
          lastSeenPoll: this.poll,
          x: local.x,
          y: local.y,
          speed: 0,
          offX: 0,
          offY: 0,
          stillFor: 0,
          broken: true,
          seed: hash(v.id),
          initialized: false,
        };
        this.vehicles.set(v.id, tv);
      } else {
        tv.frames = frames;
        tv.mode = v.mode;
        tv.line = v.line;
        tv.direction = v.direction;
        tv.lastSeenPoll = this.poll;
      }
      tv.history.push({ t: v.timestamp, x: local.x, y: local.y });
      if (tv.history.length > 2) tv.history.shift();

      if (tv.initialized) {
        // Abstand zwischen bisheriger Anzeige und neuer Schätzung als abklingenden Versatz übernehmen
        const est = estimatePosition(tv.frames, tv.history, now, MAX_EXTRAPOLATION_MS);
        if (est) {
          const dx = tv.x - est.x;
          const dy = tv.y - est.y;
          if (Math.hypot(dx, dy) > TELEPORT_METERS) {
            tv.offX = tv.offY = 0;
            tv.broken = true;
          } else {
            tv.offX = dx;
            tv.offY = dy;
          }
        }
      }
    }
    // Fahrzeuge, die zwei Abfragen in Folge fehlen, entfernen
    for (const [id, tv] of this.vehicles) {
      if (this.poll - tv.lastSeenPoll >= 2) this.vehicles.delete(id);
    }
  }

  /** Aktualisiert Anzeigepositionen; `dt` in ms seit dem letzten Aufruf. */
  step(now: number, dt: number): void {
    const decay = Math.exp(-dt / CORRECTION_TAU_MS);
    for (const tv of this.vehicles.values()) {
      const est = estimatePosition(tv.frames, tv.history, now, MAX_EXTRAPOLATION_MS);
      if (!est) continue;
      tv.offX *= decay;
      tv.offY *= decay;
      tv.x = est.x + tv.offX;
      tv.y = est.y + tv.offY;
      tv.speed = Math.hypot(est.vx, est.vy);
      // nur echte Halte verdichten den Nebel, nicht ein Stillstand mangels Daten
      if (est.stale) tv.stillFor = 0;
      else tv.stillFor = tv.speed < STATIONARY_SPEED ? tv.stillFor + dt : 0;
      tv.initialized = true;
    }
  }

  /** Verschiebt den Ursprung (z. B. nach einer genaueren Standortbestimmung). */
  setProjection(projection: LocalProjection): void {
    this.projection = projection;
    this.vehicles.clear();
  }
}
