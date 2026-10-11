import type { Mode } from './types';

/**
 * Merkt sich den sichtbaren Verlauf jeder Spur in lokalen Metern, damit sich
 * beim Zeigen mit Maus oder Finger herausfinden lässt, wozu eine Spur gehört.
 *
 * Zeiten laufen auf einer eigenen „Spur-Uhr“, die nur weiterläuft, solange die
 * Animation läuft. So passen Alter und Sichtbarkeit auch nach einer Pause zur
 * Darstellung.
 */

export interface TrailMeta {
  id: string;
  mode: Mode;
  line: string;
  direction?: string;
}

interface TrailPoint {
  x: number;
  y: number;
  /** Spur-Uhr (für Sichtbarkeit) */
  t: number;
  /** echte Uhrzeit (für die Anzeige „vor … s“) */
  wall: number;
  /** true: keine Verbindung zum vorherigen Punkt (Spur unterbrochen) */
  gap: boolean;
}

interface Entry {
  meta: TrailMeta;
  points: TrailPoint[];
  /** ob das Fahrzeug aktuell noch verfolgt wird */
  active: boolean;
}

export interface TrailHit {
  meta: TrailMeta;
  /** Abstand zum Zeigepunkt in Metern */
  distance: number;
  /** Alter des getroffenen Spurstücks (ms Spur-Uhr) */
  age: number;
  /** echte Zeit seit dem Durchfahren dieses Spurstücks (ms) */
  wallAge: number;
  /** Fahrzeug noch im Bereich unterwegs */
  active: boolean;
  /** aktuelle bzw. letzte Position */
  head: { x: number; y: number };
}

export interface TrackInput extends TrailMeta {
  x: number;
  y: number;
  broken: boolean;
}

export class TrailIndex {
  private readonly entries = new Map<string, Entry>();

  constructor(
    /** Mindestabstand zwischen gespeicherten Punkten in Metern */
    public minStep = 12,
    /** Obergrenze für alle gespeicherten Punkte zusammen */
    private readonly maxPoints = 250_000,
  ) {}

  /** Nimmt die aktuellen Positionen auf; Fahrzeuge, die fehlen, gelten als inaktiv. */
  update(vehicles: Iterable<TrackInput>, now: number, wall = now): void {
    for (const e of this.entries.values()) e.active = false;
    for (const v of vehicles) {
      let e = this.entries.get(v.id);
      if (!e) {
        e = { meta: { id: v.id, mode: v.mode, line: v.line, direction: v.direction }, points: [], active: true };
        this.entries.set(v.id, e);
      }
      e.active = true;
      e.meta.mode = v.mode;
      e.meta.line = v.line;
      e.meta.direction = v.direction;
      const pts = e.points;
      const last = pts[pts.length - 1];
      if (!last || v.broken) {
        pts.push({ x: v.x, y: v.y, t: now, wall, gap: true });
        continue;
      }
      // Spur = feste Ankerpunkte + mitlaufende Spitze; ab minStep wird die Spitze zum Anker
      const anchor = pts.length > 1 && !last.gap ? pts[pts.length - 2] : null;
      if (anchor && Math.hypot(last.x - anchor.x, last.y - anchor.y) < this.minStep) {
        last.x = v.x;
        last.y = v.y;
        last.t = now;
        last.wall = wall;
      } else {
        pts.push({ x: v.x, y: v.y, t: now, wall, gap: false });
      }
    }
  }

  /**
   * Entfernt Punkte, die älter als `maxAge` sind, und leere, inaktive Spuren.
   * Wird das Punktbudget überschritten (lange oder unendliche Nachleuchtdauer),
   * fallen zusätzlich die ältesten Punkte weg.
   */
  prune(now: number, maxAge: number): void {
    this.pruneAge(now, maxAge);
    let total = this.pointCount;
    if (total <= this.maxPoints) return;
    let oldest = now;
    for (const e of this.entries.values()) if (e.points.length) oldest = Math.min(oldest, e.points[0].t);
    let age = Number.isFinite(maxAge) ? Math.min(maxAge, now - oldest) : now - oldest;
    for (let i = 0; i < 20 && total > this.maxPoints * 0.9; i++) {
      age *= 0.8;
      this.pruneAge(now, age);
      total = this.pointCount;
    }
  }

  get pointCount(): number {
    let n = 0;
    for (const e of this.entries.values()) n += e.points.length;
    return n;
  }

  private pruneAge(now: number, maxAge: number): void {
    for (const [id, e] of this.entries) {
      const pts = e.points;
      // vorne kürzen, solange auch das folgende Segment schon verblasst ist
      let drop = 0;
      while (drop + 1 < pts.length && now - pts[drop + 1].t > maxAge) drop++;
      if (drop) pts.splice(0, drop);
      const newest = pts[pts.length - 1];
      if (!e.active && (!newest || now - newest.t > maxAge)) this.entries.delete(id);
    }
  }

  /** Nächstgelegene sichtbare Spur innerhalb `maxDistance` Metern, sonst null. */
  nearest(x: number, y: number, maxDistance: number, now: number, maxAge: number, wall = now): TrailHit | null {
    let best: TrailHit | null = null;
    for (const e of this.entries.values()) {
      const pts = e.points;
      if (!pts.length) continue;
      for (let i = 0; i < pts.length; i++) {
        const b = pts[i];
        const a = i > 0 && !b.gap ? pts[i - 1] : b;
        const age = now - b.t;
        if (age > maxAge) continue;
        const d = distanceToSegment(x, y, a.x, a.y, b.x, b.y);
        // bei gleichem Abstand gewinnt das jüngere, also hellere Spurstück
        if (d <= maxDistance && (!best || d < best.distance - 1e-6 || (Math.abs(d - best.distance) < 1e-6 && age < best.age))) {
          const head = pts[pts.length - 1];
          best = { meta: e.meta, distance: d, age, wallAge: Math.max(0, wall - b.wall), active: e.active, head: { x: head.x, y: head.y } };
        }
      }
    }
    return best;
  }

  /** Punkte einer Spur (für die Hervorhebung), aufgeteilt an Unterbrechungen. */
  path(id: string, now: number, maxAge: number): { x: number; y: number }[][] {
    const e = this.entries.get(id);
    if (!e) return [];
    const runs: { x: number; y: number }[][] = [];
    for (const p of e.points) {
      if (now - p.t > maxAge && runs.length === 0) continue;
      if (p.gap || runs.length === 0) runs.push([]);
      runs[runs.length - 1].push({ x: p.x, y: p.y });
    }
    return runs;
  }

  get size(): number {
    return this.entries.size;
  }
}

export function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
