import {
  AnswerBody,
  MAX_QUESTIONS,
  PAIRWISE_ROUNDS,
  PairwiseBody,
  RecommendedBody,
  StartQuizBody,
  addRound,
  answerPairwise,
  answerQuestion,
  emptyDraft,
  finishBrief,
  initialState,
  orderOfKey,
  requiredLeft,
  selectNext,
  useRecommended,
  type AnswerOutcome,
  type BriefDraft,
  type DirectionState,
  type NextStep,
  type QuizContext,
  type QuizQuestion,
  type QuizState,
} from "../_shared/core/index.ts";
import { enqueue, owned, transition, type Auth } from "./auth.ts";
import { ApiError, json, readBody } from "./http.ts";

type Row = Record<string, unknown>;

function check<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as NonNullable<T>;
}

interface Loaded {
  session: Row;
  state: QuizState;
  ctx: QuizContext;
  analysisId: string;
}

function toQuestion(r: Row): QuizQuestion {
  return {
    id: r["id"] as string,
    key: r["key"] as string,
    source: r["source"] as QuizQuestion["source"],
    type: r["type"] as QuizQuestion["type"],
    prompt: r["prompt"] as string,
    help: (r["help"] as string | null) ?? null,
    options: r["options"] as QuizQuestion["options"],
    constraints: r["constraints"] as QuizQuestion["constraints"],
    fillsSlots: r["fills_slots"] as string[],
    required: r["required"] as boolean,
    priority: r["priority"] as number,
    dependsOn: (r["depends_on"] as QuizQuestion["dependsOn"]) ?? null,
    findingKey: (r["finding_key"] as string | null) ?? null,
    order: orderOfKey(r["key"] as string),
  };
}

async function load(sessionId: string, { uid, admin }: Auth): Promise<Loaded> {
  const session = await owned<Row>(admin, "quiz_sessions", sessionId, uid);
  const analysisId = session["analysis_id"] as string;
  const analysis = await owned<Row>(admin, "analyses", analysisId, uid);
  const qs = check(await admin.from("quiz_questions").select("*").eq("session_id", sessionId), "questions") as Row[];
  const answers = check(await admin.from("quiz_answers").select("*").eq("session_id", sessionId).order("answered_at"), "answers") as Row[];
  const dirs = check(await admin.from("directions").select("*").eq("session_id", sessionId).order("id"), "directions") as Row[];
  const rounds = check(await admin.from("pairwise_rounds").select("*").eq("session_id", sessionId).order("round_index"), "rounds") as Row[];

  const bank = qs.map(toQuestion).sort((a, b) => a.order - b.order || (a.key < b.key ? -1 : 1));
  const keyOf = new Map(qs.map((q) => [q["id"] as string, q["key"] as string]));
  const directions: DirectionState[] = dirs.map((d) => ({
    id: d["id"] as string,
    title: d["title"] as string,
    description: d["description"] as string,
    tags: d["tags"] as string[],
    elo: d["elo"] as number,
    comparisons: d["comparisons"] as number,
  }));
  const base = initialState(bank, directions, PAIRWISE_ROUNDS);
  const draft = (session["brief_draft"] as Partial<BriefDraft>) ?? {};
  const state: QuizState = {
    ...base,
    answers: Object.fromEntries(answers.map((a) => [keyOf.get(a["question_id"] as string) ?? "", a["value"]])),
    asked: answers.map((a) => keyOf.get(a["question_id"] as string) ?? ""),
    draft: draft.fields ? { fields: draft.fields, filled: draft.filled ?? [], provenance: draft.provenance ?? [] } : emptyDraft(),
    pairwise: {
      ...base.pairwise,
      rounds: rounds.map((r) => ({
        id: r["id"] as string,
        index: r["round_index"] as number,
        aId: r["a_id"] as string,
        bId: r["b_id"] as string,
        choice: (r["choice"] as "a" | "b" | "neither" | null) ?? null,
      })),
    },
  };

  const [regions, brands, baseline, findings] = await Promise.all([
    admin.from("regions").select("id").eq("analysis_id", analysisId).eq("ad_id", analysis["target_ad_id"]).eq("approved", true).eq("is_identifier", true),
    admin.from("analysis_brands").select("*").eq("analysis_id", analysisId).eq("is_target", false),
    admin.from("conditions").select("id").eq("analysis_id", analysisId).eq("kind", "baseline").maybeSingle(),
    admin.from("findings").select("*").eq("analysis_id", analysisId),
  ]);
  const metrics = baseline.data
    ? (await admin.from("condition_metrics").select("pull").eq("condition_id", baseline.data.id).maybeSingle()).data
    : null;
  const pull = (metrics?.pull ?? {}) as Record<string, number>;
  const cfg = (analysis["config"] ?? {}) as { competitorPalettes?: Record<string, string[]> };
  const ctx: QuizContext = {
    identifierRegionIds: (regions.data ?? []).map((r) => r.id as string),
    competitors: (brands.data ?? []).map((b) => ({ id: b.brand_id as string, name: b.candidate_label as string, pull: pull[b.brand_id as string] ?? 0 })),
    findings: (findings.data ?? []).map((f) => ({
      findingKey: f.finding_key, rule: f.rule, element: f.element, brandId: f.brand_id, severity: f.severity, evidence: f.evidence,
    })),
    competitorPalettes: cfg.competitorPalettes ?? {},
  };
  return { session, state, ctx, analysisId };
}

// Pairwise rounds are created lazily, the first time the engine asks for one.
async function nextStep(loaded: Loaded, { admin }: Auth): Promise<{ next: NextStep; state: QuizState }> {
  let { state } = loaded;
  const step = selectNext(state);
  if (step.kind === "pairwise" && step.round.id === null) {
    const row = check(
      await admin.from("pairwise_rounds").insert({
        session_id: loaded.session["id"], round_index: step.round.index, a_id: step.round.a.id, b_id: step.round.b.id,
      }).select().single(),
      "create round",
    ) as Row;
    state = addRound(state, { id: row["id"] as string, aId: step.round.a.id, bId: step.round.b.id });
    return { next: { kind: "pairwise", round: { ...step.round, id: row["id"] as string } }, state };
  }
  return { next: step, state };
}

function progress(state: QuizState): Record<string, number> {
  return { asked: state.asked.length, max: MAX_QUESTIONS, requiredLeft: requiredLeft(state) };
}

async function persistAnswer(loaded: Loaded, out: AnswerOutcome, key: string, auth: Auth): Promise<void> {
  const { admin } = auth;
  const sessionId = loaded.session["id"] as string;
  const q = loaded.state.bank.find((x) => x.key === key);
  if (!q) throw new ApiError(404, "not_found", "Unknown question");
  for (const c of out.newClarify) {
    check(
      await admin.from("quiz_questions").insert({
        session_id: sessionId, key: c.key, source: c.source, type: c.type, prompt: c.prompt, help: c.help,
        options: c.options, constraints: c.constraints, fills_slots: c.fillsSlots, required: c.required,
        priority: c.priority, depends_on: c.dependsOn, finding_key: c.findingKey,
      }),
      "insert clarify",
    );
  }
  check(await admin.from("quiz_answers").upsert({ question_id: q.id, session_id: sessionId, value: out.state.answers[key] ?? null }), "answer");
  check(
    await admin.from("quiz_questions").update({ asked_at: new Date().toISOString(), position: out.state.asked.indexOf(key) }).eq("id", q.id),
    "mark asked",
  );
  check(
    await admin.from("quiz_sessions").update({ brief_draft: out.state.draft, asked_count: out.state.asked.length, status: "open" }).eq("id", sessionId),
    "save draft",
  );
}

async function respond(sessionId: string, auth: Auth, extra: Record<string, unknown> = {}): Promise<Response> {
  const loaded = await load(sessionId, auth);
  const { next, state } = await nextStep(loaded, auth);
  return json({ next, progress: progress(state), ...extra });
}

export async function startQuiz(req: Request, auth: Auth): Promise<Response> {
  const { analysisId } = await readBody(req, StartQuizBody);
  const a = await owned<Row>(auth.admin, "analyses", analysisId, auth.uid);
  const { data } = await auth.admin.from("quiz_sessions").select("id").eq("analysis_id", analysisId).maybeSingle();
  if (!data) throw new ApiError(409, "quiz_not_ready", `Quiz not ready yet (analysis is ${a["status"] as string})`);
  await transition(auth.admin, analysisId, ["quiz_ready"], "quiz_in_progress");
  return respond(data.id as string, auth, { sessionId: data.id });
}

export const nextQuestion = (sessionId: string, auth: Auth): Promise<Response> => respond(sessionId, auth);

async function applyOutcome(sessionId: string, key: string, outcome: (l: Loaded) => AnswerOutcome, auth: Auth): Promise<Response> {
  const loaded = await load(sessionId, auth);
  if (loaded.session["status"] === "finished") throw new ApiError(409, "finished", "Quiz already finished");
  const out = outcome(loaded);
  if (out.errors.length > 0) throw new ApiError(422, "invalid_answer", out.errors.join("; "));
  await persistAnswer(loaded, out, key, auth);
  return respond(sessionId, auth, { warnings: out.warnings });
}

async function keyOfQuestion(sessionId: string, questionId: string, auth: Auth): Promise<string> {
  const { data } = await auth.admin.from("quiz_questions").select("key").eq("id", questionId).eq("session_id", sessionId).maybeSingle();
  if (!data) throw new ApiError(404, "not_found", "Question not found");
  return data.key as string;
}

export async function answer(req: Request, sessionId: string, auth: Auth): Promise<Response> {
  const body = await readBody(req, AnswerBody);
  const key = await keyOfQuestion(sessionId, body.questionId, auth);
  return applyOutcome(sessionId, key, (l) => answerQuestion(l.state, key, body.value, l.ctx), auth);
}

export async function recommended(req: Request, sessionId: string, auth: Auth): Promise<Response> {
  const body = await readBody(req, RecommendedBody);
  const key = await keyOfQuestion(sessionId, body.questionId, auth);
  return applyOutcome(sessionId, key, (l) => useRecommended(l.state, key, l.ctx), auth);
}

export async function pairwise(req: Request, sessionId: string, auth: Auth): Promise<Response> {
  const body = await readBody(req, PairwiseBody);
  const loaded = await load(sessionId, auth);
  if (!loaded.state.pairwise.rounds.some((r) => r.id === body.roundId)) throw new ApiError(404, "not_found", "Round not found");
  const state = answerPairwise(loaded.state, body.roundId, body.choice);
  const { admin } = auth;
  check(await admin.from("pairwise_rounds").update({ choice: body.choice, answered_at: new Date().toISOString() }).eq("id", body.roundId), "round");
  for (const d of state.pairwise.directions) {
    check(await admin.from("directions").update({ elo: d.elo, comparisons: d.comparisons }).eq("id", d.id), "direction");
  }
  return respond(sessionId, auth);
}

export async function finish(sessionId: string, auth: Auth): Promise<Response> {
  const { admin } = auth;
  const loaded = await load(sessionId, auth);
  const analysisId = loaded.analysisId;
  const prev = (await admin.from("creative_briefs").select("*").eq("analysis_id", analysisId).order("version", { ascending: false }).limit(1).maybeSingle()).data;
  if (loaded.session["status"] === "finished" && prev) return json({ briefId: prev.id, brief: prev.brief, hash: prev.brief_hash });
  let result;
  try {
    result = finishBrief(loaded.state, loaded.ctx);
  } catch (e) {
    throw new ApiError(409, "not_ready", e instanceof Error ? e.message : "Quiz cannot finish yet");
  }
  // Claim the session atomically so two concurrent finishes cannot both create a brief and plan variants.
  const claimed = await admin.from("quiz_sessions").update({ status: "finished", finished_at: new Date().toISOString() }).eq("id", sessionId).neq("status", "finished").select("id");
  if (claimed.error) throw new Error(claimed.error.message);
  if ((claimed.data ?? []).length === 0) throw new ApiError(409, "already_finishing", "Quiz is already being finished; retry to fetch the brief");
  const row = check(
    await admin.from("creative_briefs").insert({
      session_id: sessionId, analysis_id: analysisId, version: (prev?.version ?? 0) + 1, brief: result.brief, brief_hash: result.hash,
    }).select().single(),
    "insert brief",
  ) as Row;
  await transition(admin, analysisId, ["quiz_in_progress"], "planning");
  await enqueue(admin, { type: "plan_variants", analysisId, briefId: row["id"] as string, idem: `plan_variants:${analysisId}` });
  return json({ briefId: row["id"], brief: result.brief, hash: result.hash });
}
