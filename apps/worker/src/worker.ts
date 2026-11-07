import { MAX_JOB_ATTEMPTS, QUEUES, type QueueName } from "@nologo/core";
import { ZodError } from "zod";
import { FatalError, errorMessage } from "./errors.ts";
import { GuardError } from "./image/guard.ts";
import type { Ctx } from "./jobs/context.ts";
import { analysisIdOf, parseJob, runJob } from "./jobs/router.ts";
import { failAnalysis } from "./pipeline/state.ts";
import type { QueueMessage } from "./queue.ts";

export interface WorkerOptions {
  pollMs: number;
  concurrency: number;
  // Longer than the slowest job; panel batches may wait on the rate limiter.
  visibilitySeconds: number;
}

export interface WorkerHandle {
  stop(timeoutMs?: number): Promise<void>;
}

const isFatal = (err: unknown): boolean =>
  err instanceof FatalError || err instanceof GuardError || err instanceof ZodError;

async function settle(ctx: Ctx, msg: QueueMessage, err: unknown, analysisId: string | null): Promise<void> {
  const message = errorMessage(err);
  const fatal = isFatal(err);
  if (!fatal && msg.readCt < MAX_JOB_ATTEMPTS) {
    // Leave the message: it reappears when the visibility timeout expires.
    ctx.log.warn({ msgId: msg.msgId, readCt: msg.readCt, err: message }, "job failed; will be retried");
    return;
  }
  ctx.log.error({ msgId: msg.msgId, readCt: msg.readCt, fatal, err: message }, "job failed permanently");
  if (analysisId) await failAnalysis(ctx.db, analysisId, message);
  // The archived message keeps the payload for inspection.
  await ctx.queue.archive(msg.queue, msg.msgId);
}

export async function processMessage(ctx: Ctx, msg: QueueMessage): Promise<void> {
  let analysisId: string | null = null;
  try {
    const job = parseJob(msg.raw);
    analysisId = analysisIdOf(job);
    const started = Date.now();
    await runJob(ctx, job);
    ctx.log.info({ type: job.type, analysisId, ms: Date.now() - started }, "job done");
    await ctx.queue.delete(msg.queue, msg.msgId);
  } catch (err) {
    if (err instanceof ZodError && analysisId === null) {
      ctx.log.error({ msgId: msg.msgId, err: err.message }, "unparseable job message; archived");
      await ctx.queue.archive(msg.queue, msg.msgId);
      return;
    }
    await settle(ctx, msg, err, analysisId);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Drains jobs_high before jobs_bulk, WORKER_CONCURRENCY jobs at a time. Uses read (never pop), so a crash
// mid-job makes the message reappear.
export function startWorker(ctx: Ctx, opts: WorkerOptions): WorkerHandle {
  const inflight = new Set<Promise<void>>();
  let stopping = false;
  const order: QueueName[] = [QUEUES.high, QUEUES.bulk];

  const loop = async (): Promise<void> => {
    while (!stopping) {
      let started = 0;
      try {
        for (const queue of order) {
          const free = opts.concurrency - inflight.size;
          if (free <= 0 || stopping) break;
          for (const msg of await ctx.queue.read(queue, opts.visibilitySeconds, free)) {
            const p = processMessage(ctx, msg).finally(() => inflight.delete(p));
            inflight.add(p);
            started++;
          }
        }
      } catch (err) {
        ctx.log.error({ err: errorMessage(err) }, "queue poll failed");
      }
      if (started === 0) await sleep(opts.pollMs);
      else await Promise.race([sleep(50), ...inflight]);
    }
  };
  const running = loop();

  return {
    async stop(timeoutMs = 30_000): Promise<void> {
      stopping = true;
      await running;
      await Promise.race([Promise.allSettled([...inflight]), sleep(timeoutMs)]);
    },
  };
}
