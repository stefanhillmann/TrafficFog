import type { PollStatus } from './poller';
import { STYLES } from './render/styles';
import { TrailLayer } from './render/trails';
import { MODES, type Mode, type VehicleSource } from './types';

const STORE_KEY = 'trafficfog:prefs:v2';

export const RADIUS_KM = { min: 1, max: 10, step: 0.5, default: 2.5 };
export const PERSIST_MIN = { min: 1, max: 60, step: 1, default: 3 };

export interface Prefs {
  radiusKm: number;
  /** Nachleuchtdauer in Minuten */
  persistenceMin: number;
  /** Spuren bleiben dauerhaft stehen */
  infinite: boolean;
  legend: boolean;
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

export function loadPrefs(): Prefs {
  const defaults: Prefs = { radiusKm: RADIUS_KM.default, persistenceMin: PERSIST_MIN.default, infinite: false, legend: true };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaults;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      radiusKm: clamp(p.radiusKm, RADIUS_KM.min, RADIUS_KM.max, defaults.radiusKm),
      persistenceMin: clamp(p.persistenceMin, PERSIST_MIN.min, PERSIST_MIN.max, defaults.persistenceMin),
      infinite: typeof p.infinite === 'boolean' ? p.infinite : defaults.infinite,
      legend: typeof p.legend === 'boolean' ? p.legend : defaults.legend,
    };
  } catch {
    return defaults;
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(p));
  } catch {
    /* privater Modus o. Ä. – Einstellungen gelten dann nur für diese Sitzung */
  }
}

/** Nachleuchtdauer in Sekunden für die Darstellung (Infinity bei „unendlich“) */
export const persistenceSeconds = (p: Prefs) => (p.infinite ? Infinity : p.persistenceMin * 60);

const formatKm = (v: number) => `${v.toLocaleString('de-DE', { maximumFractionDigits: 1 })} km`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface UiHandlers {
  /** Sekunden, Infinity = unendlich */
  onPersistence(sec: number): void;
  /** während des Ziehens (live) */
  onRadiusInput(km: number): void;
  /** nach dem Loslassen */
  onRadiusChange(km: number): void;
  onPause(paused: boolean): void;
}

export class Ui {
  private readonly status = $('status');
  private readonly notice = $('notice');
  private readonly legend = $('legend');
  private readonly persist = $<HTMLInputElement>('persist');
  private readonly persistValue = $('persist-value');
  private readonly infinite = $<HTMLInputElement>('persist-infinite');
  private readonly radius = $<HTMLInputElement>('radius');
  private readonly radiusValue = $('radius-value');
  private readonly pauseBtn = $<HTMLButtonElement>('pause');
  private readonly legendBtn = $<HTMLButtonElement>('legend-toggle');
  private readonly tip = $('tip');
  private paused = false;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private prefs: Prefs,
    handlers: UiHandlers,
  ) {
    this.buildLegend();
    this.setLegend(prefs.legend);

    // Radius
    Object.assign(this.radius, { min: RADIUS_KM.min, max: RADIUS_KM.max, step: RADIUS_KM.step });
    this.radius.value = String(prefs.radiusKm);
    this.radiusValue.textContent = formatKm(prefs.radiusKm);
    this.radius.addEventListener('input', () => {
      const v = Number(this.radius.value);
      this.radiusValue.textContent = formatKm(v);
      this.prefs.radiusKm = v;
      handlers.onRadiusInput(v);
    });
    this.radius.addEventListener('change', () => {
      savePrefs(this.prefs);
      handlers.onRadiusChange(this.prefs.radiusKm);
    });

    // Nachleuchten
    Object.assign(this.persist, { min: PERSIST_MIN.min, max: PERSIST_MIN.max, step: PERSIST_MIN.step });
    this.persist.value = String(prefs.persistenceMin);
    this.infinite.checked = prefs.infinite;
    this.renderPersist();
    this.persist.addEventListener('input', () => {
      this.prefs.persistenceMin = Number(this.persist.value);
      this.renderPersist();
      handlers.onPersistence(persistenceSeconds(this.prefs));
    });
    this.persist.addEventListener('change', () => savePrefs(this.prefs));
    this.infinite.addEventListener('change', () => {
      this.prefs.infinite = this.infinite.checked;
      this.renderPersist();
      handlers.onPersistence(persistenceSeconds(this.prefs));
      savePrefs(this.prefs);
    });

    this.pauseBtn.addEventListener('click', () => {
      this.paused = !this.paused;
      this.pauseBtn.setAttribute('aria-pressed', String(this.paused));
      this.pauseBtn.textContent = this.paused ? '▶' : '❚❚';
      this.pauseBtn.title = this.paused ? 'Fortsetzen' : 'Pause';
      handlers.onPause(this.paused);
    });
    this.legendBtn.addEventListener('click', () => {
      this.setLegend(!this.prefs.legend);
      savePrefs(this.prefs);
    });
  }

  private renderPersist(): void {
    this.persist.disabled = this.prefs.infinite;
    this.persistValue.textContent = this.prefs.infinite ? '∞' : `${this.prefs.persistenceMin} min`;
  }

  /** Legende mit echten Beispielspuren aus dem Spur-Renderer, damit Legende und Bild übereinstimmen. */
  private buildLegend(): void {
    const list = this.legend.querySelector('ul')!;
    const w = 40;
    const h = 14;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const sampler = new TrailLayer();
    for (const m of MODES) {
      const li = document.createElement('li');
      const sw = document.createElement('canvas');
      sw.className = 'swatch';
      sw.width = Math.round(w * dpr);
      sw.height = Math.round(h * dpr);
      sw.style.width = `${w}px`;
      sw.style.height = `${h}px`;
      sw.setAttribute('aria-hidden', 'true');
      sw.getContext('2d')!.drawImage(sampler.renderSample(m, w, h, dpr), 0, 0);
      li.append(sw, document.createTextNode(STYLES[m].label));
      list.append(li);
    }
  }

  private setLegend(on: boolean): void {
    this.prefs.legend = on;
    this.legend.hidden = !on;
    this.legendBtn.setAttribute('aria-pressed', String(on));
  }

  /** Tooltip zur Spur unter dem Zeiger; `null` blendet ihn aus. */
  showTip(info: { mode: Mode; line: string; direction?: string; active: boolean; ageSec: number } | null, px = 0, py = 0): void {
    if (!info) {
      this.tip.hidden = true;
      return;
    }
    const st = STYLES[info.mode];
    const title = this.tip.querySelector('.tip-title')!;
    const sub = this.tip.querySelector('.tip-sub')!;
    const dot = this.tip.querySelector<HTMLElement>('.tip-dot')!;
    dot.style.background = dot.style.color = `rgb(${st.color.join(',')})`;
    title.textContent = `${st.label} ${info.line}`.trim() + (info.direction ? ` → ${info.direction}` : '');
    const state = info.active ? 'unterwegs' : 'nicht mehr im Bereich';
    sub.textContent = info.ageSec >= 5 ? `${state} · Spur von vor ${info.ageSec} s` : state;
    this.tip.hidden = false;
    // neben dem Zeiger, aber im Fenster halten
    const pad = 12;
    const r = this.tip.getBoundingClientRect();
    let x = px + 14;
    let y = py + 14;
    if (x + r.width > window.innerWidth - pad) x = px - r.width - 14;
    if (y + r.height > window.innerHeight - pad) y = py - r.height - 14;
    this.tip.style.transform = `translate(${Math.max(pad, x)}px, ${Math.max(pad, y)}px)`;
  }

  setAttribution(source: VehicleSource | undefined): void {
    $('attribution').textContent = source ? source.attribution : '';
  }

  /** Dezenter Hinweis; verschwindet nach `ms` (0 = bleibt). */
  showNotice(text: string, ms = 9000): void {
    this.notice.textContent = text;
    this.notice.hidden = false;
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    if (ms > 0) this.noticeTimer = setTimeout(() => (this.notice.hidden = true), ms);
  }

  renderStatus(source: VehicleSource | undefined, s: PollStatus | null, now: number, extra?: string): void {
    const el = this.status;
    if (!source || !s) {
      el.dataset.state = 'error';
      el.textContent = extra ?? 'Keine Datenquelle';
      return;
    }
    const ago = (t: number) => {
      const sec = Math.max(0, Math.round((now - t) / 1000));
      return sec < 90 ? `vor ${sec} s` : `vor ${Math.round(sec / 60)} min`;
    };
    let text: string;
    let state: string;
    if (s.state === 'error') {
      state = 'error';
      const retry = s.nextAttempt ? ` · neuer Versuch in ${Math.max(0, Math.round((s.nextAttempt - now) / 1000))} s` : '';
      const last = s.lastSuccess ? ` · letzte Daten ${ago(s.lastSuccess)}` : '';
      text = `${source.label} nicht erreichbar (${s.lastError ?? 'Fehler'})${last}${retry}`;
    } else if (s.state === 'ok' && s.lastSuccess) {
      state = source.simulated ? 'sim' : 'ok';
      text = `${source.simulated ? 'Simulation' : `Live · ${source.label}`} · ${s.vehicleCount} Fahrzeuge · ${ago(s.lastSuccess)}`;
    } else {
      state = 'loading';
      text = `${source.label} · lade …`;
    }
    if (this.paused) text = `Pausiert · ${text}`;
    el.dataset.state = state;
    el.textContent = extra ? `${text} · ${extra}` : text;
  }
}
