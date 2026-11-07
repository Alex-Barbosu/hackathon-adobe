export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

interface Bucket {
  capacity: number;
  tokens: number;
  refillPerMs: number;
  last: number;
  coolUntil: number;
}

// In-process token bucket per model. A single worker is the only source of truth for RPM; running two
// workers against one key would need a DB-backed limiter (documented in README).
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  // Serialises waiters per model so they are released in order without busy loops.
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    rpmByModel: Readonly<Record<string, number>>,
    margin: number,
    private readonly clock: Clock = realClock,
  ) {
    for (const [model, rpm] of Object.entries(rpmByModel)) {
      const capacity = Math.max(1, Math.floor(rpm * margin));
      this.buckets.set(model, {
        capacity,
        tokens: capacity,
        refillPerMs: capacity / 60_000,
        last: clock.now(),
        coolUntil: 0,
      });
    }
  }

  private bucket(model: string): Bucket {
    const b = this.buckets.get(model);
    if (!b) throw new Error(`No rate limit configured for model ${model}`);
    return b;
  }

  private refill(b: Bucket): void {
    const t = this.clock.now();
    b.tokens = Math.min(b.capacity, b.tokens + (t - b.last) * b.refillPerMs);
    b.last = t;
  }

  async acquire(model: string): Promise<void> {
    const prev = this.queues.get(model) ?? Promise.resolve();
    const next = prev.then(() => this.take(model));
    this.queues.set(
      model,
      next.catch(() => undefined),
    );
    await next;
  }

  private async take(model: string): Promise<void> {
    const b = this.bucket(model);
    for (;;) {
      const now = this.clock.now();
      if (now < b.coolUntil) {
        await this.clock.sleep(b.coolUntil - now);
        continue;
      }
      this.refill(b);
      if (b.tokens >= 1) {
        b.tokens -= 1;
        return;
      }
      await this.clock.sleep(Math.ceil((1 - b.tokens) / b.refillPerMs));
    }
  }

  // A 429 puts the model on ice for the suggested delay.
  coolDown(model: string, ms: number): void {
    const b = this.bucket(model);
    b.coolUntil = Math.max(b.coolUntil, this.clock.now() + ms);
    b.tokens = 0;
  }

  has(model: string): boolean {
    return this.buckets.has(model);
  }
}
