// Errors are classified so the worker loop knows whether a redelivery can help.

export class RetryableError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "RetryableError";
  }
}

// Fatal errors (missing rows, invalid transitions, bad user input) are never retried.
export class FatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalError";
  }
}

export class QuotaExhaustedError extends RetryableError {
  constructor(readonly model: string) {
    super(`Daily quota exhausted for ${model}`);
    this.name = "QuotaExhaustedError";
  }
}

export class SchemaInvalidError extends RetryableError {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
    this.name = "SchemaInvalidError";
  }
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
