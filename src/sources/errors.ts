/** Fehler einer Datenquelle, der in der Statuszeile angezeigt werden darf. */
export class SourceError extends Error {
  readonly status?: number;

  constructor(message: string, opts: { cause?: unknown; status?: number } = {}) {
    super(message, { cause: opts.cause });
    this.name = 'SourceError';
    this.status = opts.status;
  }
}
