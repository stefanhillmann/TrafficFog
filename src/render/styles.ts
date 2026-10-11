import type { Mode } from '../types';

/**
 * Spurcodierung je Verkehrsmittel. Alle Längen in CSS-Pixeln.
 * Spuren bestehen aus einzelnen „Tröpfchen“, die entlang des Wegs gestempelt werden.
 * Die Legende wird mit denselben Werten und demselben Code gezeichnet.
 */
export interface TrailStyle {
  label: string;
  /** RGB */
  color: [number, number, number];
  /** Aufhellung des Tröpfchenkerns Richtung Weiß (0–1); niedrig = satte Farbe */
  core: number;
  /** Radius eines Tröpfchens */
  dropRadius: number;
  /** Deckkraft eines Tröpfchens */
  alpha: number;
  /** Abstand zwischen zwei Stempeln entlang der Spur */
  spacing: number;
  /** Tröpfchen pro Stempel */
  dropsPerStamp: number;
  /** seitliche Streuung der Tröpfchen (Spurbreite) */
  scatter: number;
  /** Unterbrechung: [Strich, Lücke] oder null */
  dash: [number, number] | null;
  /** Unruhe: Amplitude eines seitlichen Zufallspfads */
  jitter: number;
  /** weiche Wellen: Amplitude und Wellenlänge */
  wave: { amp: number; length: number } | null;
  /** Tiefpass auf den Weg (s), rundet Ecken zu Bögen */
  smoothing: number;
  /** Wahrscheinlichkeit pro Pixel Weg für einen Seitenast (Delta-Elektron) */
  deltaRate: number;
  /** gelegentlicher weicher Halo (Ionisationsdichte) */
  halo: number;
}

export const STYLES: Record<Mode, TrailStyle> = {
  // lang, fein, gerade – wie ein schnelles Myon
  sbahn: {
    label: 'S-Bahn',
    color: [140, 205, 255],
    core: 0.5,
    dropRadius: 0.85,
    alpha: 0.6,
    spacing: 0.6,
    dropsPerStamp: 1,
    scatter: 0.3,
    dash: null,
    jitter: 0,
    wave: null,
    smoothing: 0,
    deltaRate: 0,
    halo: 0,
  },
  // gedämpft und unterbrochen
  ubahn: {
    label: 'U-Bahn',
    color: [170, 130, 240],
    core: 0.25,
    dropRadius: 1.1,
    alpha: 0.4,
    spacing: 0.7,
    dropsPerStamp: 1,
    scatter: 0.6,
    dash: [6, 5],
    jitter: 0,
    wave: null,
    smoothing: 0,
    deltaRate: 0,
    halo: 0,
  },
  // mittlere Dicke, glatt, weiche Bögen
  tram: {
    label: 'Tram',
    color: [255, 200, 60],
    core: 0.3,
    dropRadius: 1.1,
    alpha: 0.5,
    spacing: 0.5,
    dropsPerStamp: 1,
    scatter: 0.45,
    dash: null,
    jitter: 0,
    wave: { amp: 0.7, length: 60 },
    smoothing: 2,
    deltaRate: 0,
    halo: 0,
  },
  // dick, ausgefranst, unruhig, mit sich einrollenden Seitenästen
  bus: {
    label: 'Bus',
    color: [255, 80, 110],
    core: 0.1,
    dropRadius: 1.15,
    alpha: 0.32,
    spacing: 0.45,
    dropsPerStamp: 3,
    scatter: 3.2,
    dash: null,
    jitter: 2.2,
    wave: null,
    smoothing: 0,
    deltaRate: 0.05,
    halo: 0,
  },
  // dicht, gerade, hell mit Halo – wie ein Alpha-Teilchen
  regional: {
    label: 'Regional-/Fernzug',
    color: [190, 255, 210],
    core: 0.6,
    dropRadius: 1.25,
    alpha: 0.7,
    spacing: 0.45,
    dropsPerStamp: 2,
    scatter: 0.8,
    dash: null,
    jitter: 0,
    wave: null,
    smoothing: 0,
    deltaRate: 0,
    halo: 0.08,
  },
  // breit gestreut, deutlich gewellt, schwach
  ferry: {
    label: 'Fähre',
    color: [80, 225, 210],
    core: 0.2,
    dropRadius: 1.2,
    alpha: 0.35,
    spacing: 0.7,
    dropsPerStamp: 1,
    scatter: 1.0,
    dash: null,
    jitter: 0,
    wave: { amp: 3.2, length: 22 },
    smoothing: 3,
    deltaRate: 0,
    halo: 0,
  },
};

export const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
