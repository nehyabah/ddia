import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { ROOT, db } from "../db.js";
import { HttpError, str } from "../http.js";
import { BADGES, addXP, localDay, masteryByChapter } from "../progress.js";
import { onGraded, registerReference } from "./ai.js";
import { content } from "./prep.js";
import { computeReadiness } from "./readiness.js";

/* ============================================================
   Six-month roadmap, application tracker, project deep dive,
   "why us" practice, and estimation drills.
   ============================================================ */

const DAY = 86400000, WEEK = 7 * DAY;
const nb = (b: string[]) => b.map((id) => ({ id, label: BADGES[id] ?? id }));
const C = path.join(ROOT, "server", "content");
const load = <T,>(f: string, d: T): T => { try { return JSON.parse(fs.readFileSync(path.join(C, f), "utf8")) as T; } catch { return d; } };

type DDSection = { key: string; title: string; prompt: string; tips: string[]; keyPoints: string[] };
type DeepDive = { sections: DDSection[]; probes: { id: string; q: string; section: string; why: string }[];
  companies: Record<string, { why: { prompt: string; keyPoints: string[] }; askThem: { group: string; q: string }[] }> };
type Drill = { id: string; title: string; level: string; topic: string; company?: string; prompt: string; unit: string; answer: number; tolerance: number; steps: string[]; assumptions: string[]; takeaway: string };
type Estimation = { reference: { group: string; items: [string, string][] }[]; drills: Drill[] };

let deep: DeepDive = { sections: [], probes: [], companies: {} };
let est: Estimation = { reference: [], drills: [] };
export function loadCareer() {
  deep = load<DeepDive>("deepdive.json", deep);
  est = load<Estimation>("estimation.json", est);
  console.log(`[career] deep-dive ${deep.sections.length} sections/${deep.probes.length} probes, estimation ${est.drills.length}`);
}

db.exec(`
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company TEXT NOT NULL, role TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL DEFAULT 'interested',
  referral TEXT NOT NULL DEFAULT '', recruiter TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS app_rounds (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, at TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', reflection TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS project_doc (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, section TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '', best_score INTEGER, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, section)
);
CREATE TABLE IF NOT EXISTS est_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, drill_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, solved INTEGER NOT NULL DEFAULT 0, last_answer REAL, solved_day TEXT, updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, drill_id)
);
`);
{
  const cols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("prep_start")) db.exec("ALTER TABLE users ADD COLUMN prep_start TEXT");
}

export const career = Router();

/* ---------------- AI references for the new written answers ---------------- */
registerReference("project", (id) => {
  const s = deep.sections.find((x) => x.key === id);
  if (!s) throw new HttpError(404, "No such section");
  return {
    question: `Project deep-dive interview, section "${s.title}": ${s.prompt}\nThe candidate is describing their OWN past project. Judge clarity, ownership ("I" not "we"), technical depth and concreteness for a senior role. Do not penalise unfamiliar project details.`,
    reference: `A strong senior answer covers:\n${s.keyPoints.map((k) => `- ${k}`).join("\n")}\nFor the model answer, restructure THEIR content better; do not invent a different project.`,
  };
});
registerReference("probe", (id) => {
  const p = deep.probes.find((x) => x.id === id);
  if (!p) throw new HttpError(404, "No such question");
  const s = deep.sections.find((x) => x.key === p.section);
  return {
    question: `Project deep-dive probing question: "${p.q}" (tests: ${p.why}). The candidate answers about their own project.`,
    reference: `Strong answers show:\n${(s?.keyPoints ?? []).map((k) => `- ${k}`).join("\n")}\nJudge directness, ownership and specifics; do not invent project facts.`,
  };
});
registerReference("why", (id) => {
  const c = deep.companies[id];
  if (!c) throw new HttpError(404, "No such company");
  return {
    question: `${c.why.prompt} (senior engineering candidate). Judge specificity: generic flattery scores low; concrete product/engineering reasons tied to the candidate's own experience score high.`,
    reference: `A strong answer touches:\n${c.why.keyPoints.map((k) => `- ${k}`).join("\n")}`,
  };
});
onGraded("project", (u, id, score) => {
  db.prepare(`INSERT INTO project_doc (user_id, section, best_score, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, section) DO UPDATE SET best_score = MAX(COALESCE(best_score, 0), excluded.best_score), updated_at = excluded.updated_at`).run(u, id, score, Date.now());
});

/* ---------------- project deep dive ---------------- */
career.get("/deepdive", (req, res) => {
  const rows = db.prepare("SELECT section, text, best_score FROM project_doc WHERE user_id = ?").all(req.userId) as { section: string; text: string; best_score: number | null }[];
  const probes = new Map((db.prepare("SELECT ref_id, MAX(score) s FROM ai_grades WHERE user_id = ? AND kind = 'probe' GROUP BY ref_id").all(req.userId) as { ref_id: string; s: number }[]).map((r) => [r.ref_id, r.s]));
  res.json({
    sections: deep.sections.map((s) => { const r = rows.find((x) => x.section === s.key); return { ...s, text: r?.text ?? "", best: r?.best_score ?? null }; }),
    probes: deep.probes.map((p) => ({ ...p, best: probes.get(p.id) ?? null })),
  });
});
career.put("/deepdive/:section", (req, res) => {
  const key = String(req.params.section);
  if (!deep.sections.some((s) => s.key === key)) throw new HttpError(404, "No such section");
  const text = typeof req.body?.text === "string" ? req.body.text.slice(0, 8000) : "";
  db.prepare(`INSERT INTO project_doc (user_id, section, text, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, section) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`).run(req.userId, key, text, Date.now());
  res.json({ ok: true });
});

/* ---------------- why us + questions to ask ---------------- */
career.get("/whyus", (req, res) => {
  const best = new Map((db.prepare("SELECT ref_id, MAX(score) s FROM ai_grades WHERE user_id = ? AND kind = 'why' GROUP BY ref_id").all(req.userId) as { ref_id: string; s: number }[]).map((r) => [r.ref_id, r.s]));
  res.json(Object.entries(deep.companies).map(([id, c]) => ({ id, name: content.companies.find((x) => x.id === id)?.name ?? id, prompt: c.why.prompt, askThem: c.askThem, best: best.get(id) ?? null })));
});

/* ---------------- estimation drills ---------------- */
career.get("/estimation", (req, res) => {
  const rows = new Map((db.prepare("SELECT drill_id, attempts, solved FROM est_progress WHERE user_id = ?").all(req.userId) as { drill_id: string; attempts: number; solved: number }[]).map((r) => [r.drill_id, r]));
  res.json({ reference: est.reference, drills: est.drills.map((d) => ({ id: d.id, title: d.title, level: d.level, topic: d.topic, company: d.company ?? null, solved: !!rows.get(d.id)?.solved, attempts: rows.get(d.id)?.attempts ?? 0 })) });
});
career.get("/estimation/:id", (req, res) => {
  const d = est.drills.find((x) => x.id === req.params.id);
  if (!d) throw new HttpError(404, "No such drill");
  const r = db.prepare("SELECT attempts, solved, last_answer FROM est_progress WHERE user_id = ? AND drill_id = ?").get(req.userId, d.id) as { attempts: number; solved: number; last_answer: number | null } | undefined;
  const reveal = !!r?.solved || (r?.attempts ?? 0) >= 2;
  res.json({ id: d.id, title: d.title, level: d.level, topic: d.topic, prompt: d.prompt, unit: d.unit, tolerance: d.tolerance, attempts: r?.attempts ?? 0, solved: !!r?.solved, last: r?.last_answer ?? null,
    reveal: reveal ? { answer: d.answer, steps: d.steps, assumptions: d.assumptions, takeaway: d.takeaway } : null });
});
career.post("/estimation/:id", (req, res) => {
  const u = req.userId!;
  const d = est.drills.find((x) => x.id === req.params.id);
  if (!d) throw new HttpError(404, "No such drill");
  const v = Number(req.body?.value);
  if (!(v > 0) || !Number.isFinite(v)) throw new HttpError(400, "Enter a positive number");
  const ratio = Math.max(v / d.answer, d.answer / v);
  const ok = ratio <= d.tolerance;
  const prior = db.prepare("SELECT attempts, solved FROM est_progress WHERE user_id = ? AND drill_id = ?").get(u, d.id) as { attempts: number; solved: number } | undefined;
  db.prepare(`INSERT INTO est_progress (user_id, drill_id, attempts, solved, last_answer, solved_day, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(user_id, drill_id) DO UPDATE SET attempts = attempts + 1, solved = MAX(solved, excluded.solved), last_answer = excluded.last_answer,
      solved_day = COALESCE(solved_day, excluded.solved_day), updated_at = excluded.updated_at`).run(u, d.id, ok ? 1 : 0, v, ok ? localDay() : null, Date.now());
  let xp = 0, badges: string[] = [];
  if (ok && !prior?.solved) { xp = prior?.attempts ? 8 : 15; badges = addXP(u, xp, `estimation:${d.id}`); }
  const attempts = (prior?.attempts ?? 0) + 1;
  const off = v > d.answer ? "high" : "low";
  res.json({ ok, ratio: Math.round(ratio * 10) / 10, off, xp, newBadges: nb(badges), attempts,
    reveal: ok || attempts >= 2 ? { answer: d.answer, steps: d.steps, assumptions: d.assumptions, takeaway: d.takeaway } : null });
});

/* ---------------- application tracker ---------------- */
export const STAGES = ["interested", "applied", "recruiter", "screen", "onsite", "offer", "rejected", "withdrawn"] as const;
type AppRow = { id: number; company: string; role: string; url: string; stage: string; referral: string; recruiter: string; notes: string; created_at: number; updated_at: number };
type RoundRow = { id: number; app_id: number; kind: string; at: string; notes: string; reflection: string; outcome: string };

/** The next scheduled interview round (date string YYYY-MM-DD) and its company, if any. */
export function nextInterview(u: number): { at: string; company: string; kind: string; appId: number } | null {
  const r = db.prepare(`SELECT r.at, r.kind, a.company, a.id appId FROM app_rounds r JOIN applications a ON a.id = r.app_id
    WHERE r.user_id = ? AND r.at >= ? AND a.stage NOT IN ('rejected','withdrawn','offer') ORDER BY r.at LIMIT 1`).get(u, localDay()) as { at: string; kind: string; company: string; appId: number } | undefined;
  return r ?? null;
}

career.get("/applications", (req, res) => {
  const apps = db.prepare("SELECT * FROM applications WHERE user_id = ? ORDER BY updated_at DESC").all(req.userId) as AppRow[];
  const rounds = db.prepare("SELECT * FROM app_rounds WHERE user_id = ? ORDER BY at").all(req.userId) as RoundRow[];
  res.json({ stages: STAGES, next: nextInterview(req.userId!), apps: apps.map((a) => ({ ...a, rounds: rounds.filter((r) => r.app_id === a.id) })) });
});
career.post("/applications", (req, res) => {
  const b = req.body ?? {};
  const company = str(b.company, "company", 1, 60);
  const stage = STAGES.includes(b.stage) ? b.stage : "interested";
  const f = (k: string, n = 500) => (typeof b[k] === "string" ? (b[k] as string).slice(0, n) : "");
  const now = Date.now();
  if (b.id) {
    const r = db.prepare("UPDATE applications SET company=?, role=?, url=?, stage=?, referral=?, recruiter=?, notes=?, updated_at=? WHERE id=? AND user_id=?")
      .run(company, f("role", 120), f("url", 400), stage, f("referral", 120), f("recruiter", 120), f("notes", 4000), now, Number(b.id), req.userId);
    if (!r.changes) throw new HttpError(404, "No such application");
    return res.json({ id: Number(b.id) });
  }
  const r = db.prepare("INSERT INTO applications (user_id, company, role, url, stage, referral, recruiter, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(req.userId, company, f("role", 120), f("url", 400), stage, f("referral", 120), f("recruiter", 120), f("notes", 4000), now, now);
  res.json({ id: Number(r.lastInsertRowid) });
});
career.delete("/applications/:id", (req, res) => {
  db.prepare("DELETE FROM app_rounds WHERE app_id = ? AND user_id = ?").run(Number(req.params.id), req.userId);
  db.prepare("DELETE FROM applications WHERE id = ? AND user_id = ?").run(Number(req.params.id), req.userId);
  res.json({ ok: true });
});
career.post("/applications/:id/rounds", (req, res) => {
  const a = db.prepare("SELECT id FROM applications WHERE id = ? AND user_id = ?").get(Number(req.params.id), req.userId);
  if (!a) throw new HttpError(404, "No such application");
  const b = req.body ?? {};
  const at = String(b.at ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(at)) throw new HttpError(400, "Date must be YYYY-MM-DD");
  const f = (k: string) => (typeof b[k] === "string" ? (b[k] as string).slice(0, 4000) : "");
  const outcome = ["pending", "passed", "failed"].includes(b.outcome) ? b.outcome : "pending";
  if (b.roundId) db.prepare("UPDATE app_rounds SET kind=?, at=?, notes=?, reflection=?, outcome=? WHERE id=? AND user_id=?").run(str(b.kind, "kind", 1, 60), at, f("notes"), f("reflection"), outcome, Number(b.roundId), req.userId);
  else db.prepare("INSERT INTO app_rounds (user_id, app_id, kind, at, notes, reflection, outcome) VALUES (?,?,?,?,?,?,?)").run(req.userId, Number(req.params.id), str(b.kind, "kind", 1, 60), at, f("notes"), f("reflection"), outcome);
  db.prepare("UPDATE applications SET updated_at = ? WHERE id = ?").run(Date.now(), Number(req.params.id));
  res.json({ ok: true });
});
career.delete("/rounds/:id", (req, res) => {
  db.prepare("DELETE FROM app_rounds WHERE id = ? AND user_id = ?").run(Number(req.params.id), req.userId);
  res.json({ ok: true });
});

/* ---------------- six-month roadmap ---------------- */
type Check = { label: string; have: number; need: number; to: string };
type Month = { n: number; phase: string; title: string; target: number; focus: string[]; checks: Check[] };

function metrics(u: number) {
  const m = masteryByChapter(u);
  const chOk = (ids: number[]) => ids.filter((id) => (m.get(id) ?? 0) >= 80).length;
  const one = (sql: string, ...p: (string | number)[]) => ((db.prepare(sql).get(u, ...p) as { n: number } | undefined)?.n ?? 0);
  const safe = (f: () => number) => { try { return f(); } catch { return 0; } };
  return {
    chOk,
    coding: safe(() => one("SELECT COUNT(*) n FROM coding_progress WHERE user_id = ? AND solved = 1")),
    concurrencyCode: safe(() => one("SELECT COUNT(*) n FROM coding_progress WHERE user_id = ? AND solved = 1 AND problem_id LIKE 'conc-code-%'")),
    designPrompts: safe(() => one(`SELECT COUNT(*) n FROM (SELECT prompt_id FROM design_progress WHERE user_id = ? GROUP BY prompt_id HAVING SUM(best_score >= 7) >= 5)`)),
    designSections: safe(() => one("SELECT COUNT(*) n FROM design_progress WHERE user_id = ? AND best_score >= 7")),
    practical: safe(() => one("SELECT COUNT(*) n FROM practical_progress WHERE user_id = ? AND solved = 1")),
    mongo: safe(() => one("SELECT COUNT(*) n FROM mongo_progress WHERE user_id = ? AND solved = 1")),
    puzzles: safe(() => one("SELECT COUNT(*) n FROM puzzle_progress WHERE user_id = ? AND solved = 1")),
    java: safe(() => one("SELECT COUNT(DISTINCT challenge_id) n FROM java_attempts WHERE user_id = ? AND correct = 1")),
    stories: safe(() => one("SELECT COUNT(*) n FROM stories WHERE user_id = ? AND best_score >= 7")),
    deepdive: safe(() => one("SELECT COUNT(*) n FROM project_doc WHERE user_id = ? AND best_score >= 7")),
    why: safe(() => one("SELECT COUNT(DISTINCT ref_id) n FROM ai_grades WHERE user_id = ? AND kind = 'why' AND score >= 7")),
    estimation: safe(() => one("SELECT COUNT(*) n FROM est_progress WHERE user_id = ? AND solved = 1")),
    mocks: safe(() => one("SELECT COUNT(*) n FROM mock_sessions WHERE user_id = ? AND finished_at IS NOT NULL")),
    goodMocks: safe(() => one("SELECT COUNT(*) n FROM mock_sessions WHERE user_id = ? AND finished_at IS NOT NULL AND total >= 70")),
    apps: safe(() => one("SELECT COUNT(*) n FROM applications WHERE user_id = ? AND stage NOT IN ('interested')")),
  };
}

function months(u: number): Month[] {
  const x = metrics(u);
  const c = (label: string, have: number, need: number, to: string): Check => ({ label, have: Math.min(have, need), need, to });
  return [
    { n: 1, phase: "Foundations", title: "Build the base", target: 15, focus: ["DDIA chapters 1-3", "Networking basics", "Easy/medium coding patterns"],
      checks: [c("DDIA Ch 1-3 at 80%", x.chOk([1, 2, 3]), 3, "/#chapters"), c("Networking I at 80%", x.chOk([19]), 1, "/#chapters"), c("Coding problems solved", x.coding, 10, "/coding"), c("Estimation drills", x.estimation, 5, "/estimation")] },
    { n: 2, phase: "Foundations", title: "Storage, replication & OS", target: 30, focus: ["DDIA chapters 4-6", "OS fundamentals", "Concurrency puzzles"],
      checks: [c("DDIA Ch 4-6 at 80%", x.chOk([4, 5, 6]), 3, "/#chapters"), c("Networking II & OS I-II at 80%", x.chOk([20, 21, 22]), 3, "/#chapters"), c("Coding problems solved", x.coding, 25, "/coding"), c("Systems puzzles solved", x.puzzles, 15, "/puzzles"), c("Estimation drills", x.estimation, 12, "/estimation")] },
    { n: 3, phase: "Depth", title: "Distributed systems & design", target: 45, focus: ["DDIA chapters 7-9", "System design", "MongoDB track"],
      checks: [c("DDIA Ch 7-9 at 80%", x.chOk([7, 8, 9]), 3, "/#chapters"), c("MongoDB DB-DB2 at 80%", x.chOk([13, 14]), 2, "/#chapters"), c("Design prompts passed (5+ sections)", x.designPrompts, 4, "/design"), c("Coding problems solved", x.coding, 38, "/coding"), c("Estimation drills", x.estimation, 20, "/estimation")] },
    { n: 4, phase: "Depth", title: "Practical rounds & concurrency", target: 60, focus: ["DDIA chapters 10-12", "Concurrency coding", "Stripe practical rounds"],
      checks: [c("DDIA Ch 10-12 at 80%", x.chOk([10, 11, 12]), 3, "/#chapters"), c("MongoDB DB3-DB6 at 80%", x.chOk([15, 16, 17, 18]), 4, "/#chapters"), c("Concurrency code reviewed ≥7", x.concurrencyCode, 5, "/coding"), c("Practical rounds solved", x.practical, 6, "/practical"), c("Design prompts passed", x.designPrompts, 8, "/design")] },
    { n: 5, phase: "Interview mode", title: "Stories, deep dive & mocks", target: 72, focus: ["Behavioural stories", "Project deep dive", "Weekly mocks"],
      checks: [c("STAR stories scoring ≥7", x.stories, 8, "/behavioral"), c("Deep-dive sections ≥7", x.deepdive, 8, "/deepdive"), c("Mock interviews", x.mocks, 4, "/mock"), c("'Why us' answers ≥7", x.why, 3, "/whyus"), c("Applications sent", x.apps, 3, "/applications")] },
    { n: 6, phase: "Interview mode", title: "Peak & apply", target: 82, focus: ["Company-specific prep", "Mocks twice a week", "Interviews"],
      checks: [c("Mocks scoring 70+", x.goodMocks, 6, "/mock"), c("Coding problems solved", x.coding, 60, "/coding"), c("MongoDB lab solved", x.mongo, 20, "/mongo"), c("Design prompts passed", x.designPrompts, 12, "/design"), c("Applications sent", x.apps, 6, "/applications")] },
  ];
}

export function roadmap(u: number) {
  const user = db.prepare("SELECT prep_start, interview_date FROM users WHERE id = ?").get(u) as { prep_start: string | null; interview_date: string | null };
  let start = user.prep_start;
  if (!start) {
    const first = (db.prepare("SELECT MIN(day) d FROM xp_events WHERE user_id = ?").get(u) as { d: string | null }).d;
    start = first ?? localDay();
    db.prepare("UPDATE users SET prep_start = ? WHERE id = ?").run(start, u);
  }
  const startMs = new Date(start + "T00:00:00").getTime();
  // Only the interview date you set reshapes the roadmap; an early screen in the tracker should not squeeze six months into one.
  const target = user.interview_date ?? null;
  const endMs = target ? Math.max(new Date(target + "T00:00:00").getTime(), startMs + 4 * WEEK) : startMs + 26 * WEEK;
  const totalWeeks = Math.round((endMs - startMs) / WEEK);
  const elapsed = Math.max(0, Date.now() - startMs);
  const frac = Math.min(1, elapsed / (endMs - startMs));
  const ms = months(u);
  const curIdx = Math.min(ms.length - 1, Math.floor(frac * ms.length));
  const r = computeReadiness(u);
  // Pro-rate the target within the current month for an honest on-track check.
  const prevTarget = curIdx ? ms[curIdx - 1].target : 0;
  const within = frac * ms.length - curIdx;
  const expectedNow = Math.round(prevTarget + (ms[curIdx].target - prevTarget) * within);
  const gap = r.overall - expectedNow;
  const status = gap >= 0 ? "ahead" : gap >= -8 ? "on track" : gap >= -18 ? "slightly behind" : "behind";
  const monthMs = (endMs - startMs) / ms.length;
  return {
    start, end: localDay(endMs), totalWeeks, week: Math.min(totalWeeks, Math.floor(elapsed / WEEK) + 1), progress: Math.round(frac * 100),
    fromTracker: false, readiness: r.overall, expectedNow, status, gap,
    current: curIdx,
    months: ms.map((m, i) => {
      const done = m.checks.filter((c) => c.have >= c.need).length;
      return { ...m, from: localDay(startMs + i * monthMs), to: localDay(startMs + (i + 1) * monthMs - DAY), done, total: m.checks.length, state: i < curIdx ? "past" : i === curIdx ? "now" : "next" };
    }),
  };
}
career.get("/roadmap", (req, res) => res.json(roadmap(req.userId!)));
career.put("/roadmap/start", (req, res) => {
  const d = String(req.body?.start ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpError(400, "Date must be YYYY-MM-DD");
  db.prepare("UPDATE users SET prep_start = ? WHERE id = ?").run(d, req.userId);
  res.json(roadmap(req.userId!));
});
