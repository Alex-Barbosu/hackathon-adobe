import { z } from "zod";

export const EventPayloads = {
  status_changed: z.object({ from: z.string(), to: z.string() }),
  regions_ready: z.object({ count: z.number().int() }),
  leak_detected: z.object({ leaks: z.array(z.object({ kind: z.string(), description: z.string() })) }),
  condition_built: z.object({ conditionId: z.uuid(), kind: z.string(), element: z.string().nullable() }),
  batch_done: z.object({ conditionId: z.uuid(), done: z.number().int(), total: z.number().int() }),
  metrics_ready: z.object({}),
  findings_ready: z.object({ count: z.number().int() }),
  quiz_ready: z.object({ sessionId: z.uuid() }),
  variant_rendered: z.object({ variantId: z.uuid(), status: z.string() }),
  quota_warning: z.object({ model: z.string(), used: z.number(), limit: z.number() }),
  quota_exhausted: z.object({ model: z.string() }),
  report_ready: z.object({}),
  failed: z.object({ error: z.string() }),
} as const;

export type EventType = keyof typeof EventPayloads;
export type EventPayload<T extends EventType> = z.infer<(typeof EventPayloads)[T]>;
