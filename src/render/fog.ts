import type { TrackedVehicle } from '../fleet';
import { Fader } from './fader';
import { STYLES } from './styles';

/** Auflösungsfaktor der Nebelebene – weich und günstig */
const FOG_SCALE = 0.25;

interface Puff {
  x: number;
  y: number;
  r: number;
  a: number;
  phase: number;
}

interface Speck {
  x: number;
  y: number;
  vy: number;
  a: number;
  phase: number;
}

function softSprite(size: number, rgb: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, `rgba(${rgb},1)`);
  grad.addColorStop(0.5, `rgba(${rgb},0.35)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/** Leicht driftende Nebelschwaden und feine, absinkende Tröpfchen. */
export class FogLayer {
  readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly sprite = softSprite(64, '170,190,215');
  private puffs: Puff[] = [];
  private specks: Speck[] = [];
  private w = 0;
  private h = 0;

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.canvas.width = Math.max(1, Math.round(w * FOG_SCALE));
    this.canvas.height = Math.max(1, Math.round(h * FOG_SCALE));
    const area = w * h;
    const nPuffs = Math.round(Math.min(90, Math.max(30, area / 9000)));
    const nSpecks = Math.round(Math.min(260, Math.max(80, area / 3500)));
    this.puffs = Array.from({ length: nPuffs }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 40 + Math.random() * 120,
      a: 0.025 + Math.random() * 0.045,
      phase: Math.random() * Math.PI * 2,
    }));
    this.specks = Array.from({ length: nSpecks }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vy: 0.6 + Math.random() * 2.2,
      a: 0.05 + Math.random() * 0.18,
      phase: Math.random() * Math.PI * 2,
    }));
  }

  update(tSec: number, dtSec: number): void {
    const { w, h } = this;
    for (const p of this.puffs) {
      // langsames Strömungsfeld
      p.x += (Math.sin(p.y * 0.004 + tSec * 0.05 + p.phase) * 5 + 2.5) * dtSec;
      p.y += Math.cos(p.x * 0.003 + tSec * 0.04 + p.phase) * 3.5 * dtSec;
      const m = p.r;
      if (p.x > w + m) p.x = -m;
      if (p.x < -m) p.x = w + m;
      if (p.y > h + m) p.y = -m;
      if (p.y < -m) p.y = h + m;
    }
    for (const s of this.specks) {
      s.y += s.vy * dtSec;
      s.x += Math.sin(tSec * 0.3 + s.phase) * 0.8 * dtSec;
      if (s.y > h + 2) {
        s.y = -2;
        s.x = Math.random() * w;
      }
    }
    const c = this.ctx;
    c.setTransform(FOG_SCALE, 0, 0, FOG_SCALE, 0, 0);
    c.clearRect(0, 0, w, h);
    c.globalCompositeOperation = 'lighter';
    for (const p of this.puffs) {
      c.globalAlpha = p.a * (0.75 + 0.25 * Math.sin(tSec * 0.2 + p.phase));
      c.drawImage(this.sprite, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
  }

  /** Zeichnet den Nebel auf den Haupt-Canvas (CSS-Koordinaten). */
  draw(target: CanvasRenderingContext2D, tSec: number): void {
    target.imageSmoothingEnabled = true;
    target.drawImage(this.canvas, 0, 0, this.w, this.h);
    target.fillStyle = 'rgb(200,215,235)';
    for (const s of this.specks) {
      target.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(tSec * 1.3 + s.phase * 3));
      target.fillRect(s.x, s.y, 1, 1);
    }
    target.globalAlpha = 1;
  }
}

/**
 * Langsam abklingende Verdichtungen an Stellen, an denen Fahrzeuge stehen.
 * So werden Haltestellen mit der Zeit als helle Flecken sichtbar.
 */
export class DepositLayer {
  readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly sprite = softSprite(48, '220,230,245');
  readonly fader = new Fader(600, 0.03, 0.15, 6);
  private readonly timers = new Map<string, number>();
  private w = 0;
  private h = 0;
  private scale = 0.5;

  resize(w: number, h: number, dpr: number): void {
    const old = this.canvas.width > 0 ? this.copy() : null;
    this.w = w;
    this.h = h;
    this.scale = Math.min(1, dpr * 0.5);
    this.canvas.width = Math.max(1, Math.round(w * this.scale));
    this.canvas.height = Math.max(1, Math.round(h * this.scale));
    if (old) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.drawImage(old, (this.canvas.width - old.width) / 2, (this.canvas.height - old.height) / 2);
    }
    this.ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
  }

  /** Skaliert den vorhandenen Inhalt um die Bildmitte (z. B. nach Radiusänderung). */
  rescale(factor: number): void {
    if (!(factor > 0) || factor === 1 || this.canvas.width === 0) return;
    const old = this.copy();
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

  private copy(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    c.getContext('2d')!.drawImage(this.canvas, 0, 0);
    return c;
  }

  clear(): void {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
  }

  update(vehicles: Iterable<TrackedVehicle>, toScreen: (x: number, y: number) => [number, number], dtMs: number): void {
    const c = this.ctx;
    const alpha = this.fader.next(dtMs / 1000);
    if (alpha > 0) {
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = `rgba(0,0,0,${alpha})`;
      c.fillRect(0, 0, this.w, this.h);
    }
    c.globalCompositeOperation = 'lighter';
    for (const tv of vehicles) {
      if (tv.stillFor < 2_500) {
        this.timers.delete(tv.id);
        continue;
      }
      const t = (this.timers.get(tv.id) ?? 0) + dtMs;
      if (t < 450) {
        this.timers.set(tv.id, t);
        continue;
      }
      this.timers.set(tv.id, 0);
      // nach langem Stehen nicht weiter verdichten, damit Endhaltestellen nicht überstrahlen
      if (tv.stillFor > 90_000) continue;
      const [x, y] = toScreen(tv.x, tv.y);
      const r = 5 + Math.random() * 5;
      const [cr, cg, cb] = STYLES[tv.mode].color;
      c.globalAlpha = 0.018;
      c.drawImage(this.sprite, x - r + (Math.random() - 0.5) * 2, y - r + (Math.random() - 0.5) * 2, r * 2, r * 2);
      // Hauch der Fahrzeugfarbe
      c.fillStyle = `rgba(${cr},${cg},${cb},0.012)`;
      c.beginPath();
      c.arc(x, y, r * 0.6, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    if (this.timers.size > 2000) this.timers.clear();
  }
}
