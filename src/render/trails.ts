import type { TrackedVehicle } from '../fleet';
import { MODES, type Mode } from '../types';
import { STYLES, type TrailStyle } from './styles';

interface TrailState {
  /** zuletzt verarbeiteter (ggf. geglätteter) Punkt in CSS-Pixeln */
  lx: number;
  ly: number;
  /** Weg seit dem letzten Stempel */
  carry: number;
  /** zurückgelegter Weg insgesamt (für Strich- und Wellenphase) */
  dist: number;
  /** aktueller Versatz des Zufallspfads */
  jitter: number;
  /** Frame-Zähler der letzten Aktualisierung (zum Aufräumen) */
  seen: number;
}

/** Größter Sprung pro Frame, der noch als Spur gezeichnet wird */
const MAX_SEGMENT_PX = 40;
const SPRITE_SIZE = 32;

/** Erzeugt ein weiches, rundes Tröpfchen in der Farbe des Verkehrsmittels. */
function makeDroplet(color: [number, number, number], coreWhite: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = SPRITE_SIZE;
  const g = c.getContext('2d')!;
  const r = SPRITE_SIZE / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  // aufgehellter Kern; niedrige Werte halten die Farbe satt
  const [cr, cg, cb] = color;
  const core = (v: number) => Math.round(v + (255 - v) * coreWhite);
  grad.addColorStop(0, `rgba(${core(cr)},${core(cg)},${core(cb)},1)`);
  grad.addColorStop(0.35, `rgba(${cr},${cg},${cb},0.8)`);
  grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  return c;
}

/** Spuren auf einem eigenen Offscreen-Canvas, der pro Frame leicht ausgeblendet wird. */
export class TrailLayer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites = new Map<Mode, HTMLCanvasElement>();
  private readonly state = new Map<string, TrailState>();
  private frame = 0;
  private w = 0;
  private h = 0;
  /** Zufallsquelle, austauschbar für Tests */
  random: () => number = Math.random;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    for (const m of MODES) this.sprites.set(m, makeDroplet(STYLES[m].color, STYLES[m].core));
  }

  /** Passt die Größe an und übernimmt den bisherigen Inhalt mittig. */
  resize(w: number, h: number, dpr: number): void {
    const old = this.canvas.width > 0 ? this.snapshot() : null;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    if (old) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.drawImage(old, (this.canvas.width - old.width) / 2, (this.canvas.height - old.height) / 2);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Pfade neu beginnen, sonst entstehen Striche über den Versatz
    this.state.clear();
  }

  /** Skaliert den vorhandenen Inhalt um die Bildmitte (z. B. nach Radiusänderung). */
  rescale(factor: number): void {
    if (!(factor > 0) || factor === 1 || this.canvas.width === 0) return;
    const old = this.snapshot();
    const c = this.ctx;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const w = this.canvas.width * factor;
    const h = this.canvas.height * factor;
    c.imageSmoothingEnabled = true;
    c.drawImage(old, (this.canvas.width - w) / 2, (this.canvas.height - h) / 2, w, h);
    c.restore();
  }

  private snapshot(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    c.getContext('2d')!.drawImage(this.canvas, 0, 0);
    return c;
  }

  /** Alle Spuren beim nächsten Frame neu beginnen (ohne Verbindung zur alten Position). */
  resetPaths(): void {
    this.state.clear();
  }

  clear(): void {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
    this.state.clear();
  }

  /** Blendet alles um `alpha` aus (destination-out). */
  fade(alpha: number): void {
    if (alpha <= 0) return;
    const c = this.ctx;
    c.globalCompositeOperation = 'destination-out';
    c.globalAlpha = 1;
    c.fillStyle = `rgba(0,0,0,${alpha})`;
    c.fillRect(0, 0, this.w, this.h);
    c.globalCompositeOperation = 'source-over';
  }

  /** Verlängert die Spuren aller Fahrzeuge bis zu ihrer aktuellen Position. */
  update(vehicles: Iterable<TrackedVehicle>, toScreen: (x: number, y: number) => [number, number], dtMs: number): void {
    this.frame++;
    const c = this.ctx;
    c.globalCompositeOperation = 'lighter';
    for (const tv of vehicles) {
      const [px, py] = toScreen(tv.x, tv.y);
      let s = this.state.get(tv.id);
      if (!s || tv.broken) {
        this.state.set(tv.id, { lx: px, ly: py, carry: 0, dist: tv.seed * 1000, jitter: 0, seen: this.frame });
        tv.broken = false;
        continue;
      }
      s.seen = this.frame;
      const style = STYLES[tv.mode];
      let tx = px;
      let ty = py;
      if (style.smoothing > 0) {
        const f = 1 - Math.exp(-dtMs / 1000 / style.smoothing);
        tx = s.lx + (px - s.lx) * f;
        ty = s.ly + (py - s.ly) * f;
      }
      const dx = tx - s.lx;
      const dy = ty - s.ly;
      const len = Math.hypot(dx, dy);
      if (len > MAX_SEGMENT_PX) {
        s.lx = px;
        s.ly = py;
        s.carry = 0;
        continue;
      }
      if (len > 1e-4) this.stampSegment(s, style, tv.mode, s.lx, s.ly, dx, dy, len);
      s.lx = tx;
      s.ly = ty;
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    // Zustände verschwundener Fahrzeuge verwerfen
    if (this.frame % 120 === 0) {
      for (const [id, s] of this.state) if (this.frame - s.seen > 60) this.state.delete(id);
    }
  }

  private stampSegment(s: TrailState, st: TrailStyle, mode: Mode, x0: number, y0: number, dx: number, dy: number, len: number): void {
    const ux = dx / len;
    const uy = dy / len;
    // Normale zur Fahrtrichtung
    const nx = -uy;
    const ny = ux;
    let travelled = st.spacing - s.carry;
    s.carry += len;
    while (s.carry >= st.spacing) {
      s.carry -= st.spacing;
      s.dist += st.spacing;
      const bx = x0 + ux * travelled;
      const by = y0 + uy * travelled;
      travelled += st.spacing;

      if (st.jitter > 0) {
        s.jitter += (this.random() - 0.5) * st.jitter * 0.7;
        s.jitter *= 0.92;
      }
      if (st.dash) {
        const [on, off] = st.dash;
        if (s.dist % (on + off) > on) continue;
      }
      const wave = st.wave ? Math.sin((s.dist / st.wave.length) * Math.PI * 2) * st.wave.amp : 0;
      const lateral = wave + s.jitter;
      for (let k = 0; k < st.dropsPerStamp; k++) {
        const spread = (this.random() + this.random() - 1) * st.scatter;
        const along = (this.random() - 0.5) * st.spacing;
        const x = bx + nx * (lateral + spread) + ux * along;
        const y = by + ny * (lateral + spread) + uy * along;
        this.drop(mode, x, y, st.dropRadius * (0.6 + this.random() * 0.8), st.alpha * (0.55 + this.random() * 0.7));
      }
      if (st.halo > 0 && this.random() < st.halo) {
        this.drop(mode, bx + nx * lateral, by + ny * lateral, st.dropRadius * 5, 0.05);
      }
      if (st.deltaRate > 0 && this.random() < st.deltaRate * st.spacing) {
        this.deltaRay(mode, st, bx + nx * lateral, by + ny * lateral, ux, uy);
      }
    }
  }

  /** Kurzer, sich einrollender Seitenast wie ein Delta-Elektron. */
  private deltaRay(mode: Mode, st: TrailStyle, x: number, y: number, ux: number, uy: number): void {
    const side = this.random() < 0.5 ? -1 : 1;
    let angle = Math.atan2(uy, ux) + side * (0.7 + this.random() * 0.9);
    const length = 6 + this.random() * 16;
    const curl = side * (0.04 + this.random() * 0.08);
    const step = 0.55;
    for (let d = 0; d < length; d += step) {
      angle += curl * (1 + (d / length) * 4);
      x += Math.cos(angle) * step;
      y += Math.sin(angle) * step;
      const fade = 1 - d / length;
      this.drop(mode, x + (this.random() - 0.5) * 0.6, y + (this.random() - 0.5) * 0.6, 0.75, st.alpha * (0.4 + 0.6 * fade));
    }
  }

  private drop(mode: Mode, x: number, y: number, r: number, a: number): void {
    if (x < -10 || y < -10 || x > this.w + 10 || y > this.h + 10) return;
    const c = this.ctx;
    c.globalAlpha = Math.min(a, 1);
    c.drawImage(this.sprites.get(mode)!, x - r, y - r, r * 2, r * 2);
  }

  /**
   * Zeichnet eine Beispielspur (z. B. für die Legende) mit genau demselben
   * Stempel-Code wie die echten Spuren. Deterministisch durch festen Zufallskeim.
   */
  renderSample(mode: Mode, w: number, h: number, dpr: number, seed = 7): HTMLCanvasElement {
    this.resize(w, h, dpr);
    this.clear();
    const prevRandom = this.random;
    let state = seed >>> 0 || 1;
    this.random = () => {
      // xorshift32
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
    const st = STYLES[mode];
    const s: TrailState = { lx: 3, ly: h / 2, carry: 0, dist: 0, jitter: 0, seen: 0 };
    const c = this.ctx;
    c.globalCompositeOperation = 'lighter';
    const step = 0.25;
    for (let x = 3 + step; x <= w - 3; x += step) {
      // Tram und Fähre fahren einen leichten Bogen, alle anderen gerade
      const curve = st.smoothing > 0 ? Math.sin(((x - 3) / (w - 6)) * Math.PI) * -h * 0.18 : 0;
      const y = h / 2 + curve + (st.smoothing > 0 ? h * 0.09 : 0);
      const dx = x - s.lx;
      const dy = y - s.ly;
      this.stampSegment(s, st, mode, s.lx, s.ly, dx, dy, Math.hypot(dx, dy));
      s.lx = x;
      s.ly = y;
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    this.random = prevRandom;
    return this.canvas;
  }
}
