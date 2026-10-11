import type { BBox, Vehicle, VehicleSource } from './types';

export type PollState = 'idle' | 'loading' | 'ok' | 'error';

export interface PollStatus {
  state: PollState;
  /** Zeit der letzten erfolgreichen Abfrage (Unix-ms) */
  lastSuccess: number | null;
  lastError: string | null;
  /** aufeinanderfolgende Fehlschläge */
  failures: number;
  nextAttempt: number | null;
  vehicleCount: number;
}

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BACKOFF_MS = 120_000;

/** Wartezeit bis zur nächsten Abfrage: regulär das Quell-Intervall, bei Fehlern exponentiell länger. */
export function nextDelay(intervalMs: number, failures: number): number {
  if (failures <= 0) return intervalMs;
  return Math.min(intervalMs * 2 ** Math.min(failures, 6), Math.max(MAX_BACKOFF_MS, intervalMs));
}

/**
 * Fragt eine Quelle periodisch ab. Fehler werden gemeldet, aber nie geworfen,
 * damit die Animation weiterläuft. Es gibt keinen automatischen Wechsel auf eine andere Quelle.
 */
export class Poller {
  status: PollStatus = { state: 'idle', lastSuccess: null, lastError: null, failures: 0, nextAttempt: null, vehicleCount: 0 };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private abort: AbortController | null = null;
  private running = false;
  private inFlight = false;
  /** Beginn der letzten Anfrage – Grundlage für den Mindestabstand, unabhängig vom Erfolg */
  private lastAttempt = -Infinity;

  constructor(
    private source: VehicleSource,
    private getBBox: () => BBox,
    private onData: (vehicles: Vehicle[]) => void,
    private onStatus: (s: PollStatus) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    // Auch bei häufigem Pausieren/Fortsetzen nie öfter abfragen als erlaubt
    if (this.inFlight) return; // tick() plant nach Abschluss selbst neu
    const since = Date.now() - this.lastAttempt;
    this.schedule(Math.max(0, nextDelay(this.source.pollIntervalMs, this.status.failures) - since));
  }

  /** Hält das Polling an. Eine laufende Anfrage darf zu Ende laufen. */
  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.status = { ...this.status, nextAttempt: null };
    this.onStatus(this.status);
  }

  /**
   * Zieht die nächste Abfrage vor (z. B. nach Änderung des Bereichs), hält aber
   * mindestens `minGapMs` Abstand zur letzten Anfrage ein.
   */
  requestSoon(minGapMs = 8_000): void {
    if (!this.running || this.inFlight) return;
    const delay = Math.max(0, minGapMs - (Date.now() - this.lastAttempt));
    const planned = this.status.nextAttempt;
    if (planned === null || Date.now() + delay < planned) this.schedule(delay);
  }

  /** Beendet das Polling endgültig und bricht eine laufende Anfrage ab. */
  dispose(): void {
    this.stop();
    this.abort?.abort();
  }

  private schedule(ms: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.status = { ...this.status, nextAttempt: Date.now() + ms };
    this.onStatus(this.status);
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private async tick(): Promise<void> {
    if (!this.running || this.inFlight) return;
    this.inFlight = true;
    this.lastAttempt = Date.now();
    this.abort = new AbortController();
    const timeout = setTimeout(() => this.abort?.abort(), REQUEST_TIMEOUT_MS);
    this.status = { ...this.status, state: this.status.lastSuccess ? this.status.state : 'loading', nextAttempt: null };
    this.onStatus(this.status);
    try {
      const vehicles = await this.source.fetchVehicles(this.getBBox(), this.abort.signal);
      this.onData(vehicles);
      this.status = { ...this.status, state: 'ok', lastSuccess: Date.now(), lastError: null, failures: 0, vehicleCount: vehicles.length };
    } catch (e) {
      const err = e as Error;
      const message = err.name === 'AbortError' ? 'Zeitüberschreitung' : err.message || String(e);
      this.status = { ...this.status, state: 'error', lastError: message, failures: this.status.failures + 1 };
      console.warn(`[${this.source.id}]`, e);
    } finally {
      clearTimeout(timeout);
      this.inFlight = false;
      this.abort = null;
    }
    if (this.running) this.schedule(nextDelay(this.source.pollIntervalMs, this.status.failures));
    else this.onStatus(this.status);
  }
}
