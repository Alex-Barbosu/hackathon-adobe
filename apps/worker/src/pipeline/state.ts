import { mustOk, type Db } from "../db.ts";

export type AnalysisStatus =
  | "created"
  | "ingesting"
  | "detecting"
  | "needs_review"
  | "masking"
  | "testing"
  | "aggregating"
  | "diagnosed"
  | "quiz_ready"
  | "quiz_in_progress"
  | "planning"
  | "rendering"
  | "retesting"
  | "reporting"
  | "done"
  | "failed";

// The state machine as data: for each target status, the statuses it may be entered from.
// `failed` is reachable from anywhere through fail_analysis, not through this table.
export const ALLOWED_FROM: Readonly<Record<Exclude<AnalysisStatus, "failed">, readonly AnalysisStatus[]>> = {
  created: [],
  ingesting: ["created"],
  detecting: ["created", "ingesting"],
  needs_review: ["detecting", "masking"],
  masking: ["needs_review"],
  testing: ["masking"],
  aggregating: ["testing"],
  diagnosed: ["aggregating"],
  quiz_ready: ["diagnosed"],
  quiz_in_progress: ["quiz_ready"],
  planning: ["quiz_in_progress"],
  rendering: ["planning"],
  retesting: ["rendering"],
  reporting: ["retesting"],
  done: ["reporting"],
};

export function canTransition(from: AnalysisStatus, to: AnalysisStatus): boolean {
  if (to === "failed") return from !== "failed" && from !== "done";
  return ALLOWED_FROM[to].includes(from);
}

// Compare-and-set in the database; returns false when the current status is not an allowed source,
// which is how a redelivered job notices that its work was already done.
export async function transition(db: Db, id: string, to: Exclude<AnalysisStatus, "failed">, from?: readonly AnalysisStatus[]): Promise<boolean> {
  const { data, error } = await db.rpc("set_analysis_status", {
    p_id: id,
    p_from: [...(from ?? ALLOWED_FROM[to])],
    p_to: to,
  });
  mustOk({ error }, `transition to ${to}`);
  return data === true;
}

export async function failAnalysis(db: Db, id: string, message: string): Promise<void> {
  mustOk(await db.rpc("fail_analysis", { p_id: id, p_error: message }), "fail_analysis");
}
