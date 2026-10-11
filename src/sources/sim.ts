import { createProjection } from '../geo';
import type { BBox, Frame, Mode, Vehicle, VehicleSource } from '../types';

/**
 * Simulierte Fahrzeuge für Entwicklung und Demo (?source=sim).
 * Erzeugt deterministische Linien um die Mitte der angefragten Box. Fahrzeuge
 * pendeln zwischen Halten mit Haltezeiten, so dass auch Haltestellen-Flecken
 * entstehen.
 */

interface SimLine {
  line: string;
  mode: Mode;
  /** Stützpunkte in Metern relativ zur Mitte */
  path: [number, number][];
  speed: number; // m/s
  stopSpacing: number; // m
  dwell: number; // s
  vehicles: number; // pro Richtung
}

function straight(angleDeg: number, offset: number, half = 3200): [number, number][] {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const nx = -dy * offset;
  const ny = dx * offset;
  return [
    [nx - dx * half, ny - dy * half],
    [nx + dx * half, ny + dy * half],
  ];
}

function arc(cx: number, cy: number, r: number, fromDeg: number, toDeg: number, steps = 40): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((fromDeg + ((toDeg - fromDeg) * i) / steps) * Math.PI) / 180;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

function manhattan(start: [number, number], moves: [number, number][]): [number, number][] {
  const pts: [number, number][] = [start];
  let [x, y] = start;
  for (const [dx, dy] of moves) {
    x += dx;
    y += dy;
    pts.push([x, y]);
  }
  return pts;
}

function wave(y0: number, amp: number, len = 6000, steps = 60): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const x = -len / 2 + (len * i) / steps;
    pts.push([x, y0 + Math.sin(x / 700) * amp + Math.sin(x / 260) * amp * 0.25]);
  }
  return pts;
}

const LINES: SimLine[] = [
  { line: 'S7', mode: 'sbahn', path: straight(12, -150), speed: 15, stopSpacing: 1300, dwell: 35, vehicles: 2 },
  { line: 'S41', mode: 'sbahn', path: straight(-58, 900), speed: 14, stopSpacing: 1100, dwell: 30, vehicles: 2 },
  { line: 'U8', mode: 'ubahn', path: straight(88, 120), speed: 11, stopSpacing: 750, dwell: 22, vehicles: 3 },
  { line: 'U2', mode: 'ubahn', path: straight(-20, -650), speed: 10, stopSpacing: 700, dwell: 22, vehicles: 3 },
  { line: 'M10', mode: 'tram', path: arc(-1400, -1800, 2400, 20, 115), speed: 7, stopSpacing: 420, dwell: 20, vehicles: 3 },
  { line: 'M4', mode: 'tram', path: arc(2200, 1500, 2600, 175, 255), speed: 7.5, stopSpacing: 450, dwell: 18, vehicles: 3 },
  { line: '100', mode: 'bus', path: manhattan([-2400, 300], [[900, 0], [0, -600], [1300, 0], [0, 900], [1600, 0], [0, -500], [700, 0]]), speed: 6, stopSpacing: 330, dwell: 14, vehicles: 3 },
  { line: '200', mode: 'bus', path: manhattan([600, 2400], [[0, -900], [-700, 0], [0, -1200], [500, 0], [0, -1300], [-900, 0], [0, -700]]), speed: 5.5, stopSpacing: 300, dwell: 14, vehicles: 3 },
  { line: 'TXL', mode: 'bus', path: manhattan([-2600, -1600], [[1200, 0], [0, 800], [1500, 0], [400, 700], [1700, 0]]), speed: 6.5, stopSpacing: 400, dwell: 12, vehicles: 2 },
  { line: 'RE1', mode: 'regional', path: straight(3, 420, 4000), speed: 24, stopSpacing: 4000, dwell: 60, vehicles: 1 },
  { line: 'F10', mode: 'ferry', path: wave(-1450, 160), speed: 4, stopSpacing: 1500, dwell: 40, vehicles: 1 },
];

interface Knot {
  t: number; // s seit Beginn des Umlaufs
  d: number; // m entlang der Strecke
}

interface PreparedLine extends SimLine {
  cum: number[]; // kumulierte Länge je Stützpunkt
  length: number;
  knots: Knot[]; // Hin- und Rückfahrt
  period: number;
}

function prepare(l: SimLine): PreparedLine {
  const cum = [0];
  for (let i = 1; i < l.path.length; i++) {
    const [x0, y0] = l.path[i - 1];
    const [x1, y1] = l.path[i];
    cum.push(cum[i - 1] + Math.hypot(x1 - x0, y1 - y0));
  }
  const length = cum[cum.length - 1];
  const stops: number[] = [];
  const n = Math.max(1, Math.round(length / l.stopSpacing));
  for (let i = 0; i <= n; i++) stops.push((length * i) / n);
  // Pendelbetrieb: hin und zurück
  const sequence = [...stops, ...stops.slice(0, -1).reverse()];
  const knots: Knot[] = [];
  let t = 0;
  for (let i = 0; i < sequence.length; i++) {
    knots.push({ t, d: sequence[i] });
    t += l.dwell;
    knots.push({ t, d: sequence[i] });
    if (i < sequence.length - 1) t += Math.abs(sequence[i + 1] - sequence[i]) / l.speed;
  }
  return { ...l, cum, length, knots, period: t };
}

const PREPARED = LINES.map(prepare);

function distanceAt(l: PreparedLine, tSec: number): number {
  const t = ((tSec % l.period) + l.period) % l.period;
  const k = l.knots;
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i].t) {
      const a = k[i - 1];
      const b = k[i];
      const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      // weiches Anfahren und Bremsen
      const e = f * f * (3 - 2 * f);
      return a.d + (b.d - a.d) * e;
    }
  }
  return k[k.length - 1].d;
}

function pointAt(l: PreparedLine, d: number): [number, number] {
  const { cum, path } = l;
  for (let i = 1; i < cum.length; i++) {
    if (d <= cum[i]) {
      const f = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * f, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * f];
    }
  }
  return path[path.length - 1];
}

export interface SimOptions {
  now?: () => number;
  pollIntervalMs?: number;
  /** Vervielfacht die Fahrzeuge je Linie (Lasttest), 1–10 */
  density?: number;
}

export function createSimSource(opts: SimOptions = {}): VehicleSource {
  const now = opts.now ?? (() => Date.now());
  const density = Math.min(10, Math.max(1, Math.round(opts.density ?? 1)));
  return {
    id: 'sim',
    label: 'Simulation',
    attribution: 'Simulierte Daten',
    pollIntervalMs: opts.pollIntervalMs ?? 15_000,
    simulated: true,
    async fetchVehicles(bbox: BBox): Promise<Vehicle[]> {
      const center = { lat: (bbox.north + bbox.south) / 2, lon: (bbox.east + bbox.west) / 2 };
      const proj = createProjection(center);
      const t0 = now();
      const out: Vehicle[] = [];
      for (const l of PREPARED) {
        const total = l.vehicles * 2 * density;
        for (let k = 0; k < total; k++) {
          const phase = (l.period * k) / total;
          const frames: Frame[] = [];
          for (let s = 0; s <= 30; s += 10) {
            const t = t0 + s * 1000;
            const [x, y] = pointAt(l, distanceAt(l, t / 1000 + phase));
            frames.push({ t, ...proj.toLatLon(x, y) });
          }
          const f0 = frames[0];
          if (f0.lat > bbox.north || f0.lat < bbox.south || f0.lon > bbox.east || f0.lon < bbox.west) continue;
          out.push({ id: `${l.line}-${k}`, mode: l.mode, line: l.line, lat: f0.lat, lon: f0.lon, timestamp: t0, frames });
        }
      }
      return out;
    },
  };
}
