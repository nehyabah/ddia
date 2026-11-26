import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { ROOT, db, tx } from "../db.js";
import { BADGES, addXP, award, localDay } from "../progress.js";
import { HttpError } from "../http.js";

export const puzzles = Router();

export const TRACKS = ["concurrency", "resilience", "distributed"] as const;
const TRACK_LABEL: Record<string, string> = { concurrency: "Concurrency", resilience: "Rate limits & retries", distributed: "Distributed systems" };
const LEVELS = ["beginner", "intermediate", "advanced", "expert"];
const XP: Record<string, number> = { beginner: 15, intermediate: 20, advanced: 30, expert: 40 };
export const PASS_SCORE = 7;
const REVEAL_AFTER = 3;

type Base = { id: string; track: string; level: string; topic: string; title: string; kind: "parsons" | "blanks" | "theory"; prompt: string; explanation: string };
export type Puzzle = Base & {
  lines?: string[]; distractors?: string[]; solution?: string; expectedOutput?: string;
  code?: string; blanks?: { options: string[]; answer: number }[];
  question?: string; keyPoints?: string[]; modelAnswer?: string; hint?: string;
};

db.exec(`
CREATE TABLE IF NOT EXISTS puzzles (id TEXT PRIMARY KEY, track TEXT NOT NULL, level TEXT NOT NULL, topic TEXT NOT NULL, position INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS puzzle_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  puzzle_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  solved INTEGER NOT NULL DEFAULT 0,
  revealed INTEGER NOT NULL DEFAULT 0,
  best_score INTEGER,
  solved_day TEXT,
  PRIMARY KEY (user_id, puzzle_id)
);
`);

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export function validatePuzzle(p: Puzzle): string[] {
  const e: string[] = [];
  if (!isStr(p.id)) e.push("missing id");
  if (!TRACKS.includes(p.track as never)) e.push(`bad track ${p.track}`);
  if (!LEVELS.includes(p.level)) e.push(`bad level ${p.level}`);
  for (const k of ["topic", "title", "prompt", "explanation"] as const) if (!isStr(p[k])) e.push(`missing ${k}`);
  if (p.kind === "parsons") {
    if (!Array.isArray(p.lines) || p.lines.length < 3 || !p.lines.every((l) => typeof l === "string")) e.push("parsons needs lines[]");
    if (p.distractors && !Array.isArray(p.distractors)) e.push("distractors must be an array");
  } else if (p.kind === "blanks") {
    const gaps = isStr(p.code) ? (p.code.match(/\[\[\d+\]\]/g) ?? []).length : 0;
    if (!Array.isArray(p.blanks) || p.blanks.length === 0 || p.blanks.length !== gaps) e.push(`blanks count ${p.blanks?.length} != gaps ${gaps}`);
    p.blanks?.forEach((b, i) => {
      if (!Array.isArray(b.options) || b.options.length < 2 || !Number.isInteger(b.answer) || b.answer < 0 || b.answer >= b.options.length) e.push(`bad blank ${i + 1}`);
    });
  } else if (p.kind === "theory") {
    if (!isStr(p.question) || !Array.isArray(p.keyPoints) || p.keyPoints.length < 2 || !isStr(p.modelAnswer)) e.push("theory needs question, keyPoints, modelAnswer");
  } else e.push(`bad kind ${p.kind}`);
  return e;
}

export function seedPuzzles(log = console.warn) {
  const dir = path.join(ROOT, "server", "content", "puzzles");
  const all: Puzzle[] = [];
  const seen = new Set<string>();
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
      let arr: unknown;
      try { arr = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch (e) { log(`[puzzles] ${f}: invalid JSON (${(e as Error).message})`); continue; }
      if (!Array.isArray(arr)) { log(`[puzzles] ${f}: not an array`); continue; }
      for (const p of arr as Puzzle[]) {
        const errs = validatePuzzle(p);
        if (errs.length) { log(`[puzzles] ${f}: ${p?.id ?? "?"} skipped: ${errs.join("; ")}`); continue; }
        if (seen.has(p.id)) { log(`[puzzles] duplicate ${p.id}`); continue; }
        seen.add(p.id); all.push(p);
      }
    }
  }
  all.sort((a, b) => TRACKS.indexOf(a.track as never) - TRACKS.indexOf(b.track as never) || LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
  tx(() => {
    db.exec("DELETE FROM puzzles");
    const ins = db.prepare("INSERT INTO puzzles (id, track, level, topic, position, data) VALUES (?, ?, ?, ?, ?, ?)");
    all.forEach((p, i) => ins.run(p.id, p.track, p.level, p.topic, i, JSON.stringify(p)));
  });
  console.log(`[puzzles] loaded ${all.length}`);
}

export function getPuzzle(id: string): Puzzle {
  const r = db.prepare("SELECT data FROM puzzles WHERE id = ?").get(id) as { data: string } | undefined;
  if (!r) throw new HttpError(404, "No such puzzle");
  return JSON.parse(r.data) as Puzzle;
}

/** Deterministic per-user shuffle so a refresh doesn't reshuffle the lines mid-attempt. */
function seededShuffle<T>(arr: T[], seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  // never hand out the lines already in the right order
  if (a.length > 2 && a.every((x, i) => x === arr[i])) a.push(a.shift() as T);
  return a;
}

type Progress = { attempts: number; solved: number; revealed: number; best_score: number | null };
const progressOf = (u: number, id: string) =>
  (db.prepare("SELECT attempts, solved, revealed, best_score FROM puzzle_progress WHERE user_id = ? AND puzzle_id = ?").get(u, id) as Progress | undefined)
  ?? { attempts: 0, solved: 0, revealed: 0, best_score: null };

function publicView(p: Puzzle, u: number) {
  const pr = progressOf(u, p.id);
  const base = {
    id: p.id, track: p.track, trackLabel: TRACK_LABEL[p.track], level: p.level, topic: p.topic, title: p.title, kind: p.kind,
    prompt: p.prompt, attempts: pr.attempts, solved: !!pr.solved, revealed: !!pr.revealed, bestScore: pr.best_score,
    xp: XP[p.level], passScore: PASS_SCORE, revealAfter: REVEAL_AFTER,
  };
  if (p.kind === "parsons") return { ...base, pool: seededShuffle([...(p.lines ?? []), ...(p.distractors ?? [])], `${u}:${p.id}`), slots: p.lines!.length };
  if (p.kind === "blanks") return { ...base, code: p.code, blanks: p.blanks!.map((b) => ({ options: b.options })) };
  return { ...base, question: p.question, hint: p.hint ?? null };
}

function solutionView(p: Puzzle) {
  return {
    explanation: p.explanation, solution: p.solution ?? null, expectedOutput: p.expectedOutput ?? null,
    lines: p.lines ?? null, answers: p.blanks?.map((b) => b.answer) ?? null, modelAnswer: p.modelAnswer ?? null, keyPoints: p.keyPoints ?? null,
  };
}

/** Records a solve (idempotent) and returns XP + badges earned. */
export function markSolved(u: number, p: Puzzle, firstTry: boolean, score?: number) {
  const pr = progressOf(u, p.id);
  db.prepare(`
    INSERT INTO puzzle_progress (user_id, puzzle_id, attempts, solved, best_score, solved_day) VALUES (?, ?, 0, 1, ?, ?)
    ON CONFLICT (user_id, puzzle_id) DO UPDATE SET solved = 1, best_score = MAX(COALESCE(best_score, 0), COALESCE(excluded.best_score, 0)),
      solved_day = COALESCE(solved_day, excluded.solved_day)
  `).run(u, p.id, score ?? null, localDay());
  if (pr.solved) return { xp: 0, badges: [] as string[] };
  const xp = pr.revealed ? 0 : Math.round(XP[p.level] * (firstTry ? 1 : 0.5));
  const badges = addXP(u, xp, `puzzle:${p.track}`);
  const b1 = award(u, "puzzler"); if (b1) badges.push(b1);
  const left = (db.prepare(`
    SELECT COUNT(*) AS n FROM puzzles z LEFT JOIN puzzle_progress pp ON pp.puzzle_id = z.id AND pp.user_id = ? AND pp.solved = 1
    WHERE z.track = ? AND pp.puzzle_id IS NULL
  `).get(u, p.track) as { n: number }).n;
  if (left === 0) { const b = award(u, `track_${p.track}`); if (b) badges.push(b); }
  return { xp, badges };
}

const bump = (u: number, id: string) => db.prepare(`
  INSERT INTO puzzle_progress (user_id, puzzle_id, attempts) VALUES (?, ?, 1)
  ON CONFLICT (user_id, puzzle_id) DO UPDATE SET attempts = attempts + 1
`).run(u, id);

/* ---------- routes ---------- */

puzzles.get("/puzzles", (req, res) => {
  const u = req.userId;
  const rows = db.prepare(`
    SELECT z.track, z.level, z.topic, COUNT(*) AS n, SUM(COALESCE(pp.solved, 0)) AS solved
    FROM puzzles z LEFT JOIN puzzle_progress pp ON pp.puzzle_id = z.id AND pp.user_id = ?
    GROUP BY z.track, z.level, z.topic ORDER BY MIN(z.position)
  `).all(u) as { track: string; level: string; topic: string; n: number; solved: number }[];
  res.json({
    tracks: TRACKS.map((t) => {
      const rs = rows.filter((r) => r.track === t);
      return {
        id: t, label: TRACK_LABEL[t],
        count: rs.reduce((a, r) => a + r.n, 0), solved: rs.reduce((a, r) => a + r.solved, 0),
        topics: [...new Map(rs.map((r) => [r.topic, { topic: r.topic, count: 0, solved: 0 }])).values()].map((tp) => {
          const these = rs.filter((r) => r.topic === tp.topic);
          return { topic: tp.topic, count: these.reduce((a, r) => a + r.n, 0), solved: these.reduce((a, r) => a + r.solved, 0) };
        }),
      };
    }),
    passScore: PASS_SCORE,
  });
});

puzzles.get("/puzzles/list", (req, res) => {
  const u = req.userId;
  const rows = db.prepare(`
    SELECT z.data, COALESCE(pp.solved, 0) AS solved, COALESCE(pp.attempts, 0) AS attempts, pp.best_score
    FROM puzzles z LEFT JOIN puzzle_progress pp ON pp.puzzle_id = z.id AND pp.user_id = ? ORDER BY z.position
  `).all(u) as { data: string; solved: number; attempts: number; best_score: number | null }[];
  res.json(rows.map((r) => {
    const p = JSON.parse(r.data) as Puzzle;
    return { id: p.id, track: p.track, level: p.level, topic: p.topic, title: p.title, kind: p.kind, solved: !!r.solved, attempts: r.attempts, bestScore: r.best_score };
  }));
});

/** A run of puzzles: unsolved first, easiest level first (so it ramps up), within an optional track/topic. */
puzzles.post("/puzzles/session", (req, res) => {
  const u = req.userId;
  const track = TRACKS.includes(req.body?.track) ? (req.body.track as string) : null;
  const topic = typeof req.body?.topic === "string" ? req.body.topic : null;
  const rows = db.prepare(`
    SELECT z.data, z.position, COALESCE(pp.solved, 0) AS solved FROM puzzles z
    LEFT JOIN puzzle_progress pp ON pp.puzzle_id = z.id AND pp.user_id = ?
    WHERE (? IS NULL OR z.track = ?) AND (? IS NULL OR z.topic = ?)
    ORDER BY z.position
  `).all(u, track, track, topic, topic) as { data: string; position: number; solved: number }[];
  if (!rows.length) throw new HttpError(400, "No puzzles match that filter yet");
  const unsolved = rows.filter((r) => !r.solved);
  const pick = (unsolved.length ? unsolved : rows).slice(0, 6);
  res.json({ allSolved: unsolved.length === 0, puzzles: pick.map((r) => publicView(JSON.parse(r.data) as Puzzle, u)) });
});

puzzles.get("/puzzles/:id", (req, res) => {
  const p = getPuzzle(String(req.params.id));
  const view = publicView(p, req.userId);
  res.json({ ...view, ...(view.solved || view.revealed ? { reveal: solutionView(p) } : {}) });
});

puzzles.post("/puzzles/:id/check", (req, res) => {
  const u = req.userId;
  const p = getPuzzle(String(req.params.id));
  if (p.kind === "theory") throw new HttpError(400, "Theory puzzles are graded with /api/ai/grade");
  const out = tx(() => {
    const before = progressOf(u, p.id);
    bump(u, p.id);
    let correct = false;
    let detail: boolean[] = [];
    if (p.kind === "parsons") {
      const order: unknown = req.body?.order;
      if (!Array.isArray(order) || !order.every((x) => typeof x === "string")) throw new HttpError(400, "order must be an array of lines");
      const want = p.lines!;
      detail = want.map((l, i) => order[i] === l);
      correct = order.length === want.length && detail.every(Boolean);
    } else {
      const choices: unknown = req.body?.choices;
      if (!Array.isArray(choices)) throw new HttpError(400, "choices must be an array");
      detail = p.blanks!.map((b, i) => choices[i] === b.answer);
      correct = detail.every(Boolean);
    }
    const attempts = before.attempts + 1;
    let xp = 0, badges: string[] = [];
    if (correct) ({ xp, badges } = markSolved(u, p, attempts === 1));
    const canReveal = !correct && attempts >= REVEAL_AFTER;
    return { correct, detail, attempts, xp, badges, canReveal };
  });
  res.json({
    ...out,
    newBadges: out.badges.map((b) => ({ id: b, label: BADGES[b] ?? b })),
    ...(out.correct ? { reveal: solutionView(p) } : {}),
  });
});

puzzles.post("/puzzles/:id/reveal", (req, res) => {
  const u = req.userId;
  const p = getPuzzle(String(req.params.id));
  const pr = progressOf(u, p.id);
  if (!pr.solved && pr.attempts < REVEAL_AFTER && p.kind !== "theory") throw new HttpError(403, `Try at least ${REVEAL_AFTER} times before revealing`);
  db.prepare(`
    INSERT INTO puzzle_progress (user_id, puzzle_id, revealed) VALUES (?, ?, 1)
    ON CONFLICT (user_id, puzzle_id) DO UPDATE SET revealed = 1
  `).run(u, p.id);
  res.json({ reveal: solutionView(p) });
});
