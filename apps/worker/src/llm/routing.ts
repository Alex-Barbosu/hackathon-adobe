import type { Env } from "../env.ts";
import type { Task } from "./client.ts";

export type ModelNames = Pick<
  Env,
  | "MODEL_PANEL"
  | "MODEL_DETECT"
  | "MODEL_QUIZ"
  | "MODEL_BRANDFIT"
  | "MODEL_PLAN"
  | "MODEL_REPORT"
  | "MODEL_FALLBACK"
>;

// Ordered model chain per task. The panel never falls back: switching models mid-analysis would
// change the measuring instrument.
export function modelChain(task: Task, m: ModelNames): string[] {
  const chain: Record<Task, string[]> = {
    panel: [m.MODEL_PANEL],
    detect: [m.MODEL_DETECT, m.MODEL_FALLBACK],
    leak_check: [m.MODEL_DETECT, m.MODEL_FALLBACK],
    quiz_bank: [m.MODEL_QUIZ, m.MODEL_FALLBACK],
    directions: [m.MODEL_QUIZ, m.MODEL_FALLBACK],
    plan: [m.MODEL_PLAN, m.MODEL_FALLBACK],
    plan_repair: [m.MODEL_PLAN, m.MODEL_FALLBACK],
    brand_fit: [m.MODEL_BRANDFIT, m.MODEL_FALLBACK],
    report: [m.MODEL_REPORT, m.MODEL_FALLBACK],
  };
  return [...new Set(chain[task])];
}

// Thinking effort per task, constrained to what each model accepts (verified in docs/VERIFIED_APIS.md).
const LEVELS_BY_MODEL: Readonly<Record<string, readonly string[]>> = {
  "gemini-3.5-flash-lite": ["minimal", "low", "medium", "high"],
  "gemini-3.6-flash": ["minimal", "low", "medium", "high"],
  "gemini-3.8-flash": ["low", "medium", "high"],
};

const WANTED: Record<Task, string> = {
  detect: "minimal",
  leak_check: "minimal",
  panel: "low",
  quiz_bank: "low",
  directions: "low",
  plan: "medium",
  plan_repair: "low",
  brand_fit: "low",
  report: "low",
};

export function thinkingLevel(task: Task, model: string): string | undefined {
  const allowed = LEVELS_BY_MODEL[model];
  // Unknown model: send nothing and let the server default apply.
  if (!allowed) return undefined;
  const want = WANTED[task];
  if (allowed.includes(want)) return want;
  return allowed.includes("low") ? "low" : allowed[0];
}
