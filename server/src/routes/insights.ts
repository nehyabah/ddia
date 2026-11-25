import { Router } from "express";
import { db } from "../db.js";
import { localDay, masteryByChapter, now } from "../progress.js";
import { chapterLabel } from "../http.js";

export const insights = Router();

const DAY_MS = 86_400_000;

insights.get("/stats", (req, res) => {
  const u = req.userId, t = now();
  const m = masteryByChapter(u);

  const chapters = (db.prepare(`
    SELECT c.id, c.tag, c.title,
      COUNT(a.id) AS attempts, COALESCE(SUM(a.correct), 0) AS correct
    FROM chapters c
    LEFT JOIN questions q ON q.chapter_id = c.id
    LEFT JOIN attempts a ON a.question_id = q.id AND a.user_id = ?
    GROUP BY c.id ORDER BY c.position
  `).all(u) as { id: number; tag: string | null; title: string; attempts: number; correct: number }[])
    .map((c) => ({
      id: c.id, label: chapterLabel(c), title: c.title, mastery: m.get(c.id) ?? 0,
      attempts: c.attempts, accuracy: c.attempts ? Math.round((c.correct / c.attempts) * 100) : null,
    }));

  // Daily activity for the last 16 weeks.
  const DAYS = 112;
  const since = localDay(t - (DAYS - 1) * DAY_MS);
  const xpByDay = new Map((db.prepare("SELECT day, SUM(amount) AS xp FROM xp_events WHERE user_id = ? AND day >= ? AND reason != 'import' GROUP BY day")
    .all(u, since) as { day: string; xp: number }[]).map((r) => [r.day, r.xp]));
  const ansByDay = new Map((db.prepare("SELECT day, COUNT(*) AS n, SUM(correct) AS c FROM attempts WHERE user_id = ? AND day >= ? GROUP BY day")
    .all(u, since) as { day: string; n: number; c: number }[]).map((r) => [r.day, r]));
  const days = Array.from({ length: DAYS }, (_, i) => {
    const day = localDay(t - (DAYS - 1 - i) * DAY_MS);
    const a = ansByDay.get(day);
    return { day, xp: xpByDay.get(day) ?? 0, answered: a?.n ?? 0, correct: a?.c ?? 0 };
  });

  const totals = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM attempts WHERE user_id = ?) AS answered,
      (SELECT COALESCE(SUM(correct), 0) FROM attempts WHERE user_id = ?) AS correct,
      (SELECT COUNT(*) FROM card_progress WHERE user_id = ? AND seen_at IS NOT NULL) AS cards_seen,
      (SELECT COUNT(*) FROM cards) AS cards_total,
      (SELECT COUNT(*) FROM questions) AS questions_total
  `).get(u, u, u) as { answered: number; correct: number; cards_seen: number; cards_total: number; questions_total: number };

  const boxRows = db.prepare("SELECT box, COUNT(*) AS n FROM question_srs WHERE user_id = ? GROUP BY box").all(u) as { box: number; n: number }[];
  const boxes = [0, 1, 2, 3, 4, 5].map((b) => boxRows.find((r) => r.box === b)?.n ?? 0);
  const unseen = totals.questions_total - boxes.reduce((a, b) => a + b, 0);

  // Reviews coming due: overdue now, then each of the next 7 days.
  const forecast = Array.from({ length: 8 }, (_, i) => {
    const [from, to] = i === 0 ? [0, t] : [t + (i - 1) * DAY_MS, t + i * DAY_MS];
    const n = (db.prepare("SELECT COUNT(*) AS n FROM question_srs WHERE user_id = ? AND due_at > ? AND due_at <= ?")
      .get(u, from, to) as { n: number }).n;
    return { label: i === 0 ? "Now" : i === 1 ? "24 h" : `Day ${i}`, n };
  });

  const weakest = (db.prepare(`
    SELECT q.id, q.prompt, q.options, q.answer, q.explanation, c.id AS chapter_id, c.tag, s.lapses, s.box, s.reps
    FROM question_srs s JOIN questions q ON q.id = s.question_id JOIN chapters c ON c.id = q.chapter_id
    WHERE s.user_id = ? AND s.lapses > 0
    ORDER BY s.lapses * 1.0 / s.reps DESC, s.lapses DESC, s.box ASC LIMIT 12
  `).all(u) as { id: number; prompt: string; options: string; answer: number; explanation: string; chapter_id: number; tag: string | null; lapses: number; box: number; reps: number }[])
    .map((q) => ({
      id: q.id, prompt: q.prompt, answer: (JSON.parse(q.options) as string[])[q.answer], explanation: q.explanation,
      chapterLabel: chapterLabel({ id: q.chapter_id, tag: q.tag }), chapterId: q.chapter_id, lapses: q.lapses, reps: q.reps, box: q.box,
    }));

  res.json({
    totals: {
      answered: totals.answered, correct: totals.correct,
      accuracy: totals.answered ? Math.round((totals.correct / totals.answered) * 100) : null,
      cardsSeen: totals.cards_seen, cardsTotal: totals.cards_total, questionsTotal: totals.questions_total,
      learned: boxes.slice(3).reduce((a, b) => a + b, 0),
    },
    boxes, unseen, forecast, days, chapters, weakest,
  });
});

insights.get("/notes", (req, res) => {
  const rows = db.prepare(`
    SELECT k.id, k.title, k.bullets, k.chapter_id, c.tag, c.title AS chapter_title, p.note, p.starred, p.note_updated_at
    FROM card_progress p JOIN cards k ON k.id = p.card_id JOIN chapters c ON c.id = k.chapter_id
    WHERE p.user_id = ? AND (p.starred = 1 OR p.note != '')
    ORDER BY c.position, k.idx
  `).all(req.userId) as { id: number; title: string; bullets: string; chapter_id: number; tag: string | null; chapter_title: string; note: string; starred: number; note_updated_at: string | null }[];
  res.json(rows.map((r) => ({
    cardId: r.id, title: r.title, bullets: JSON.parse(r.bullets), chapterId: r.chapter_id,
    chapterLabel: chapterLabel({ id: r.chapter_id, tag: r.tag }), chapterTitle: r.chapter_title,
    note: r.note, starred: !!r.starred, updatedAt: r.note_updated_at,
  })));
});

insights.get("/search", (req, res) => {
  const q = String(req.query.q ?? "").trim().slice(0, 100);
  if (q.length < 2) {
    res.json({ q, cards: [], terms: [], questions: [] });
    return;
  }
  const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const label = (r: { chapter_id: number; tag: string | null }) => chapterLabel({ id: r.chapter_id, tag: r.tag });
  const cards = (db.prepare(`
    SELECT k.id, k.idx, k.title, k.bullets, k.chapter_id, c.tag FROM cards k JOIN chapters c ON c.id = k.chapter_id
    WHERE k.title LIKE :q ESCAPE '\\' OR k.bullets LIKE :q ESCAPE '\\'
    ORDER BY (k.title LIKE :q ESCAPE '\\') DESC, c.position, k.idx LIMIT 25
  `).all({ q: like }) as { id: number; idx: number; title: string; bullets: string; chapter_id: number; tag: string | null }[])
    .map((r) => ({ id: r.id, idx: r.idx, title: r.title, bullets: JSON.parse(r.bullets), chapterId: r.chapter_id, chapterLabel: label(r) }));
  const terms = (db.prepare(`
    SELECT t.id, t.term, t.meaning, t.chapter_id, c.tag FROM terms t JOIN chapters c ON c.id = t.chapter_id
    WHERE t.term LIKE :q ESCAPE '\\' OR t.meaning LIKE :q ESCAPE '\\'
    ORDER BY (t.term LIKE :q ESCAPE '\\') DESC, c.position LIMIT 25
  `).all({ q: like }) as { id: number; term: string; meaning: string; chapter_id: number; tag: string | null }[])
    .map((r) => ({ id: r.id, term: r.term, meaning: r.meaning, chapterId: r.chapter_id, chapterLabel: label(r) }));
  const questions = (db.prepare(`
    SELECT q.id, q.prompt, q.options, q.answer, q.explanation, q.chapter_id, c.tag FROM questions q JOIN chapters c ON c.id = q.chapter_id
    WHERE q.prompt LIKE :q ESCAPE '\\' OR q.explanation LIKE :q ESCAPE '\\'
    ORDER BY c.position, q.idx LIMIT 25
  `).all({ q: like }) as { id: number; prompt: string; options: string; answer: number; explanation: string; chapter_id: number; tag: string | null }[])
    .map((r) => ({ id: r.id, prompt: r.prompt, answer: (JSON.parse(r.options) as string[])[r.answer], explanation: r.explanation, chapterId: r.chapter_id, chapterLabel: label(r) }));
  res.json({ q, cards, terms, questions });
});
