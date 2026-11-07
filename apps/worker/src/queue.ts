import { JobMessage, queueFor, type JobMessageValue, type QueueName } from "@nologo/core";
import { mustOk, toJson, type Db } from "./db.ts";
import { RetryableError } from "./errors.ts";

export interface QueueMessage {
  queue: QueueName;
  msgId: number;
  readCt: number;
  raw: unknown;
}

// Thin wrapper over the public.queue_* RPCs. We always `read` (never `pop`) so a crash mid-job
// makes the message reappear after the visibility timeout.
export class Queue {
  constructor(private readonly db: Db) {}

  async send(msg: JobMessageValue, delaySeconds = 0): Promise<void> {
    const valid = JobMessage.parse(msg);
    const { error } = await this.db.rpc("queue_send", { q: queueFor(valid.type), msg: toJson(valid), delay_s: delaySeconds });
    mustOk({ error }, `queue_send ${valid.type}`);
  }

  async read(queue: QueueName, visibilitySeconds: number, qty: number): Promise<QueueMessage[]> {
    const { data, error } = await this.db.rpc("queue_read", { q: queue, vt_s: visibilitySeconds, qty });
    if (error) throw new RetryableError(`queue_read ${queue}: ${error.message}`);
    return (data ?? []).map((m) => ({ queue, msgId: m.msg_id, readCt: m.read_ct, raw: m.message }));
  }

  async delete(queue: QueueName, msgId: number): Promise<void> {
    const { error } = await this.db.rpc("queue_delete", { q: queue, id: msgId });
    mustOk({ error }, "queue_delete");
  }

  async archive(queue: QueueName, msgId: number): Promise<void> {
    const { error } = await this.db.rpc("queue_archive", { q: queue, id: msgId });
    mustOk({ error }, "queue_archive");
  }
}
