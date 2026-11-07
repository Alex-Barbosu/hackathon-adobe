// End-to-end driver: create an analysis through the API, run the worker in-process, answer the quiz,
// and print the result. Flags: --target-brand --competitors --preset --seed --auto-approve
// --quiz-answers <file> --stop-at <status> --simulated --json
import { readFileSync } from "node:fs";
import { api, env, flag, session, sleep } from "./lib.ts";
import { localWorker } from "./runner.ts";

const simulated = flag("simulated") !== undefined;
const e = env(simulated);
const s = await session();
const { handle, ctx } = localWorker(e, simulated);
const db = ctx.db;
const stopAt = flag("stop-at");
const answersFile = flag("quiz-answers");
const answers = answersFile ? (JSON.parse(readFileSync(answersFile, "utf8")) as Record<string, unknown>) : {};

const slugs = [flag("target-brand") ?? "sunny", ...(flag("competitors") ?? "zest,nova,rouge").split(",")];
const { data: brands } = await db.from("brands").select("id, slug").eq("owner_id", s.uid).in("slug", slugs);
const brandId = (slug: string): string => {
  const b = brands?.find((x) => x.slug === slug);
  if (!b) throw new Error(`Brand ${slug} not found; run scripts/seed-demo.ts first`);
  return b.id;
};
const { data: targetAd } = await db.from("ads").select("id").eq("brand_id", brandId(slugs[0] ?? "")).order("created_at").limit(1).single();
if (!targetAd) throw new Error("target brand has no ads");

const a = await api<{ id: string }>(s, "POST", "/analyses", {
  targetAdId: targetAd.id,
  competitorBrandIds: slugs.slice(1).map(brandId),
  preset: flag("preset") ?? "free",
  ...(flag("seed") ? { seed: Number(flag("seed")) } : {}),
});
console.log(`analysis ${a.id}`);

interface Next {
  next: {
    kind: string;
    question?: { id: string; key: string; type: string; options: Array<{ value: string }> };
    round?: { id: string };
  };
}
let pairIdx = 0;

async function driveQuiz(): Promise<void> {
  const start = await api<Next & { sessionId: string }>(s, "POST", "/quiz/start", { analysisId: a.id });
  let step: Next = start;
  for (let i = 0; i < 60; i++) {
    const n = step.next;
    if (n.kind === "question" && n.question) {
      const q = n.question;
      const given = answers[q.key] ?? (q.key.startsWith("DYN_") ? answers["DYN_*"] : undefined);
      if (given === undefined || given === "recommended") {
        try {
          step = await api<Next>(s, "POST", `/quiz/${start.sessionId}/use-recommended`, { questionId: q.id });
          continue;
        } catch {
          // Clarifying questions need a real answer; fall through.
        }
        const v = q.type === "yes_no" ? true : q.options[0]?.value;
        step = await api<Next>(s, "POST", `/quiz/${start.sessionId}/answer`, { questionId: q.id, value: v });
      } else {
        step = await api<Next>(s, "POST", `/quiz/${start.sessionId}/answer`, { questionId: q.id, value: given });
      }
    } else if (n.kind === "pairwise" && n.round) {
      const picks = (answers["PAIRWISE"] as string[] | undefined) ?? ["a", "b", "a"];
      step = await api<Next>(s, "POST", `/quiz/${start.sessionId}/pairwise`, { roundId: n.round.id, choice: picks[pairIdx++ % picks.length] });
    } else break;
  }
  const done = await api<{ brief: unknown; hash: string }>(s, "POST", `/quiz/${start.sessionId}/finish`);
  console.log("brief hash", done.hash);
  console.log(JSON.stringify(done.brief, null, 2));
}

let last = "";
let quizDone = false;
let approved = false;
for (let i = 0; i < 900; i++) {
  const { analysis } = await api<{ analysis: { status: string; error: string | null } }>(s, "GET", `/analyses/${a.id}`);
  if (analysis.status !== last) {
    console.log(`status: ${analysis.status}`);
    last = analysis.status;
  }
  if (analysis.status === "failed") throw new Error(`analysis failed: ${analysis.error ?? ""}`);
  if (stopAt && analysis.status === stopAt) break;
  if (analysis.status === "needs_review" && flag("auto-approve") && !approved) {
    const r = await api<{ regions: Array<{ id: string; kind: string; box: number[]; label: string | null }> }>(s, "GET", `/analyses/${a.id}/regions`);
    await api(s, "PUT", `/analyses/${a.id}/regions`, {
      regions: r.regions.map((x) => ({ id: x.id, kind: x.kind, box: x.box, label: x.label ?? undefined, approved: true })),
    });
    await api(s, "POST", `/analyses/${a.id}/regions/approve`, {});
    approved = true;
  }
  if (analysis.status === "quiz_ready" && !quizDone) {
    quizDone = true;
    await driveQuiz();
  }
  if (analysis.status === "done") {
    const rep = await api<{ markdown: string; numberCheck: unknown }>(s, "GET", `/analyses/${a.id}/report`);
    const variants = await api<unknown[]>(s, "GET", `/analyses/${a.id}/variants`);
    const diag = await api<unknown>(s, "GET", `/analyses/${a.id}/diagnosis`);
    if (flag("json")) console.log(JSON.stringify({ diag, variants, report: rep }, null, 2));
    else console.log(`\n${rep.markdown}\nnumber check: ${JSON.stringify(rep.numberCheck)}`);
    break;
  }
  await sleep(2000);
}
await handle.stop();
process.exit(0);
