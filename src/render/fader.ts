/**
 * Berechnet, wie stark der Spur-Canvas in einem Frame mit destination-out
 * ausgeblendet wird.
 *
 * Problem: Ein 8-Bit-Alphakanal rundet sehr kleine Abzüge weg. Bei langer
 * Nachleuchtdauer wäre der Abzug pro Frame < 1/255, und Spuren blieben als
 * Geister stehen. Darum sammelt der Fader die Abklingmenge an und gibt sie erst
 * ab einer Mindeststärke aus. Zusätzlich wird regelmäßig ein kräftigerer
 * Schritt eingestreut, der schwache Reste unter die Sichtbarkeitsschwelle drückt;
 * die Gesamtabklingrate bleibt dabei korrekt.
 */
export class Fader {
  /** angesammelte Abklingmenge in ln-Einheiten (negativ = „Vorschuss“ durch Aufräumschritt) */
  private budget = 0;
  private sinceCleanup = 0;

  constructor(
    /** Zeit in Sekunden, nach der eine Spur auf ~5 % abgeklungen ist; Infinity = nie */
    public persistenceSec: number,
    private readonly minStep = 0.02,
    private readonly cleanupStep = 0.08,
    private readonly cleanupIntervalSec = 2.5,
  ) {}

  /** Liefert den destination-out-Alphawert für diesen Frame (0 = nichts tun). */
  next(dtSec: number): number {
    if (!Number.isFinite(this.persistenceSec)) {
      this.budget = 0;
      this.sinceCleanup = 0;
      return 0;
    }
    // Abklingen auf 5 % nach persistenceSec: k = ln(20) / T
    const k = Math.log(20) / Math.max(this.persistenceSec, 0.5);
    this.budget += k * dtSec;
    this.sinceCleanup += dtSec;

    // Aufräumschritte verbrauchen höchstens die Hälfte des Abklingbudgets
    const cleanupLog = -Math.log(1 - this.cleanupStep);
    const cleanupEvery = Math.max(this.cleanupIntervalSec, (2 * cleanupLog) / k);
    if (this.sinceCleanup >= cleanupEvery) {
      this.sinceCleanup = 0;
      this.budget -= cleanupLog;
      return this.cleanupStep;
    }
    const minLog = -Math.log(1 - this.minStep);
    if (this.budget >= minLog) {
      const alpha = 1 - Math.exp(-this.budget);
      this.budget = 0;
      return Math.min(alpha, 1);
    }
    return 0;
  }
}
