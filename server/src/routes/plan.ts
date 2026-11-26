import { Router } from "express";
import { db } from "../db.js";
import { HttpError } from "../http.js";
import { addXP, dueCount, localDay } from "../progress.js";
import { javaDueCount } from "./java.js";
import { computeReadiness } from "./readiness.js";
import { content } from "./prep.js";
import { getPuzzle } from "./puzzles.js";

/* ============================================================
   Interview date, daily plan, readiness history, mock interviews.
   ============================================================ */

const cols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name);
if (!cols.includes("interview_date")) db.exec("ALTER TABLE users ADD COLUMN interview_date TEXT");
if (!cols.includes("reminder_hour")) db.exec("ALTER TABLE users ADD COLUMN reminder_hour INTEGER NOT NULL DEFAULT 19");
db.exec(`
CREATE TABLE IF NOT EXISTS readiness_snapshots (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL, overall INTEGER NOT NULL, areas TEXT NOT NULL,
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS mock_sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, finished_at INTEGER,
  items TEXT NOT NULL, scores TEXT, total INTEGER
);
`);

export const plan = Router();
const DAY = 86400000;

/** Save today's readiness so the trend has one point per day (latest value wins). */
export function snapshot(u: number) {
  const r = computeReadiness(u);
  db.prepare(`INSERT INTO readiness_snapshots (user_id, day, overall, areas) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, day) DO UPDATE SET overall = excluded.overall, areas = excluded.areas`)
    .run(u, localDay(), r.overall, JSON.stringify(Object.fromEntries(r.areas.map((a) => [a.id, a.score]))));
  return r;
}

plan.get("/readiness/history", (req, res) => {
  snapshot(req.userId!);
  const rows = db.prepare("SELECT day, overall, areas FROM readiness_snapshots WHERE user_id = ? ORDER BY day DESC LIMIT 90").all(req.userId) as { day: string; overall: number; areas: string }[];
  res.json(rows.reverse().map((r) => ({ day: r.day, overall: r.overall, areas: JSON.parse(r.areas) as Record<string, number> })));
});

/* ---------- interview date ---------- */
plan.get("/me/interview", (req, res) => {
  const r = db.prepare("SELECT interview_date, reminder_hour FROM users WHERE id = ?").get(req.userId) as { interview_date: string | null; reminder_hour: number };
  res.json({ date: r.interview_date, reminderHour: r.reminder_hour });
});
plan.put("/me/interview", (req, res) => {
  const date = req.body?.date ? String(req.body.date) : null;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "Date must be YYYY-MM-DD");
  const hour = req.body?.reminderHour == null ? null : Number(req.body.reminderHour);
  if (hour != null && !(hour >= 0 && hour <= 23)) throw new HttpError(400, "Reminder hour must be 0-23");
  db.prepare("UPDATE users SET interview_date = ? WHERE id = ?").run(date, req.userId);
  if (hour != null) db.prepare("UPDATE users SET reminder_hour = ? WHERE id = ?").run(hour, req.userId);
  res.json({ ok: true });
});

/* ---------- daily plan ---------- */
type Task = { id: string; label: string; detail: string; to: string; done: boolean; progress: number; target: number };

function todayCounts(u: number) {
  const day = localDay();
  const one = (sql: string, ...p: (string | number)[]) => ((db.prepare(sql).get(u, ...p) as { n: number } | undefined)?.n ?? 0);
  return {
    reviews: one("SELECT COUNT(*) n FROM attempts WHERE user_id = ? AND day = ? AND mode = 'review'", day),
    quiz: (chs: number[]) => chs.length ? one(`SELECT COUNT(*) n FROM attempts a JOIN questions q ON q.id = a.question_id WHERE a.user_id = ? AND a.day = ? AND q.chapter_id IN (${chs.map(Number).join(",")})`, day) : 0,
    java: one("SELECT COUNT(*) n FROM java_attempts WHERE user_id = ? AND day = ?", day),
    puzzles: (track?: string) => one(`SELECT COUNT(*) n FROM puzzle_progress pp JOIN puzzles p ON p.id = pp.puzzle_id WHERE pp.user_id = ? AND pp.solved_day = ?${track ? " AND p.track = ?" : ""}`, ...(track ? [day, track] : [day])),
    design: one("SELECT COUNT(*) n FROM ai_grades WHERE user_id = ? AND day = ? AND kind = 'design'", day),
    coding: one("SELECT COUNT(*) n FROM coding_progress WHERE user_id = ? AND solved_day = ?", day),
    story: one("SELECT COUNT(*) n FROM ai_grades WHERE user_id = ? AND day = ? AND kind = 'story'", day),
    mongo: one("SELECT COUNT(*) n FROM mongo_progress WHERE user_id = ? AND solved_day = ?", day),
    mock: one("SELECT COUNT(*) n FROM mock_sessions WHERE user_id = ? AND finished_at >= ?", new Date(day + "T00:00:00").getTime()),
  };
}

const AREA_CHAPTERS: Record<string, number[]> = {
  consistency: [7, 9, 17], replication: [5, 14], sharding: [6, 15], distributed: [8, 10, 11, 12], storage: [3, 16], modeling: [1, 2, 4, 18], mongodb: [13],
};
const AREA_TRACK: Record<string, string> = { concurrency: "concurrency", resilience: "resilience" };

export function buildPlan(u: number) {
  const user = db.prepare("SELECT interview_date FROM users WHERE id = ?").get(u) as { interview_date: string | null };
  const r = snapshot(u);
  const t = todayCounts(u);
  const daysLeft = user.interview_date ? Math.ceil((new Date(user.interview_date + "T09:00:00").getTime() - Date.now()) / DAY) : null;
  const intensity = daysLeft == null ? "steady" : daysLeft <= 7 ? "final" : daysLeft <= 21 ? "push" : "steady";
  const tasks: Task[] = [];
  const add = (id: string, label: string, detail: string, to: string, progress: number, target: number) =>
    tasks.push({ id, label, detail, to, progress: Math.min(progress, target), target, done: progress >= target });

  const due = dueCount(u), jdue = javaDueCount(u);
  if (due > 0 || t.reviews > 0) add("review", "Clear your reviews", `${due} due now`, "/review", t.reviews, Math.max(1, Math.min(20, t.reviews + due)));
  if (jdue > 0) add("java-review", "Fix Java bugs you missed", `${jdue} due`, "/java/play?mode=review", t.java, Math.min(5, jdue));

  const nFocus = intensity === "final" ? 2 : 3;
  for (const f of r.focus.slice(0, nFocus)) {
    const a = r.areas.find((x) => x.id === f.id);
    if (f.id === "design") add("design", "System design practice", `${f.label} · ${f.score}/100`, "/design", t.design, intensity === "steady" ? 1 : 2);
    else if (f.id === "coding") add("coding", "Solve a coding problem", `${f.label} · ${f.score}/100`, "/coding", t.coding, 1);
    else if (f.id === "behavioral") add("behavioral", "Review a behavioural story", `${f.label} · ${f.score}/100`, "/behavioral", t.story, 1);
    else if (f.id === "java") add("java", "Fix Java bugs", `${f.label} · ${f.score}/100`, "/java/play", t.java, 5);
    else if (f.id === "mongodb" && content.mongo.length) add("mongo", "Hands-on MongoDB queries", `${f.label} · ${f.score}/100`, "/mongo", t.mongo, 2);
    else if (AREA_TRACK[f.id]) add(`pz-${f.id}`, `Solve ${f.label.toLowerCase()} puzzles`, `${f.score}/100`, `/puzzles/play?track=${AREA_TRACK[f.id]}`, t.puzzles(AREA_TRACK[f.id]), 2);
    else if (AREA_CHAPTERS[f.id]) add(`quiz-${f.id}`, `Study ${f.label.toLowerCase()}`, `${f.score}/100 · ${a?.action.label ?? "Quiz"}`, a?.action.to ?? `/chapter/${AREA_CHAPTERS[f.id][0]}`, t.quiz(AREA_CHAPTERS[f.id]), 10);
  }
  const lastMock = (db.prepare("SELECT MAX(finished_at) t FROM mock_sessions WHERE user_id = ?").get(u) as { t: number | null }).t;
  const mockEvery = intensity === "final" ? 2 : intensity === "push" ? 4 : 7;
  if (!lastMock || Date.now() - lastMock >= mockEvery * DAY || t.mock > 0) add("mock", "Mock interview", "45 minutes, timed", "/mock", t.mock, 1);

  const done = tasks.filter((x) => x.done).length;
  return { date: user.interview_date, daysLeft, intensity, readiness: r.overall, band: r.band, tasks, done, total: tasks.length };
}
plan.get("/plan", (req, res) => res.json(buildPlan(req.userId!)));

/* ---------- mock interview ---------- */
type MockItem = { kind: "card" | "puzzle" | "design" | "story"; id: string; title: string; question: string; minutes: number };
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

function composeMock(u: number): MockItem[] {
  const r = computeReadiness(u);
  const items: MockItem[] = [];
  // 1) theory: a card from a weak DDIA chapter that is unlocked/started (fallback: any chapter 1-9)
  const weakCh = r.focus.map((f) => AREA_CHAPTERS[f.id]?.[0]).filter(Boolean) as number[];
  const ch = weakCh[0] ?? pick([1, 3, 5, 6, 7, 8, 9]);
  const card = db.prepare("SELECT k.id, k.title, c.title chapter FROM cards k JOIN chapters c ON c.id = k.chapter_id WHERE k.chapter_id = ? ORDER BY RANDOM() LIMIT 1").get(ch) as { id: number; title: string; chapter: string } | undefined;
  if (card) items.push({ kind: "card", id: String(card.id), title: card.title, question: `Explain "${card.title}" (${card.chapter}) as you would to an interviewer.`, minutes: 8 });
  // 2) theory puzzle: concurrency / resilience / distributed
  const tp = db.prepare("SELECT id FROM puzzles ORDER BY RANDOM()").all() as { id: string }[];
  const theory = tp.map((x) => getPuzzle(x.id)).find((p) => p.kind === "theory");
  if (theory) items.push({ kind: "puzzle", id: theory.id, title: theory.title, question: `${theory.prompt}\n\n${(theory as { question?: string }).question ?? ""}`.trim(), minutes: 8 });
  // 3) system design section (architecture or failures)
  if (content.design.length) {
    const p = pick(content.design);
    const s = p.sections.find((x) => x.key === pick(["architecture", "failures", "scale"])) ?? p.sections[0];
    items.push({ kind: "design", id: `${p.id}:${s.key}`, title: `${p.title}: ${s.title}`, question: `${p.brief}\n\nConstraints: ${p.constraints.join("; ")}\n\n${s.prompt}`, minutes: 17 });
  }
  // 4) behavioural
  if (content.behavioral.questions.length) {
    const q = pick(content.behavioral.questions.filter((x) => x.level === "senior").concat(content.behavioral.questions).slice(0, 40));
    items.push({ kind: "story", id: q.id, title: "Behavioural", question: `${q.text}\n\nAnswer with a STAR story: situation, task, what YOU did, and the measurable result.`, minutes: 10 });
  }
  return items;
}

plan.post("/mock/start", (req, res) => {
  const u = req.userId!;
  const open = db.prepare("SELECT id FROM mock_sessions WHERE user_id = ? AND finished_at IS NULL AND ends_at > ?").get(u, Date.now()) as { id: number } | undefined;
  if (open) return res.json(mockOut(open.id, u));
  const items = composeMock(u);
  const mins = items.reduce((s, i) => s + i.minutes, 0);
  const now = Date.now();
  const r = db.prepare("INSERT INTO mock_sessions (user_id, started_at, ends_at, items) VALUES (?, ?, ?, ?)").run(u, now, now + mins * 60000, JSON.stringify(items));
  res.json(mockOut(Number(r.lastInsertRowid), u));
});

function mockScores(u: number, started: number, items: MockItem[]) {
  return items.map((i) => (db.prepare("SELECT MAX(score) s FROM ai_grades WHERE user_id = ? AND kind = ? AND ref_id = ? AND created_at >= ?").get(u, i.kind, i.id, started) as { s: number | null }).s);
}
function mockOut(id: number, u: number) {
  const m = db.prepare("SELECT * FROM mock_sessions WHERE id = ? AND user_id = ?").get(id, u) as { id: number; started_at: number; ends_at: number; finished_at: number | null; items: string; scores: string | null; total: number | null } | undefined;
  if (!m) throw new HttpError(404, "No such mock");
  const items = JSON.parse(m.items) as MockItem[];
  const scores = m.scores ? (JSON.parse(m.scores) as (number | null)[]) : mockScores(u, m.started_at, items);
  return { id: m.id, startedAt: m.started_at, endsAt: m.ends_at, finishedAt: m.finished_at, items, scores, total: m.total };
}
plan.get("/mock/:id", (req, res) => res.json(mockOut(Number(req.params.id), req.userId!)));
plan.post("/mock/:id/finish", (req, res) => {
  const u = req.userId!;
  const m = mockOut(Number(req.params.id), u);
  if (m.finishedAt) return res.json(m);
  const scores = mockScores(u, m.startedAt, m.items);
  const total = Math.round((scores.reduce<number>((s, x) => s + (x ?? 0), 0) / Math.max(1, scores.length)) * 10);
  const now = Date.now();
  db.prepare("UPDATE mock_sessions SET finished_at = ?, scores = ?, total = ? WHERE id = ?").run(now, JSON.stringify(scores), total, m.id);
  addXP(u, 25 + Math.round(total / 4), "mock");
  res.json({ ...mockOut(m.id, u), overtime: now > m.endsAt });
});
plan.get("/mock", (req, res) => {
  const rows = db.prepare("SELECT id, started_at, finished_at, total FROM mock_sessions WHERE user_id = ? AND finished_at IS NOT NULL ORDER BY id DESC LIMIT 20").all(req.userId) as { id: number; started_at: number; finished_at: number; total: number }[];
  const open = db.prepare("SELECT id, ends_at FROM mock_sessions WHERE user_id = ? AND finished_at IS NULL AND ends_at > ? ORDER BY id DESC LIMIT 1").get(req.userId, Date.now() - 3 * 3600000) as { id: number; ends_at: number } | undefined;
  res.json({ history: rows.map((r) => ({ id: r.id, startedAt: r.started_at, finishedAt: r.finished_at, total: r.total })), open: open ?? null });
});
