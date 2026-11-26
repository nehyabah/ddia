import { Router } from "express";
import { db, tx } from "../db.js";
import { BADGES, addXP, award, dueCount, mastery, masteryByChapter, now, localDay, schedule } from "../progress.js";
import { HttpError, chapterLabel, int, str } from "../http.js";

export const study = Router();

type ChapterRow = { id: number; tag: string | null; title: string; blurb: string };
type QuestionRow = { id: number; chapter_id: number; prompt: string; options: string; answer: number; explanation: string; boss: number };

const shuffle = <T,>(a: T[]) => {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const badgeList = (ids: (string | null)[]) =>
  [...new Set(ids.filter((b): b is string => !!b))].map((id) => ({ id, label: BADGES[id] ?? id }));

function getChapter(id: number) {
  const c = db.prepare("SELECT id, tag, title, blurb FROM chapters WHERE id = ?").get(id) as ChapterRow | undefined;
  if (!c) throw new HttpError(404, "No such chapter");
  return c;
}

export const UNLOCK_AT = 80;

/**
 * Chapters unlock in order within each track (the book, then the MongoDB track separately):
 * the first is always open; each next one opens when the previous reaches UNLOCK_AT% mastery.
 * A chapter with existing progress stays open so earlier work is never locked away.
 */
export function chapterLocks(userId: number): Map<number, { locked: boolean; after: string | null }> {
  const m = masteryByChapter(userId);
  const chapters = db.prepare("SELECT id, tag FROM chapters ORDER BY position").all() as { id: number; tag: string | null }[];
  const started = new Set((db.prepare(`
    SELECT DISTINCT q.chapter_id AS id FROM question_srs s JOIN questions q ON q.id = s.question_id WHERE s.user_id = ?
    UNION SELECT DISTINCT k.chapter_id FROM card_progress p JOIN cards k ON k.id = p.card_id WHERE p.user_id = ? AND p.seen_at IS NOT NULL
  `).all(userId, userId) as { id: number }[]).map((r) => r.id));
  const out = new Map<number, { locked: boolean; after: string | null }>();
  const prev: Record<string, { id: number; tag: string | null } | undefined> = {};
  for (const c of chapters) {
    const track = c.tag ? "db" : "book";
    const p = prev[track];
    const locked = !!p && (m.get(p.id) ?? 0) < UNLOCK_AT && !started.has(c.id);
    out.set(c.id, { locked, after: p ? chapterLabel(p) : null });
    prev[track] = c;
  }
  return out;
}

export function assertUnlocked(userId: number, chapterId: number) {
  const l = chapterLocks(userId).get(chapterId);
  if (l?.locked) throw new HttpError(403, `Locked: reach ${UNLOCK_AT}% on ${l.after} first`);
}

/* ---------- chapters ---------- */

study.get("/chapters", (req, res) => {
  const u = req.userId, t = now();
  const m = masteryByChapter(u);
  const rows = db.prepare(`
    SELECT c.id, c.tag, c.title, c.blurb,
      (SELECT COUNT(*) FROM cards WHERE chapter_id = c.id) AS card_count,
      (SELECT COUNT(*) FROM cards k JOIN card_progress p ON p.card_id = k.id AND p.user_id = ? AND p.seen_at IS NOT NULL WHERE k.chapter_id = c.id) AS cards_seen,
      (SELECT COUNT(*) FROM questions WHERE chapter_id = c.id) AS question_count,
      (SELECT COUNT(*) FROM questions q JOIN question_srs s ON s.question_id = q.id AND s.user_id = ? WHERE q.chapter_id = c.id AND s.due_at <= ?) AS due,
      EXISTS (SELECT 1 FROM boss_wins b WHERE b.user_id = ? AND b.chapter_id = c.id) AS boss_won
    FROM chapters c ORDER BY c.position
  `).all(u, u, t, u) as (ChapterRow & { card_count: number; cards_seen: number; question_count: number; due: number; boss_won: number })[];
  const locks = chapterLocks(u);
  res.json(rows.map((r) => ({
    id: r.id, tag: r.tag, label: chapterLabel(r), title: r.title, blurb: r.blurb,
    cardCount: r.card_count, cardsSeen: r.cards_seen, questionCount: r.question_count,
    due: r.due, bossWon: !!r.boss_won, mastery: m.get(r.id) ?? 0,
    locked: locks.get(r.id)?.locked ?? false, unlockAfter: locks.get(r.id)?.after ?? null, unlockAt: UNLOCK_AT,
  })));
});

study.get("/chapters/:id", (req, res) => {
  const u = req.userId;
  const c = getChapter(int(req.params.id, "id"));
  assertUnlocked(u, c.id);
  const cards = db.prepare(`
    SELECT k.id, k.idx, k.title, k.bullets, p.seen_at, COALESCE(p.starred, 0) AS starred, COALESCE(p.note, '') AS note
    FROM cards k LEFT JOIN card_progress p ON p.card_id = k.id AND p.user_id = ?
    WHERE k.chapter_id = ? ORDER BY k.idx
  `).all(u, c.id) as { id: number; idx: number; title: string; bullets: string; seen_at: string | null; starred: number; note: string }[];
  const terms = db.prepare("SELECT id, term, meaning FROM terms WHERE chapter_id = ? ORDER BY idx").all(c.id);
  const drills = db.prepare(`
    SELECT d.id, d.prompt, d.points, COALESCE(p.level, 0) AS level, p.last_ratio, COALESCE(p.last_answer, '') AS last_answer
    FROM drills d LEFT JOIN drill_progress p ON p.drill_id = d.id AND p.user_id = ?
    WHERE d.chapter_id = ? ORDER BY d.idx
  `).all(u, c.id) as { id: number; prompt: string; points: string; level: number; last_ratio: number | null; last_answer: string }[];
  const counts = db.prepare(`
    SELECT SUM(boss = 0) AS quiz, SUM(boss = 1) AS boss,
      SUM(CASE WHEN s.due_at <= ? THEN 1 ELSE 0 END) AS due
    FROM questions q LEFT JOIN question_srs s ON s.question_id = q.id AND s.user_id = ?
    WHERE q.chapter_id = ?
  `).get(now(), u, c.id) as { quiz: number; boss: number; due: number };
  const bossWon = !!db.prepare("SELECT 1 FROM boss_wins WHERE user_id = ? AND chapter_id = ?").get(u, c.id);
  res.json({
    id: c.id, tag: c.tag, label: chapterLabel(c), title: c.title, blurb: c.blurb,
    mastery: mastery(u, c.id), bossWon,
    quizCount: counts.quiz ?? 0, bossCount: counts.boss ?? 0, due: counts.due ?? 0,
    cards: cards.map((k) => ({ id: k.id, idx: k.idx, title: k.title, bullets: JSON.parse(k.bullets), seen: !!k.seen_at, starred: !!k.starred, note: k.note })),
    terms,
    drills: drills.map((d) => ({ id: d.id, prompt: d.prompt, points: JSON.parse(d.points), level: d.level, lastRatio: d.last_ratio, lastAnswer: d.last_answer })),
  });
});

/* ---------- flashcards ---------- */

function cardChapter(cardId: number) {
  const k = db.prepare("SELECT chapter_id FROM cards WHERE id = ?").get(cardId) as { chapter_id: number } | undefined;
  if (!k) throw new HttpError(404, "No such card");
  return k.chapter_id;
}

study.post("/cards/:id/seen", (req, res) => {
  const u = req.userId, id = int(req.params.id, "id");
  const ch = cardChapter(id);
  assertUnlocked(u, ch);
  const out = tx(() => {
    const r = db.prepare(`
      INSERT INTO card_progress (user_id, card_id, seen_at) VALUES (?, ?, ?)
      ON CONFLICT (user_id, card_id) DO UPDATE SET seen_at = excluded.seen_at WHERE seen_at IS NULL
    `).run(u, id, localDay());
    const first = r.changes > 0;
    const badges: (string | null)[] = first ? addXP(u, 5, "card") : [];
    const unseen = db.prepare(`
      SELECT COUNT(*) AS n FROM cards k LEFT JOIN card_progress p ON p.card_id = k.id AND p.user_id = ?
      WHERE k.chapter_id = ? AND p.seen_at IS NULL
    `).get(u, ch) as { n: number };
    if (unseen.n === 0) badges.push(award(u, "reader"));
    return { xp: first ? 5 : 0, newBadges: badgeList(badges) };
  });
  res.json(out);
});

study.put("/cards/:id/star", (req, res) => {
  const id = int(req.params.id, "id");
  cardChapter(id);
  const starred = req.body?.starred ? 1 : 0;
  db.prepare(`
    INSERT INTO card_progress (user_id, card_id, starred) VALUES (?, ?, ?)
    ON CONFLICT (user_id, card_id) DO UPDATE SET starred = excluded.starred
  `).run(req.userId, id, starred);
  res.json({ starred: !!starred });
});

study.put("/cards/:id/note", (req, res) => {
  const id = int(req.params.id, "id");
  cardChapter(id);
  const note = str(req.body?.note ?? "", "note", 0, 20_000);
  db.prepare(`
    INSERT INTO card_progress (user_id, card_id, note, note_updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT (user_id, card_id) DO UPDATE SET note = excluded.note, note_updated_at = excluded.note_updated_at
  `).run(req.userId, id, note);
  res.json({ note });
});

/* ---------- quiz / boss / review runs ---------- */

const RUN_SIZE = 10;
const REVIEW_SIZE = 20;
const BOSS_UNLOCK = 50;

study.post("/runs", (req, res) => {
  const u = req.userId, t = now();
  const mode = req.body?.mode;
  if (!["quiz", "boss", "review"].includes(mode)) throw new HttpError(400, "mode must be quiz, boss or review");
  let chapterId: number | null = null;
  let picked: QuestionRow[];

  if (mode === "review") {
    picked = db.prepare(`
      SELECT q.* FROM question_srs s JOIN questions q ON q.id = s.question_id
      WHERE s.user_id = ? AND s.due_at <= ? ORDER BY s.due_at LIMIT ?
    `).all(u, t, REVIEW_SIZE) as QuestionRow[];
    if (!picked.length) throw new HttpError(400, "Nothing is due for review right now");
    picked = shuffle(picked);
  } else {
    chapterId = getChapter(int(req.body?.chapterId, "chapterId")).id;
    assertUnlocked(u, chapterId);
    if (mode === "boss") {
      if (mastery(u, chapterId) < BOSS_UNLOCK) throw new HttpError(403, `Boss unlocks at ${BOSS_UNLOCK}% node health`);
      picked = shuffle(db.prepare("SELECT * FROM questions WHERE chapter_id = ? AND boss = 1").all(chapterId) as QuestionRow[]);
    } else {
      // Weakest first: due → never seen → lowest box. Random tiebreak.
      const rows = db.prepare(`
        SELECT q.*, s.box, s.due_at FROM questions q
        LEFT JOIN question_srs s ON s.question_id = q.id AND s.user_id = ?
        WHERE q.chapter_id = ? AND q.boss = 0
      `).all(u, chapterId) as (QuestionRow & { box: number | null; due_at: number | null })[];
      const rank = (r: (typeof rows)[number]) =>
        r.due_at != null && r.due_at <= t ? 0 : r.box == null ? 1 : 2 + r.box;
      picked = shuffle(shuffle(rows).sort((a, b) => rank(a) - rank(b)).slice(0, RUN_SIZE));
    }
    if (!picked.length) throw new HttpError(400, "This chapter has no questions for that mode");
  }

  const lives = mode === "boss" ? 3 : null;
  const r = db.prepare("INSERT INTO runs (user_id, chapter_id, mode, question_ids, lives, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(u, chapterId, mode, JSON.stringify(picked.map((q) => q.id)), lives, t);
  const chapters = new Map((db.prepare("SELECT id, tag FROM chapters").all() as { id: number; tag: string | null }[]).map((c) => [c.id, chapterLabel(c)]));
  res.status(201).json({
    runId: Number(r.lastInsertRowid), mode, chapterId, lives,
    questions: picked.map((q) => ({ id: q.id, chapterId: q.chapter_id, chapterLabel: chapters.get(q.chapter_id), prompt: q.prompt, options: JSON.parse(q.options) })),
  });
});

study.post("/runs/:id/answer", (req, res) => {
  const u = req.userId;
  const runId = int(req.params.id, "id");
  const questionId = int(req.body?.questionId, "questionId");
  const choice = int(req.body?.choice, "choice", 0, 20);

  const out = tx(() => {
    const run = db.prepare("SELECT * FROM runs WHERE id = ? AND user_id = ?").get(runId, u) as
      { id: number; chapter_id: number | null; mode: string; question_ids: string; pos: number; combo: number; best_combo: number; correct: number; lives: number | null; xp: number; finished: number } | undefined;
    if (!run) throw new HttpError(404, "No such run");
    if (run.finished) throw new HttpError(409, "This run is already finished");
    const ids: number[] = JSON.parse(run.question_ids);
    if (ids[run.pos] !== questionId) throw new HttpError(409, "That isn't the current question in this run");
    const q = db.prepare("SELECT * FROM questions WHERE id = ?").get(questionId) as QuestionRow;

    const ok = choice === q.answer;
    const boss = run.mode === "boss";
    const badges: (string | null)[] = [];
    schedule(u, q.id, ok, run.mode);
    let combo = run.combo, correct = run.correct, lives = run.lives, gain = 0;
    if (ok) {
      combo++; correct++;
      const mult = 1 + Math.min(Math.floor(combo / 3) * 0.5, 2);
      gain = Math.round((boss ? 20 : 10) * mult);
      badges.push(...addXP(u, gain, run.mode));
      badges.push(award(u, "first"));
      if (combo >= 5) badges.push(award(u, "combo5"));
      if (combo >= 10) badges.push(award(u, "combo10"));
    } else {
      combo = 0;
      if (boss && lives != null) lives--;
    }
    const pos = run.pos + 1;
    const finished = pos >= ids.length || (boss && lives === 0);
    let xp = run.xp + gain;

    let summary = null;
    if (finished) {
      let bonus = 0, message: string;
      const total = boss ? ids.length : ids.length;
      if (boss) {
        if ((lives ?? 0) > 0) {
          bonus = 100;
          db.prepare("INSERT OR IGNORE INTO boss_wins (user_id, chapter_id, won_at) VALUES (?, ?, ?)").run(u, run.chapter_id, localDay());
          badges.push(award(u, "boss"));
          message = "Boss defeated.";
        } else message = "The boss won this round. Review the cards it beat you on and try again.";
      } else if (run.mode === "review") {
        const left = dueCount(u);
        if (left === 0) badges.push(award(u, "reviewer"));
        message = left === 0 ? "Review queue cleared. Come back when the next batch is due."
          : `${left} more ${left === 1 ? "question is" : "questions are"} due — keep going while it's fresh.`;
      } else {
        if (correct === total) { bonus = 30; badges.push(award(u, "perfect")); }
        message = correct === total ? "Perfect run."
          : correct >= total * 0.7 ? "Solid run. Missed questions will come back first next time."
          : "Missed questions are now at the front of the queue. Another run will lock them in.";
      }
      if (bonus) badges.push(...addXP(u, bonus, `${run.mode}-bonus`));
      xp += bonus;
      const m = run.chapter_id != null ? mastery(u, run.chapter_id) : null;
      if (m != null && m >= 80) badges.push(award(u, "master"));
      summary = { correct, total, answered: pos, xp, bonus, message, mastery: m };
    }
    db.prepare("UPDATE runs SET pos = ?, combo = ?, best_combo = MAX(best_combo, ?), correct = ?, lives = ?, xp = ?, finished = ? WHERE id = ?")
      .run(pos, combo, combo, correct, lives, xp, finished ? 1 : 0, run.id);

    return { correct: ok, answer: q.answer, explanation: q.explanation, xp: gain, combo, lives, finished, summary, newBadges: badgeList(badges) };
  });
  res.json(out);
});

/* ---------- term match ---------- */

study.post("/match", (req, res) => {
  const u = req.userId;
  const c = getChapter(int(req.body?.chapterId, "chapterId"));
  assertUnlocked(u, c.id);
  const seconds = int(req.body?.seconds, "seconds", 1, 86_400);
  const misses = int(req.body?.misses, "misses", 0, 1000);
  const gain = Math.max(Math.max(10, 60 - seconds) - misses * 3, 5);
  const out = tx(() => {
    const badges: (string | null)[] = addXP(u, gain, `match:${c.id}`);
    if (seconds < 60 && misses === 0) badges.push(award(u, "matcher"));
    return { xp: gain, newBadges: badgeList(badges) };
  });
  res.json(out);
});

/* ---------- explain-it drills ---------- */

study.post("/drills/:id", (req, res) => {
  const u = req.userId, id = int(req.params.id, "id");
  const d = db.prepare("SELECT id, chapter_id, points FROM drills WHERE id = ?").get(id) as { id: number; chapter_id: number; points: string } | undefined;
  if (!d) throw new HttpError(404, "No such drill");
  assertUnlocked(u, d.chapter_id);
  const total = (JSON.parse(d.points) as string[]).length;
  const covered = int(req.body?.covered, "covered", 0, total);
  const answer = str(req.body?.answer ?? "", "answer", 0, 20_000);
  const ratio = covered / total;
  const gain = Math.round(25 * ratio);
  const out = tx(() => {
    db.prepare(`
      INSERT INTO drill_progress (user_id, drill_id, level, last_ratio, last_answer, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT (user_id, drill_id) DO UPDATE SET
        level = CASE WHEN excluded.last_ratio >= 0.8 THEN level + 1 ELSE 0 END,
        last_ratio = excluded.last_ratio, last_answer = excluded.last_answer, updated_at = excluded.updated_at
    `).run(u, id, ratio >= 0.8 ? 1 : 0, ratio, answer);
    const badges: (string | null)[] = addXP(u, gain, "drill");
    if (ratio >= 0.8) badges.push(award(u, "explainer"));
    return { xp: gain, ratio, covered, total, newBadges: badgeList(badges) };
  });
  res.json(out);
});
