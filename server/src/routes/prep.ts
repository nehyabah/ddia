import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { ROOT, db } from "../db.js";
import { HttpError, str } from "../http.js";
import { BADGES, addXP, localDay } from "../progress.js";
const nb = (b: string[]) => b.map((id) => ({ id, label: BADGES[id] ?? id }));
import { onGraded, registerReference } from "./ai.js";

/* ============================================================
   Interview prep: system design, coding, behavioural, MongoDB.
   Content lives in server/content/{design,coding,behavioral,mongo}.
   ============================================================ */

db.exec(`
CREATE TABLE IF NOT EXISTS design_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt_id TEXT NOT NULL, section TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT '', best_score INTEGER, updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, prompt_id, section)
);
CREATE TABLE IF NOT EXISTS coding_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id TEXT NOT NULL,
  code_js TEXT NOT NULL DEFAULT '', code_java TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0, best_passed INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
  solved INTEGER NOT NULL DEFAULT 0, first_try INTEGER NOT NULL DEFAULT 0, java_score INTEGER,
  solved_day TEXT, updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, problem_id)
);
CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, themes TEXT NOT NULL DEFAULT '[]',
  situation TEXT NOT NULL DEFAULT '', task TEXT NOT NULL DEFAULT '', action TEXT NOT NULL DEFAULT '', result TEXT NOT NULL DEFAULT '',
  best_score INTEGER, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS story_links (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL, story_id INTEGER NOT NULL,
  best_score INTEGER,
  PRIMARY KEY (user_id, question_id)
);
CREATE TABLE IF NOT EXISTS mongo_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ex_id TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, solved INTEGER NOT NULL DEFAULT 0,
  answer TEXT NOT NULL DEFAULT '', solved_day TEXT, updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, ex_id)
);
`);

/* ---------- content ---------- */
export type DesignSection = { key: string; title: string; prompt: string; keyPoints: string[] };
export type CompanyProfile = { id: string; name: string; summary: string; loop: { round: string; what: string; tips: string[] }[]; values: { name: string; meaning: string }[]; valuesNote?: string; weights: Record<string, number>; focusTopics: string[] };
export type DesignPrompt = { type?: "system" | "ood" | "api"; company?: string; id: string; title: string; level: string; brief: string; constraints: string[]; sections: DesignSection[]; modelSummary: string };
export type CodingProblem = {
  javaOnly?: boolean; company?: string; id: string; title: string; level: string; topic: string; prompt: string; fn: string;
  starter: { js: string; java: string }; tests: { name: string; call: string; expected: unknown }[];
  solution: { js: string; java: string }; complexity: string; hints: string[]; keyPoints: string[];
};
export type BehavioralQ = { company?: string; value?: string; id: string; text: string; themes: string[]; level: string; assesses: string; strongSignals: string[]; redFlags: string[]; followUps: string[] };
export type Behavioral = { themes: { id: string; label: string; description: string }[]; questions: BehavioralQ[]; starGuide: Record<string, string> };
export type MongoEx = {
  id: string; title: string; level: string; topic: string; kind: "find" | "aggregate" | "choice"; collection?: string; prompt: string;
  solution?: unknown; orderMatters?: boolean; expected?: unknown[]; hints?: string[]; explanation: string; options?: string[]; answer?: number;
};

const C = path.join(ROOT, "server", "content");
function load<T>(rel: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(path.join(C, rel), "utf8")) as T; }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") console.error(`[prep] ${rel}:`, (e as Error).message); return fallback; }
}
export const content = {
  design: [] as DesignPrompt[], coding: [] as CodingProblem[],
  behavioral: { themes: [], questions: [], starGuide: {} } as Behavioral,
  mongo: [] as MongoEx[], datasets: {} as Record<string, unknown[]>,
  companies: [] as CompanyProfile[],
};
export function loadPrep() {
  content.design = [...load<DesignPrompt[]>("design/prompts.json", []), ...load<DesignPrompt[]>("design/ood.json", []), ...load<DesignPrompt[]>("design/api.json", [])];
  content.coding = [...load<CodingProblem[]>("coding/problems.json", []), ...load<CodingProblem[]>("coding/concurrency.json", [])];
  content.behavioral = load("behavioral/questions.json", content.behavioral);
  content.mongo = load("mongo/exercises.json", []);
  content.datasets = load("mongo/datasets.json", {});
  // Company modules: server/content/companies/<id>/{profile,design,coding,behavioral}.json
  content.companies = [];
  const cdir = path.join(C, "companies");
  for (const id of fs.existsSync(cdir) ? fs.readdirSync(cdir).sort() : []) {
    const prof = load<CompanyProfile | null>(`companies/${id}/profile.json`, null);
    if (!prof) continue;
    content.companies.push(prof);
    const tag = <T extends { company?: string }>(xs: T[]) => xs.map((x) => ({ ...x, company: id }));
    content.design.push(...tag(load<DesignPrompt[]>(`companies/${id}/design.json`, [])));
    content.coding.push(...tag(load<CodingProblem[]>(`companies/${id}/coding.json`, [])));
    content.behavioral.questions.push(...tag(load<BehavioralQ[]>(`companies/${id}/behavioral.json`, [])));
  }
  const order = ["mongodb", "microsoft", "stripe"];
  content.companies.sort((a, b) => (order.indexOf(a.id) + 99) % 99 - (order.indexOf(b.id) + 99) % 99);
  console.log(`[prep] design ${content.design.length}, coding ${content.coding.length}, behavioural ${content.behavioral.questions.length}, mongo ${content.mongo.length}, companies ${content.companies.map((c) => c.id).join("/")}`);
}
const findOr404 = <T extends { id: string }>(list: T[], id: string, what: string) => {
  const x = list.find((i) => i.id === id);
  if (!x) throw new HttpError(404, `No such ${what}`);
  return x;
};

/* ---------- AI review references (server-side, so the client can't change them) ---------- */
registerReference("design", (id) => {
  const [pid, key] = id.split(":");
  const p = findOr404(content.design, pid, "design prompt");
  const s = p.sections.find((x) => x.key === key);
  if (!s) throw new HttpError(404, "No such section");
  return {
    question: `${p.type === "ood" ? "Object-oriented design" : p.type === "api" ? "API design" : "System design"} interview: ${p.title}.\n${p.brief}\nConstraints: ${p.constraints.join("; ")}\n\nSection "${s.title}": ${s.prompt}`,
    reference: "Key points a strong senior answer covers in this section:\n" + s.keyPoints.map((k) => `- ${k}`).join("\n") +
      `\n\nOverall strong design (context only; grade this section): ${p.modelSummary}`,
  };
});
registerReference("coding", (id) => {
  const p = findOr404(content.coding, id, "problem");
  return {
    question: `Coding interview problem (the candidate answered in Java; review the code as an interviewer would: correctness incl. edge cases, complexity, clarity).\n${p.prompt}`,
    reference: `Expected complexity: ${p.complexity}\nWhat to check:\n${p.keyPoints.map((k) => `- ${k}`).join("\n")}\nTest cases (JS notation):\n${p.tests.map((t) => `- ${t.call} => ${JSON.stringify(t.expected)}`).join("\n")}\nReference solution:\n${p.solution.java}`,
  };
});
registerReference("story", (id) => {
  const q = findOr404(content.behavioral.questions, id, "question");
  return {
    question: `Behavioural interview question for a senior engineer: "${q.text}"\nThe interviewer is assessing: ${q.assesses}\nThe candidate answers with a STAR story (Situation, Task, Action, Result). Grade the story as an answer to THIS question: relevance, the candidate's own actions ("I" not "we"), seniority of scope, quantified result, reflection.`,
    reference: `Strong signals:\n${q.strongSignals.map((x) => `- ${x}`).join("\n")}\nRed flags:\n${q.redFlags.map((x) => `- ${x}`).join("\n")}\nFor the model answer, show how to restructure THEIR story better (do not invent a different story).`,
  };
});

onGraded("design", (u, id, score) => {
  const [pid, key] = id.split(":");
  db.prepare(`INSERT INTO design_progress (user_id, prompt_id, section, best_score, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, prompt_id, section) DO UPDATE SET best_score = MAX(COALESCE(best_score, 0), excluded.best_score), updated_at = excluded.updated_at`)
    .run(u, pid, key, score, Date.now());
});
onGraded("coding", (u, id, score) => {
  db.prepare(`INSERT INTO coding_progress (user_id, problem_id, java_score, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, problem_id) DO UPDATE SET java_score = MAX(COALESCE(java_score, 0), excluded.java_score), updated_at = excluded.updated_at`)
    .run(u, id, score, Date.now());
  if (score >= 7) markCodingSolved(u, id, false);
});
onGraded("story", (u, id, score) => {
  db.prepare("UPDATE story_links SET best_score = MAX(COALESCE(best_score, 0), ?) WHERE user_id = ? AND question_id = ?").run(score, u, id);
  db.prepare("UPDATE stories SET best_score = MAX(COALESCE(best_score, 0), ?) WHERE user_id = ? AND id = (SELECT story_id FROM story_links WHERE user_id = ? AND question_id = ?)").run(score, u, u, id);
});

export const prep = Router();
const XP = { easy: 15, core: 20, medium: 25, senior: 30, advanced: 40, hard: 40 } as Record<string, number>;

/* ---------- system design ---------- */
prep.get("/design", (req, res) => {
  const rows = db.prepare("SELECT prompt_id, section, best_score, length(answer) len FROM design_progress WHERE user_id = ?").all(req.userId) as { prompt_id: string; section: string; best_score: number | null; len: number }[];
  res.json(content.design.map((p) => {
    const mine = rows.filter((r) => r.prompt_id === p.id);
    const passed = mine.filter((r) => (r.best_score ?? 0) >= 7).length;
    const scores = mine.filter((r) => r.best_score != null).map((r) => r.best_score!);
    return { id: p.id, type: p.type ?? "system", company: p.company ?? null, title: p.title, level: p.level, brief: p.brief, sections: p.sections.length, passed, started: mine.some((r) => r.len > 0 || r.best_score != null),
      avg: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null };
  }));
});
prep.get("/design/:id", (req, res) => {
  const p = findOr404(content.design, String(req.params.id), "design prompt");
  const rows = db.prepare("SELECT section, answer, best_score FROM design_progress WHERE user_id = ? AND prompt_id = ?").all(req.userId, p.id) as { section: string; answer: string; best_score: number | null }[];
  res.json({
    id: p.id, type: p.type ?? "system", title: p.title, level: p.level, brief: p.brief, constraints: p.constraints,
    sections: p.sections.map((s) => { const r = rows.find((x) => x.section === s.key); return { key: s.key, title: s.title, prompt: s.prompt, answer: r?.answer ?? "", best: r?.best_score ?? null }; }),
    modelSummary: rows.filter((r) => (r.best_score ?? 0) >= 7).length >= p.sections.length ? p.modelSummary : null,
  });
});
prep.put("/design/:id/:section", (req, res) => {
  const p = findOr404(content.design, String(req.params.id), "design prompt");
  const key = String(req.params.section);
  if (!p.sections.some((s) => s.key === key)) throw new HttpError(404, "No such section");
  const answer = typeof req.body?.answer === "string" ? req.body.answer.slice(0, 12000) : "";
  db.prepare(`INSERT INTO design_progress (user_id, prompt_id, section, answer, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, prompt_id, section) DO UPDATE SET answer = excluded.answer, updated_at = excluded.updated_at`).run(req.userId, p.id, key, answer, Date.now());
  res.json({ ok: true });
});
prep.post("/design/:id/summary", (req, res) => {
  const p = findOr404(content.design, String(req.params.id), "design prompt");
  res.json({ modelSummary: p.modelSummary, sections: p.sections.map((s) => ({ key: s.key, keyPoints: s.keyPoints })) });
});

/* ---------- coding ---------- */
function markCodingSolved(u: number, id: string, firstTry: boolean) {
  const r = db.prepare("SELECT solved FROM coding_progress WHERE user_id = ? AND problem_id = ?").get(u, id) as { solved: number } | undefined;
  if (r?.solved) return { xp: 0, badges: [] as string[] };
  db.prepare("UPDATE coding_progress SET solved = 1, first_try = ?, solved_day = ? WHERE user_id = ? AND problem_id = ?").run(firstTry ? 1 : 0, localDay(), u, id);
  const p = content.coding.find((x) => x.id === id);
  const xp = Math.round((XP[p?.level ?? "medium"] ?? 25) * (firstTry ? 1 : 0.6));
  return { xp, badges: addXP(u, xp, `coding:${id}`) };
}
prep.get("/coding", (req, res) => {
  const rows = db.prepare("SELECT problem_id, solved, attempts, best_passed, total, java_score FROM coding_progress WHERE user_id = ?").all(req.userId) as { problem_id: string; solved: number; attempts: number; best_passed: number; total: number; java_score: number | null }[];
  res.json(content.coding.map((p) => {
    const r = rows.find((x) => x.problem_id === p.id);
    return { id: p.id, javaOnly: !!p.javaOnly, company: p.company ?? null, title: p.title, level: p.level, topic: p.topic, solved: !!r?.solved, attempts: r?.attempts ?? 0, bestPassed: r?.best_passed ?? 0, total: p.tests.length, javaScore: r?.java_score ?? null };
  }));
});
prep.get("/coding/:id", (req, res) => {
  const p = findOr404(content.coding, String(req.params.id), "problem");
  const r = db.prepare("SELECT code_js, code_java, solved, attempts FROM coding_progress WHERE user_id = ? AND problem_id = ?").get(req.userId, p.id) as { code_js: string; code_java: string; solved: number; attempts: number } | undefined;
  res.json({
    id: p.id, javaOnly: !!p.javaOnly, title: p.title, level: p.level, topic: p.topic, prompt: p.prompt, fn: p.fn, starter: p.starter, hints: p.hints, complexity: p.complexity,
    tests: p.tests.map((t) => ({ name: t.name, call: t.call, expected: t.expected })),
    code: { js: r?.code_js || p.starter.js, java: r?.code_java || p.starter.java }, solved: !!r?.solved, attempts: r?.attempts ?? 0,
    solution: r?.solved || (r?.attempts ?? 0) >= 4 ? p.solution : null,
  });
});
prep.put("/coding/:id/code", (req, res) => {
  const p = findOr404(content.coding, String(req.params.id), "problem");
  const lang = req.body?.lang === "java" ? "java" : "js";
  const code = typeof req.body?.code === "string" ? req.body.code.slice(0, 20000) : "";
  db.prepare(`INSERT INTO coding_progress (user_id, problem_id, code_${lang}, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, problem_id) DO UPDATE SET code_${lang} = excluded.code_${lang}, updated_at = excluded.updated_at`).run(req.userId, p.id, code, Date.now());
  res.json({ ok: true });
});
/** Tests run in the learner's browser (their own code, sandboxed in a worker); the result is recorded here. */
prep.post("/coding/:id/result", (req, res) => {
  const u = req.userId!;
  const p = findOr404(content.coding, String(req.params.id), "problem");
  const passed = Math.max(0, Math.min(p.tests.length, Number(req.body?.passed) | 0));
  const code = typeof req.body?.code === "string" ? req.body.code.slice(0, 20000) : "";
  const prior = db.prepare("SELECT attempts FROM coding_progress WHERE user_id = ? AND problem_id = ?").get(u, p.id) as { attempts: number } | undefined;
  db.prepare(`INSERT INTO coding_progress (user_id, problem_id, code_js, attempts, best_passed, total, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(user_id, problem_id) DO UPDATE SET code_js = excluded.code_js, attempts = attempts + 1, best_passed = MAX(best_passed, excluded.best_passed), total = excluded.total, updated_at = excluded.updated_at`)
    .run(u, p.id, code, passed, p.tests.length, Date.now());
  const all = passed === p.tests.length;
  const r = all ? markCodingSolved(u, p.id, !prior?.attempts) : { xp: 0, badges: [] };
  res.json({ passed, total: p.tests.length, solved: all, xp: r.xp, newBadges: nb(r.badges), solution: all || (prior?.attempts ?? 0) + 1 >= 4 ? p.solution : null });
});

/* ---------- behavioural ---------- */
type StoryRow = { id: number; title: string; themes: string; situation: string; task: string; action: string; result: string; best_score: number | null; updated_at: number };
const storyOut = (s: StoryRow) => ({ ...s, themes: JSON.parse(s.themes) as string[], best: s.best_score });
prep.get("/behavioral", (req, res) => {
  const stories = (db.prepare("SELECT * FROM stories WHERE user_id = ? ORDER BY updated_at DESC").all(req.userId) as StoryRow[]).map(storyOut);
  const links = db.prepare("SELECT question_id, story_id, best_score FROM story_links WHERE user_id = ?").all(req.userId) as { question_id: string; story_id: number; best_score: number | null }[];
  res.json({ ...content.behavioral, stories, links });
});
prep.post("/stories", (req, res) => {
  const b = req.body ?? {};
  const title = str(b.title, "title", 1, 120);
  const themes = Array.isArray(b.themes) ? b.themes.filter((t: unknown) => typeof t === "string").slice(0, 6) : [];
  const f = (k: string) => (typeof b[k] === "string" ? (b[k] as string).slice(0, 4000) : "");
  const now = Date.now();
  if (b.id) {
    const r = db.prepare("UPDATE stories SET title=?, themes=?, situation=?, task=?, action=?, result=?, updated_at=? WHERE id=? AND user_id=?")
      .run(title, JSON.stringify(themes), f("situation"), f("task"), f("action"), f("result"), now, Number(b.id), req.userId);
    if (!r.changes) throw new HttpError(404, "No such story");
    return res.json({ id: Number(b.id) });
  }
  const r = db.prepare("INSERT INTO stories (user_id, title, themes, situation, task, action, result, updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(req.userId, title, JSON.stringify(themes), f("situation"), f("task"), f("action"), f("result"), now);
  addXP(req.userId!, 10, "story");
  res.json({ id: Number(r.lastInsertRowid) });
});
prep.delete("/stories/:id", (req, res) => {
  db.prepare("DELETE FROM story_links WHERE user_id = ? AND story_id = ?").run(req.userId, Number(req.params.id));
  db.prepare("DELETE FROM stories WHERE user_id = ? AND id = ?").run(req.userId, Number(req.params.id));
  res.json({ ok: true });
});
prep.put("/behavioral/:qid/link", (req, res) => {
  findOr404(content.behavioral.questions, String(req.params.qid), "question");
  const sid = Number(req.body?.storyId);
  if (!sid) { db.prepare("DELETE FROM story_links WHERE user_id = ? AND question_id = ?").run(req.userId, req.params.qid); return res.json({ ok: true }); }
  if (!db.prepare("SELECT 1 FROM stories WHERE id = ? AND user_id = ?").get(sid, req.userId)) throw new HttpError(404, "No such story");
  db.prepare(`INSERT INTO story_links (user_id, question_id, story_id) VALUES (?, ?, ?)
    ON CONFLICT(user_id, question_id) DO UPDATE SET story_id = excluded.story_id, best_score = NULL`).run(req.userId, req.params.qid, sid);
  res.json({ ok: true });
});

/* ---------- MongoDB hands-on ---------- */
const clientEx = (e: MongoEx) => ({ id: e.id, title: e.title, level: e.level, topic: e.topic, kind: e.kind, collection: e.collection, prompt: e.prompt, hints: e.hints ?? [], options: e.options, orderMatters: e.orderMatters });
prep.get("/mongo", (req, res) => {
  const rows = db.prepare("SELECT ex_id, solved, attempts FROM mongo_progress WHERE user_id = ?").all(req.userId) as { ex_id: string; solved: number; attempts: number }[];
  res.json(content.mongo.map((e) => { const r = rows.find((x) => x.ex_id === e.id); return { ...clientEx(e), solved: !!r?.solved, attempts: r?.attempts ?? 0 }; }));
});
prep.get("/mongo/datasets", (_req, res) => res.json(content.datasets));
prep.get("/mongo/:id", (req, res) => {
  const e = findOr404(content.mongo, String(req.params.id), "exercise");
  const r = db.prepare("SELECT answer, solved, attempts FROM mongo_progress WHERE user_id = ? AND ex_id = ?").get(req.userId, e.id) as { answer: string; solved: number; attempts: number } | undefined;
  const reveal = !!r?.solved || (r?.attempts ?? 0) >= 3;
  res.json({ ...clientEx(e), answer: r?.answer ?? "", solved: !!r?.solved, attempts: r?.attempts ?? 0,
    expectedCount: e.expected?.length ?? null, solution: reveal ? e.solution ?? null : null, explanation: reveal ? e.explanation : null, correct: reveal && e.kind === "choice" ? e.answer : null });
});

/** Order-insensitive deep equality on result sets (unless the exercise says order matters). */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
export function sameResult(got: unknown[], want: unknown[], orderMatters: boolean) {
  if (!Array.isArray(got) || got.length !== want.length) return false;
  const a = got.map(canon), b = want.map(canon);
  if (!orderMatters) { a.sort(); b.sort(); }
  return a.every((x, i) => x === b[i]);
}
prep.post("/mongo/:id/check", (req, res) => {
  const u = req.userId!;
  const e = findOr404(content.mongo, String(req.params.id), "exercise");
  const answer = typeof req.body?.answer === "string" ? req.body.answer.slice(0, 8000) : "";
  let ok: boolean;
  if (e.kind === "choice") ok = Number(req.body?.choice) === e.answer;
  else ok = sameResult(req.body?.output as unknown[], e.expected ?? [], !!e.orderMatters);
  const prior = db.prepare("SELECT attempts, solved FROM mongo_progress WHERE user_id = ? AND ex_id = ?").get(u, e.id) as { attempts: number; solved: number } | undefined;
  db.prepare(`INSERT INTO mongo_progress (user_id, ex_id, attempts, solved, answer, solved_day, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(user_id, ex_id) DO UPDATE SET attempts = attempts + 1, solved = MAX(solved, excluded.solved), answer = excluded.answer,
      solved_day = COALESCE(solved_day, excluded.solved_day), updated_at = excluded.updated_at`)
    .run(u, e.id, ok ? 1 : 0, answer, ok ? localDay() : null, Date.now());
  let xp = 0, badges: string[] = [];
  if (ok && !prior?.solved) { xp = Math.round((XP[e.level] ?? 20) * (prior?.attempts ? 0.6 : 1)); badges = addXP(u, xp, `mongo:${e.id}`); }
  const attempts = (prior?.attempts ?? 0) + 1;
  const reveal = ok || attempts >= 3;
  res.json({ ok, xp, newBadges: nb(badges), attempts, expectedCount: e.expected?.length ?? null,
    solution: reveal ? e.solution ?? null : null, explanation: reveal ? e.explanation : null, correct: reveal && e.kind === "choice" ? e.answer : null });
});

/* ---------- companies ---------- */
{
  const cols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("target_companies")) db.exec("ALTER TABLE users ADD COLUMN target_companies TEXT");
}
prep.get("/companies", (_req, res) => res.json(content.companies.map((c) => ({ id: c.id, name: c.name, summary: c.summary,
  counts: { design: content.design.filter((d) => d.company === c.id).length, coding: content.coding.filter((d) => d.company === c.id).length,
    behavioral: content.behavioral.questions.filter((d) => d.company === c.id).length, mongo: c.id === "mongodb" ? content.mongo.length : 0 } }))));
prep.get("/companies/:id", (req, res) => {
  const c = content.companies.find((x) => x.id === req.params.id);
  if (!c) throw new HttpError(404, "No such company");
  res.json({ ...c,
    design: content.design.filter((d) => d.company === c.id).map((d) => ({ id: d.id, title: d.title, level: d.level })),
    coding: content.coding.filter((d) => d.company === c.id).map((d) => ({ id: d.id, title: d.title, level: d.level, topic: d.topic })),
    behavioral: content.behavioral.questions.filter((d) => d.company === c.id).map((d) => ({ id: d.id, text: d.text, value: d.value ?? null })),
  });
});
prep.get("/me/companies", (req, res) => {
  const r = db.prepare("SELECT target_companies t FROM users WHERE id = ?").get(req.userId) as { t: string | null };
  res.json({ targets: r.t ? JSON.parse(r.t) : [] });
});
prep.put("/me/companies", (req, res) => {
  const ids = Array.isArray(req.body?.targets) ? (req.body.targets as unknown[]).filter((x): x is string => typeof x === "string" && content.companies.some((c) => c.id === x)) : [];
  db.prepare("UPDATE users SET target_companies = ? WHERE id = ?").run(JSON.stringify([...new Set(ids)]), req.userId);
  res.json({ targets: ids });
});

/* ---------- practical rounds: bug squash (multi-file) + integration (fake API) ---------- */
export type PFile = { path: string; code: string };
export type Practical = {
  id: string; kind: "bugsquash" | "integration"; title: string; level: string; company?: string; brief: string;
  files?: PFile[]; bugs?: number; fixedFiles?: PFile[]; explanation?: string;
  docs?: string; fakeApi?: string; fn?: string; starter?: string; solution?: string; keyPoints?: string[];
  tests: { name: string; call: string; expected: unknown }[]; hints: string[];
};
export const practical: Practical[] = [];
export function loadPractical() {
  practical.length = 0;
  for (const c of fs.existsSync(path.join(C, "companies")) ? fs.readdirSync(path.join(C, "companies")) : []) {
    practical.push(...load<Practical[]>(`companies/${c}/bugsquash.json`, []).map((x) => ({ ...x, kind: "bugsquash" as const, company: c })));
    practical.push(...load<Practical[]>(`companies/${c}/integration.json`, []).map((x) => ({ ...x, kind: "integration" as const, company: c })));
  }
}
db.exec(`CREATE TABLE IF NOT EXISTS practical_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, item_id TEXT NOT NULL,
  work TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0, best_passed INTEGER NOT NULL DEFAULT 0,
  solved INTEGER NOT NULL DEFAULT 0, solved_day TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, item_id))`);

prep.get("/practical", (req, res) => {
  const rows = db.prepare("SELECT item_id, attempts, best_passed, solved FROM practical_progress WHERE user_id = ?").all(req.userId) as { item_id: string; attempts: number; best_passed: number; solved: number }[];
  res.json(practical.map((p) => { const r = rows.find((x) => x.item_id === p.id); return { id: p.id, kind: p.kind, title: p.title, level: p.level, company: p.company, total: p.tests.length, attempts: r?.attempts ?? 0, bestPassed: r?.best_passed ?? 0, solved: !!r?.solved }; }));
});
prep.get("/practical/:id", (req, res) => {
  const p = findOr404(practical, String(req.params.id), "exercise");
  const r = db.prepare("SELECT work, attempts, solved FROM practical_progress WHERE user_id = ? AND item_id = ?").get(req.userId, p.id) as { work: string; attempts: number; solved: number } | undefined;
  const reveal = !!r?.solved || (r?.attempts ?? 0) >= 4;
  let work: unknown = null; try { work = r?.work ? JSON.parse(r.work) : null; } catch { /* ignore */ }
  res.json({
    id: p.id, kind: p.kind, title: p.title, level: p.level, company: p.company, brief: p.brief, hints: p.hints, tests: p.tests,
    files: p.files, bugs: p.bugs, docs: p.docs, fakeApi: p.fakeApi, fn: p.fn, starter: p.starter,
    work, attempts: r?.attempts ?? 0, solved: !!r?.solved,
    reveal: reveal ? { fixedFiles: p.fixedFiles ?? null, solution: p.solution ?? null, explanation: p.explanation ?? null, keyPoints: p.keyPoints ?? null } : null,
  });
});
prep.put("/practical/:id/work", (req, res) => {
  const p = findOr404(practical, String(req.params.id), "exercise");
  const work = JSON.stringify(req.body?.work ?? null).slice(0, 60000);
  db.prepare(`INSERT INTO practical_progress (user_id, item_id, work, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, item_id) DO UPDATE SET work = excluded.work, updated_at = excluded.updated_at`).run(req.userId, p.id, work, Date.now());
  res.json({ ok: true });
});
prep.post("/practical/:id/result", (req, res) => {
  const u = req.userId!;
  const p = findOr404(practical, String(req.params.id), "exercise");
  const passed = Math.max(0, Math.min(p.tests.length, Number(req.body?.passed) | 0));
  const work = JSON.stringify(req.body?.work ?? null).slice(0, 60000);
  const prior = db.prepare("SELECT attempts, solved FROM practical_progress WHERE user_id = ? AND item_id = ?").get(u, p.id) as { attempts: number; solved: number } | undefined;
  const all = passed === p.tests.length;
  db.prepare(`INSERT INTO practical_progress (user_id, item_id, work, attempts, best_passed, solved, solved_day, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(user_id, item_id) DO UPDATE SET work = excluded.work, attempts = attempts + 1, best_passed = MAX(best_passed, excluded.best_passed),
      solved = MAX(solved, excluded.solved), solved_day = COALESCE(solved_day, excluded.solved_day), updated_at = excluded.updated_at`)
    .run(u, p.id, work, passed, all ? 1 : 0, all ? localDay() : null, Date.now());
  let xp = 0, badges: string[] = [];
  if (all && !prior?.solved) { xp = Math.round((XP[p.level] ?? 30) * (prior?.attempts ? 0.6 : 1) * 1.5); badges = addXP(u, xp, `practical:${p.id}`); }
  const attempts = (prior?.attempts ?? 0) + 1;
  res.json({ passed, total: p.tests.length, solved: all, xp, newBadges: nb(badges),
    reveal: all || attempts >= 4 ? { fixedFiles: p.fixedFiles ?? null, solution: p.solution ?? null, explanation: p.explanation ?? null, keyPoints: p.keyPoints ?? null } : null });
});
