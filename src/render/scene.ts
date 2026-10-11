import type { Fleet } from '../fleet';
import { DepositLayer, FogLayer } from './fog';
import { Fader } from './fader';
import type { Mode } from '../types';
import { STYLES, rgba } from './styles';
import { TrailLayer } from './trails';

/** mögliche Ringradien; angezeigt werden die, die zum Radius passen */
export const RING_CANDIDATES_M = [250, 500, 1000, 2000, 5000, 10_000];
/** Anteil des Abfrageradius, der in die kürzere Bildschirmseite passt */
const FIT_FRACTION = 0.86;

/** Ringe, die innerhalb des sichtbaren Radius liegen und nicht zu dicht beieinander sind. */
export function ringsFor(fitRadiusM: number, pxPerMeter: number): number[] {
  const rings = RING_CANDIDATES_M.filter((m) => m <= fitRadiusM * 1.001 && m * pxPerMeter >= 22);
  return rings.slice(-3);
}

/** Hervorgehobene Spur beim Zeigen (lokale Meter) */
export interface Highlight {
  mode: Mode;
  runs: { x: number; y: number }[][];
  head: { x: number; y: number };
  active: boolean;
}
const MAX_DPR = 2;

/** Hauptszene: Hintergrund, Nebel, Verdichtungen, Spuren, Ringe und eigene Position. */
export class Scene {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly background = document.createElement('canvas');
  readonly trails = new TrailLayer();
  readonly fog = new FogLayer();
  readonly deposits = new DepositLayer();
  readonly fader: Fader;
  private w = 0;
  private h = 0;
  private dpr = 1;
  /** Pixel pro Meter */
  scale = 1;
  highlight: Highlight | null = null;
  private radiusM: number;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    persistenceSec: number,
    radiusM: number,
  ) {
    this.radiusM = radiusM;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.fader = new Fader(persistenceSec);
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    // Versteckte oder eingeklappte Ansichten melden Größe 0 – dann nichts verwerfen
    if (rect.width < 2 || rect.height < 2) return;
    if (rect.width === this.w && rect.height === this.h && dpr === this.dpr) return;
    this.w = rect.width;
    this.h = rect.height;
    this.dpr = dpr;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.scale = this.computeScale();
    this.trails.resize(this.w, this.h, this.dpr);
    this.fog.resize(this.w, this.h);
    this.deposits.resize(this.w, this.h, this.dpr);
    this.paintBackground();
  }

  private computeScale(): number {
    return (Math.min(this.w, this.h) / 2 - 14) / (this.radiusM * FIT_FRACTION);
  }

  /** Nachleuchtdauer in Sekunden; Infinity = Spuren bleiben stehen */
  setPersistence(sec: number): void {
    this.fader.persistenceSec = sec;
    this.deposits.fader.persistenceSec = Number.isFinite(sec) ? Math.max(180, sec * 6) : Infinity;
  }

  /** Abfrageradius in Metern; skaliert die vorhandenen Spuren mit. */
  setRadius(radiusM: number): void {
    if (radiusM === this.radiusM) return;
    this.radiusM = radiusM;
    if (this.w === 0) return;
    const next = this.computeScale();
    const factor = next / this.scale;
    this.scale = next;
    this.trails.rescale(factor);
    this.trails.resetPaths();
    this.deposits.rescale(factor);
  }

  /** Projektion lokaler Meter → CSS-Pixel */
  readonly toScreen = (x: number, y: number): [number, number] => [this.w / 2 + x * this.scale, this.h / 2 - y * this.scale];

  /** CSS-Pixel → lokale Meter */
  toLocal(px: number, py: number): { x: number; y: number } {
    return { x: (px - this.w / 2) / this.scale, y: -(py - this.h / 2) / this.scale };
  }

  clearTrails(): void {
    this.trails.clear();
    this.deposits.clear();
  }

  private paintBackground(): void {
    const b = this.background;
    b.width = this.canvas.width;
    b.height = this.canvas.height;
    const g = b.getContext('2d')!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const r = Math.hypot(this.w, this.h) / 2;
    const grad = g.createRadialGradient(this.w / 2, this.h / 2, 0, this.w / 2, this.h / 2, r);
    grad.addColorStop(0, '#0c1219');
    grad.addColorStop(0.55, '#070a0f');
    grad.addColorStop(1, '#020305');
    g.fillStyle = grad;
    g.fillRect(0, 0, this.w, this.h);
  }

  /**
   * Zeichnet einen Frame. Bei `running = false` (Pause) werden Spuren weder
   * verlängert noch ausgeblendet; nur der Nebel bewegt sich weiter.
   */
  render(fleet: Fleet, nowMs: number, dtMs: number, running: boolean, hasPosition: boolean): void {
    const c = this.ctx;
    const t = nowMs / 1000;
    if (running) {
      this.trails.fade(this.fader.next(dtMs / 1000));
      this.trails.update(fleet.vehicles.values(), this.toScreen, dtMs);
      this.deposits.update(fleet.vehicles.values(), this.toScreen, dtMs);
    }
    this.fog.update(t, dtMs / 1000);

    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.drawImage(this.background, 0, 0);
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.fog.draw(c, t);

    c.globalCompositeOperation = 'lighter';
    c.drawImage(this.deposits.canvas, 0, 0, this.w, this.h);
    c.drawImage(this.trails.canvas, 0, 0, this.w, this.h);
    c.globalCompositeOperation = 'source-over';

    this.drawRings(c);
    if (this.highlight) this.drawHighlight(c, this.highlight, t);
    this.drawHeads(c, fleet, t);
    if (hasPosition) this.drawSelf(c, t);
  }

  private drawRings(c: CanvasRenderingContext2D): void {
    const cx = this.w / 2;
    const cy = this.h / 2;
    c.lineWidth = 1;
    c.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    for (const m of ringsFor(this.radiusM * FIT_FRACTION, this.scale)) {
      const r = m * this.scale;
      c.strokeStyle = 'rgba(150,175,205,0.11)';
      c.setLineDash(m === 1000 || m === 10_000 ? [] : [2, 5]);
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = 'rgba(160,185,215,0.32)';
      const a = -Math.PI / 4;
      c.fillText(m >= 1000 ? `${m / 1000} km` : `${m} m`, cx + Math.cos(a) * r + 4, cy + Math.sin(a) * r - 4);
    }
    c.setLineDash([]);
  }

  private drawHighlight(c: CanvasRenderingContext2D, h: Highlight, t: number): void {
    const col = STYLES[h.mode].color;
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (const [width, alpha] of [
      [9, 0.07],
      [3, 0.16],
    ] as const) {
      c.lineWidth = width;
      c.strokeStyle = rgba(col, alpha);
      for (const run of h.runs) {
        if (run.length < 2) continue;
        c.beginPath();
        run.forEach((p, i) => {
          const [x, y] = this.toScreen(p.x, p.y);
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        });
        c.stroke();
      }
    }
    const [hx, hy] = this.toScreen(h.head.x, h.head.y);
    c.globalCompositeOperation = 'source-over';
    c.strokeStyle = rgba(col, h.active ? 0.55 + 0.2 * Math.sin(t * 4) : 0.3);
    c.lineWidth = 1;
    c.setLineDash(h.active ? [] : [2, 3]);
    c.beginPath();
    c.arc(hx, hy, 7, 0, Math.PI * 2);
    c.stroke();
    c.restore();
  }

  private drawHeads(c: CanvasRenderingContext2D, fleet: Fleet, t: number): void {
    c.globalCompositeOperation = 'lighter';
    for (const tv of fleet.vehicles.values()) {
      if (!tv.initialized) continue;
      const [x, y] = this.toScreen(tv.x, tv.y);
      if (x < -5 || y < -5 || x > this.w + 5 || y > this.h + 5) continue;
      const st = STYLES[tv.mode];
      const flicker = 0.75 + 0.25 * Math.sin(t * 7 + tv.seed * 40);
      c.fillStyle = rgba(st.color, 0.75 * flicker);
      c.beginPath();
      c.arc(x, y, st.dropRadius * 0.9 + 0.4, 0, Math.PI * 2);
      c.fill();
    }
    c.globalCompositeOperation = 'source-over';
  }

  private drawSelf(c: CanvasRenderingContext2D, t: number): void {
    const cx = this.w / 2;
    const cy = this.h / 2;
    const p = (Math.sin(t * 1.4) + 1) / 2; // ruhiges Pulsieren
    const halo = c.createRadialGradient(cx, cy, 0, cx, cy, 18 + p * 6);
    halo.addColorStop(0, `rgba(235,245,255,${0.22 + p * 0.12})`);
    halo.addColorStop(1, 'rgba(235,245,255,0)');
    c.fillStyle = halo;
    c.beginPath();
    c.arc(cx, cy, 24, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(245,250,255,0.95)';
    c.beginPath();
    c.arc(cx, cy, 2.6, 0, Math.PI * 2);
    c.fill();
  }
}
