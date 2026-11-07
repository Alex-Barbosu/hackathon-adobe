// Thin Edge Function: verify the user, validate input, make a short write, enqueue. No image work and no
// model calls happen here; the worker does those.
import { authenticate, type Auth } from "./auth.ts";
import * as h from "./handlers.ts";
import { CORS_HEADERS, ApiError, errorResponse, json } from "./http.ts";
import * as quiz from "./quiz.ts";

type Handler = (req: Request, params: string[], auth: Auth) => Promise<Response>;

const routes: Array<[string, RegExp, Handler]> = [
  ["POST", /^\/brands$/, (r, _p, a) => h.createBrand(r, a)],
  ["POST", /^\/ads\/upload-url$/, (r, _p, a) => h.uploadUrl(r, a)],
  ["POST", /^\/ads\/([^/]+)\/ingest$/, (_r, p, a) => h.ingestAd(p[0]!, a)],
  ["POST", /^\/analyses$/, (r, _p, a) => h.createAnalysis(r, a)],
  ["GET", /^\/analyses\/([^/]+)$/, (_r, p, a) => h.getAnalysis(p[0]!, a)],
  ["GET", /^\/analyses\/([^/]+)\/regions$/, (_r, p, a) => h.getRegions(p[0]!, a)],
  ["PUT", /^\/analyses\/([^/]+)\/regions$/, (r, p, a) => h.putRegions(r, p[0]!, a)],
  ["POST", /^\/analyses\/([^/]+)\/regions\/approve$/, (r, p, a) => h.approveRegions(r, p[0]!, a)],
  ["GET", /^\/analyses\/([^/]+)\/conditions$/, (_r, p, a) => h.getConditions(p[0]!, a)],
  ["GET", /^\/analyses\/([^/]+)\/diagnosis$/, (_r, p, a) => h.getDiagnosis(p[0]!, a)],
  ["GET", /^\/analyses\/([^/]+)\/variants$/, (_r, p, a) => h.getVariants(p[0]!, a)],
  ["GET", /^\/analyses\/([^/]+)\/report$/, (_r, p, a) => h.getReport(p[0]!, a)],
  ["POST", /^\/quiz\/start$/, (r, _p, a) => quiz.startQuiz(r, a)],
  ["GET", /^\/quiz\/([^/]+)\/next$/, (_r, p, a) => quiz.nextQuestion(p[0]!, a)],
  ["POST", /^\/quiz\/([^/]+)\/answer$/, (r, p, a) => quiz.answer(r, p[0]!, a)],
  ["POST", /^\/quiz\/([^/]+)\/use-recommended$/, (r, p, a) => quiz.recommended(r, p[0]!, a)],
  ["POST", /^\/quiz\/([^/]+)\/pairwise$/, (r, p, a) => quiz.pairwise(r, p[0]!, a)],
  ["POST", /^\/quiz\/([^/]+)\/finish$/, (_r, p, a) => quiz.finish(p[0]!, a)],
  ["GET", /^\/quota$/, (_r, _p, a) => h.getQuota(a)],
];

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  try {
    // The function is mounted at /functions/v1/api, so drop everything up to and including "/api".
    const path = new URL(req.url).pathname.replace(/^.*?\/api(?=\/|$)/, "") || "/";
    if (path === "/health") return json({ ok: true });
    for (const [method, pattern, handler] of routes) {
      const m = pattern.exec(path);
      if (m && method === req.method) return await handler(req, m.slice(1), await authenticate(req));
    }
    throw new ApiError(404, "not_found", `No route for ${req.method} ${path}`);
  } catch (err) {
    return errorResponse(err);
  }
});
