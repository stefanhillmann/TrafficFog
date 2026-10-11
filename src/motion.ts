/** Zeitstempel und Position in lokalen Metern */
export interface Sample {
  t: number;
  x: number;
  y: number;
}

export interface Estimate {
  x: number;
  y: number;
  /** Geschwindigkeit in m/s */
  vx: number;
  vy: number;
  /**
   * true, wenn das Fahrzeug nur mangels neuer Daten angehalten wurde
   * (Fortschreibung ausgeschöpft, letzte bekannte Geschwindigkeit > 0)
   */
  stale?: boolean;
}

/**
 * Schätzt die Position zum Zeitpunkt `t`.
 * - Mit ≥ 2 Frames: lineare Interpolation zwischen den Frames, danach
 *   Fortschreibung mit der letzten Frame-Geschwindigkeit für höchstens `maxExtrapolationMs`.
 * - Sonst: Fortschreibung aus den letzten beiden beobachteten Positionen,
 *   ebenfalls auf `maxExtrapolationMs` begrenzt; danach bleibt das Fahrzeug stehen.
 */
export function estimatePosition(frames: readonly Sample[], history: readonly Sample[], t: number, maxExtrapolationMs: number): Estimate | null {
  if (frames.length >= 2) {
    const first = frames[0];
    if (t <= first.t) {
      const v = velocity(first, frames[1]);
      return { x: first.x, y: first.y, vx: v.vx, vy: v.vy };
    }
    for (let i = 1; i < frames.length; i++) {
      const b = frames[i];
      if (t <= b.t) {
        const a = frames[i - 1];
        const f = (t - a.t) / (b.t - a.t || 1);
        const v = velocity(a, b);
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, vx: v.vx, vy: v.vy };
      }
    }
    return extrapolate(frames[frames.length - 2], frames[frames.length - 1], t, maxExtrapolationMs);
  }
  if (history.length >= 2) {
    const a = history[history.length - 2];
    const b = history[history.length - 1];
    // zu alte Paare liefern keine sinnvolle Geschwindigkeit
    if (b.t - a.t > 0 && b.t - a.t <= 120_000) return extrapolate(a, b, t, maxExtrapolationMs);
  }
  const last = history[history.length - 1] ?? frames[frames.length - 1];
  return last ? { x: last.x, y: last.y, vx: 0, vy: 0 } : null;
}

function velocity(a: Sample, b: Sample): { vx: number; vy: number } {
  const dt = (b.t - a.t) / 1000;
  if (dt <= 0) return { vx: 0, vy: 0 };
  return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
}

function extrapolate(a: Sample, b: Sample, t: number, maxMs: number): Estimate {
  const v = velocity(a, b);
  const ahead = Math.min(Math.max(t - b.t, 0), maxMs);
  const moving = t - b.t < maxMs;
  const x = b.x + (v.vx * ahead) / 1000;
  const y = b.y + (v.vy * ahead) / 1000;
  if (moving) return { x, y, vx: v.vx, vy: v.vy };
  return { x, y, vx: 0, vy: 0, stale: v.vx !== 0 || v.vy !== 0 };
}
