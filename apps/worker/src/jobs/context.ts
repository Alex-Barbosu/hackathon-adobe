import type { Logger } from "pino";
import type { JobMessageValue, JobType } from "@nologo/core";
import type { Db } from "../db.ts";
import type { Env } from "../env.ts";
import type { ImageEditor } from "../image/generative.ts";
import type { LlmClient } from "../llm/client.ts";
import type { Queue } from "../queue.ts";

export interface Ctx {
  db: Db;
  llm: LlmClient;
  env: Env;
  log: Logger;
  queue: Queue;
  // Present only when ENABLE_GENERATIVE_EDITS=true.
  editor?: ImageEditor;
}

export type JobOf<T extends JobType> = Extract<JobMessageValue, { type: T }>;
export type JobHandler<T extends JobType> = (ctx: Ctx, msg: JobOf<T>) => Promise<void>;

export const idem = (type: string, ...parts: string[]): string => [type, ...parts].join(":");
