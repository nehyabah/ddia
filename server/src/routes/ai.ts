import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { BADGES, addXP, localDay } from "../progress.js";
import { HttpError, int, str } from "../http.js";
import type { Challenge } from "../javaContent.js";
import { PASS_SCORE, getPuzzle, markSolved } from "./puzzles.js";
import { assertUnlocked } from "./study.js";

export const ai = Router();

const MODEL = process.env.GRADER_MODEL ?? "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.GRADER_DAILY_LIMIT ?? 60);

db.exec(`
CREATE TABLE IF NOT EXISTS ai_grades (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  answer TEXT NOT NULL,
  score INTEGER NOT NULL,
  result TEXT NOT NULL,
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_grades_user_day ON ai_grades(user_id, day);
`);

let client: Anthropic | null = null;
const enabled = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const getClient = () => (client ??= new Anthropic());

const Grade = z.object({
  score: z.number().int().describe("0-10. 10 = complete and correct, as a strong candidate would say it in an interview."),
  verdict: z.string().describe("One short sentence summing up the answer."),
  covered: z.array(z.string()).describe("Key points the answer got right, phrased briefly."),
  missed: z.array(z.string()).describe("Important points that are missing."),
  mistakes: z.array(z.string()).describe("Statements that are wrong or misleading, each with the correction."),
  tip: z.string().describe("The single most useful thing to improve next time."),
  modelAnswer: z.string().describe("A concise model answer (3-6 sentences) in plain language."),
});
export type GradeResult = z.infer<typeof Grade>;

const SYSTEM = `You are a rigorous but encouraging tutor helping someone prepare for senior software engineering interviews
(distributed systems from "Designing Data-Intensive Applications", MongoDB internals, and Java debugging).
Grade the student's answer against the reference material. Judge substance, not wording: credit correct ideas phrased differently,
and do not reward length or buzzwords. Point out factual errors explicitly. Keep every list item short. If the answer is empty
or off-topic, score 0 and say so.`;

/** Reference material is always loaded server-side so the client can't alter what it's graded against. */
let userIdForLock: number | null = null;
type RefFn = (id: string, userId: number) => { question: string; reference: string };
const EXTRA_REFS = new Map<string, RefFn>();
/** Other modules register how to build the question + reference for their own kinds. */
export function registerReference(kind: string, fn: RefFn) { EXTRA_REFS.set(kind, fn); }
type GradedHook = (userId: number, id: string, score: number) => void;
const ON_GRADED = new Map<string, GradedHook>();
export function onGraded(kind: string, fn: GradedHook) { ON_GRADED.set(kind, fn); }
function reference(kind: string, id: string): { question: string; reference: string } {
  if (kind === "card") {
    const r = db.prepare("SELECT k.title, k.bullets, c.title AS chapter FROM cards k JOIN chapters c ON c.id = k.chapter_id WHERE k.id = ?")
      .get(int(id, "id")) as { title: string; bullets: string; chapter: string } | undefined;
    if (!r) throw new HttpError(404, "No such card");
    return {
      question: `Explain "${r.title}" (from the DDIA topic "${r.chapter}") in your own words.`,
      reference: (JSON.parse(r.bullets) as string[]).map((b) => `- ${b}`).join("\n"),
    };
  }
  if (kind === "drill") {
    const r = db.prepare("SELECT prompt, points, chapter_id FROM drills WHERE id = ?").get(int(id, "id")) as { prompt: string; points: string; chapter_id: number } | undefined;
    if (!r) throw new HttpError(404, "No such drill");
    if (userIdForLock != null) assertUnlocked(userIdForLock, r.chapter_id);
    return { question: r.prompt, reference: "Key points a strong answer covers:\n" + (JSON.parse(r.points) as string[]).map((p) => `- ${p}`).join("\n") };
  }
  if (kind === "java") {
    const r = db.prepare("SELECT data FROM java_challenges WHERE id = ?").get(id) as { data: string } | undefined;
    if (!r) throw new HttpError(404, "No such challenge");
    const c = JSON.parse(r.data) as Challenge;
    return {
      question: `Explain the bug in this Java program, why it happens, and how to fix it.\nScenario: ${c.scenario}\n\n${c.code}`,
      reference: `Root cause: ${c.options[c.answer]}\nExplanation: ${c.explanation}\nFix: ${c.fixNote}\nHow to catch it: ${c.debugTip}`,
    };
  }
  if (kind === "puzzle") {
    const p = getPuzzle(id);
    if (p.kind !== "theory") throw new HttpError(400, "Only theory puzzles are graded in writing");
    return { question: `${p.prompt}\n${p.question}`, reference: "Key points a strong answer covers:\n" + (p.keyPoints ?? []).map((k) => `- ${k}`).join("\n") + `\n\nModel answer: ${p.modelAnswer}` };
  }
  const ext = EXTRA_REFS.get(kind);
  if (ext) return ext(id, userIdForLock ?? 0);
  throw new HttpError(400, "Unknown kind");
}

ai.get("/ai/status", (req, res) => {
  const used = (db.prepare("SELECT COUNT(*) AS n FROM ai_grades WHERE user_id = ? AND day = ?").get(req.userId, localDay()) as { n: number }).n;
  res.json({ enabled: enabled(), used, limit: DAILY_LIMIT });
});

ai.post("/ai/grade", async (req, res) => {
  if (!enabled()) throw new HttpError(503, "AI grading isn't configured: set ANTHROPIC_API_KEY on the server");
  const u = req.userId;
  const kind = str(req.body?.kind, "kind", 1, 12);
  const id = String(req.body?.id ?? "");
  const answer = str(req.body?.answer, "answer", 1, 12000).trim();
  if (answer.length < 15) throw new HttpError(400, "Write a bit more before asking for a grade");
  const used = (db.prepare("SELECT COUNT(*) AS n FROM ai_grades WHERE user_id = ? AND day = ?").get(u, localDay()) as { n: number }).n;
  if (used >= DAILY_LIMIT) throw new HttpError(429, `Daily AI grading limit reached (${DAILY_LIMIT}). It resets tomorrow.`);
  userIdForLock = u;
  const ref = reference(kind, id);
  userIdForLock = null;

  let result: GradeResult;
  try {
    const response = await getClient().messages.parse({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "low", format: zodOutputFormat(Grade) },
      system: SYSTEM,
      messages: [{
        role: "user",
        content: `<question>\n${ref.question}\n</question>\n<reference>\n${ref.reference}\n</reference>\n<student_answer>\n${answer}\n</student_answer>`,
      }],
    });
    if (response.stop_reason === "refusal") throw new HttpError(422, "The grader declined this answer. Try rephrasing it.");
    if (!response.parsed_output) throw new HttpError(502, "The grader returned an unreadable result. Please try again.");
    result = response.parsed_output;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new HttpError(503, "The ANTHROPIC_API_KEY on the server was rejected");
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, "The AI grader is busy. Try again in a minute.");
    if (e instanceof Anthropic.APIError) {
      console.error("[ai] API error", e.status, e.message);
      throw new HttpError(502, e.status === 400 && /credit/i.test(e.message) ? "Your Anthropic account is out of credits" : "The AI grader failed. Please try again.");
    }
    throw e;
  }

  result.score = Math.max(0, Math.min(10, Math.round(result.score)));
  db.prepare("INSERT INTO ai_grades (user_id, kind, ref_id, answer, score, result, day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(u, kind, id, answer, result.score, JSON.stringify(result), localDay(), Date.now());
  let xp = result.score * 2;
  const badges = addXP(u, xp, `ai:${kind}`);
  const passed = result.score >= PASS_SCORE;
  ON_GRADED.get(kind)?.(u, id, result.score);
  if (kind === "puzzle" && passed) {
    const prior = (db.prepare("SELECT COUNT(*) AS n FROM ai_grades WHERE user_id = ? AND kind = 'puzzle' AND ref_id = ?").get(u, id) as { n: number }).n;
    const r = markSolved(u, getPuzzle(id), prior <= 1, result.score);
    xp += r.xp; badges.push(...r.badges);
  }
  res.json({ ...result, passed, passScore: PASS_SCORE, xp, newBadges: badges.map((b) => ({ id: b, label: BADGES[b] ?? b })), used: used + 1, limit: DAILY_LIMIT });
});

ai.get("/ai/history", (req, res) => {
  const kind = String(req.query.kind ?? ""), id = String(req.query.id ?? "");
  const rows = db.prepare("SELECT answer, score, result, created_at FROM ai_grades WHERE user_id = ? AND kind = ? AND ref_id = ? ORDER BY id DESC LIMIT 5")
    .all(req.userId, kind, id) as { answer: string; score: number; result: string; created_at: number }[];
  res.json(rows.map((r) => ({ ...(JSON.parse(r.result) as GradeResult), answer: r.answer, score: r.score, createdAt: r.created_at })));
});

/** Best AI score so far for one item; drills and theory puzzles unlock "Next" at PASS_SCORE. */
ai.get("/ai/best", (req, res) => {
  const kind = String(req.query.kind ?? ""), id = String(req.query.id ?? "");
  const r = db.prepare("SELECT MAX(score) AS best FROM ai_grades WHERE user_id = ? AND kind = ? AND ref_id = ?").get(req.userId, kind, id) as { best: number | null };
  res.json({ best: r.best, passScore: PASS_SCORE, enabled: enabled(), passed: !enabled() || (r.best ?? 0) >= PASS_SCORE });
});

/* ============================================================
   Interviewer follow-ups: probe an answer the way a real interviewer would.
   ============================================================ */
const FollowUp = z.object({
  question: z.string().describe("ONE follow-up question, as an interviewer would say it out loud. Short."),
  why: z.string().describe("Half a sentence: what this probes (shown to the candidate after they answer)."),
});
const FollowGrade = z.object({
  score: z.number().int().describe("0-10 for the reply to this follow-up only."),
  feedback: z.string().describe("1-2 sentences: what was good or missing."),
  betterAnswer: z.string().describe("2-4 sentence strong reply."),
});
type Turn = { q: string; a: string };

const FOLLOW_SYSTEM = `You are a senior engineer interviewing a candidate for a senior software engineering role.
You probe answers the way a strong interviewer does: push on the weakest or vaguest part, ask "what happens when X fails",
"why not Y", "how would you measure it", "what are the trade-offs", or ask for a concrete number or example.
Never repeat a question already asked. Never give away the answer in the question.`;

function readTurns(x: unknown): Turn[] {
  if (!Array.isArray(x)) return [];
  return x.slice(0, 5).map((t) => ({ q: String((t as Turn)?.q ?? "").slice(0, 1000), a: String((t as Turn)?.a ?? "").slice(0, 4000) }));
}
function usedToday(u: number) {
  return (db.prepare("SELECT COUNT(*) AS n FROM ai_grades WHERE user_id = ? AND day = ?").get(u, localDay()) as { n: number }).n;
}
async function callModel<T extends z.ZodTypeAny>(schema: T, system: string, content: string): Promise<z.infer<T>> {
  try {
    const r = await getClient().messages.parse({ model: MODEL, max_tokens: 2000, output_config: { effort: "low", format: zodOutputFormat(schema) }, system, messages: [{ role: "user", content }] });
    if (!r.parsed_output) throw new HttpError(502, "The interviewer returned an unreadable result. Try again.");
    return r.parsed_output as z.infer<T>;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, "Busy. Try again in a minute.");
    if (e instanceof Anthropic.APIError) { console.error("[ai] follow-up", e.status, e.message); throw new HttpError(502, "The interviewer failed. Try again."); }
    throw e;
  }
}
function transcript(ref: { question: string }, answer: string, turns: Turn[]) {
  return `<question>\n${ref.question}\n</question>\n<candidate_answer>\n${answer}\n</candidate_answer>\n` +
    turns.map((t, i) => `<follow_up n="${i + 1}">\n<q>${t.q}</q>\n<a>${t.a}</a>\n</follow_up>`).join("\n");
}

ai.post("/ai/followup", async (req, res) => {
  if (!enabled()) throw new HttpError(503, "AI isn't configured on the server");
  const u = req.userId!;
  const kind = str(req.body?.kind, "kind", 1, 12), id = String(req.body?.id ?? "");
  const answer = str(req.body?.answer, "answer", 1, 12000);
  const turns = readTurns(req.body?.history);
  if (turns.length >= 3) throw new HttpError(400, "That's three follow-ups. Move on to the next question.");
  if (usedToday(u) >= DAILY_LIMIT) throw new HttpError(429, `Daily AI limit reached (${DAILY_LIMIT}).`);
  userIdForLock = u; const ref = reference(kind, id); userIdForLock = null;
  const out = await callModel(FollowUp, FOLLOW_SYSTEM, `${transcript(ref, answer, turns)}\n<reference_for_you_only>\n${ref.reference}\n</reference_for_you_only>\nAsk follow-up number ${turns.length + 1}.`);
  res.json(out);
});

ai.post("/ai/followup/grade", async (req, res) => {
  if (!enabled()) throw new HttpError(503, "AI isn't configured on the server");
  const u = req.userId!;
  const kind = str(req.body?.kind, "kind", 1, 12), id = String(req.body?.id ?? "");
  const answer = str(req.body?.answer, "answer", 1, 12000);
  const turns = readTurns(req.body?.history);
  const question = str(req.body?.question, "question", 1, 1000);
  const reply = str(req.body?.reply, "reply", 1, 6000).trim();
  if (reply.length < 10) throw new HttpError(400, "Answer the follow-up first");
  const used = usedToday(u);
  if (used >= DAILY_LIMIT) throw new HttpError(429, `Daily AI limit reached (${DAILY_LIMIT}).`);
  userIdForLock = u; const ref = reference(kind, id); userIdForLock = null;
  const g = await callModel(FollowGrade, SYSTEM, `${transcript(ref, answer, turns)}\n<reference>\n${ref.reference}\n</reference>\nGrade ONLY the candidate's reply to this latest follow-up.\n<latest_follow_up>${question}</latest_follow_up>\n<reply>${reply}</reply>`);
  g.score = Math.max(0, Math.min(10, Math.round(g.score)));
  db.prepare("INSERT INTO ai_grades (user_id, kind, ref_id, answer, score, result, day, created_at) VALUES (?, 'followup', ?, ?, ?, ?, ?, ?)")
    .run(u, `${kind}:${id}`, reply, g.score, JSON.stringify({ ...g, question }), localDay(), Date.now());
  const xp = g.score;
  const badges = addXP(u, xp, "ai:followup");
  res.json({ ...g, xp, newBadges: badges.map((b) => ({ id: b, label: BADGES[b] ?? b })), used: used + 1, limit: DAILY_LIMIT });
});
