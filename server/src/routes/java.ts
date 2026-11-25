import path from "node:path";
import { Router } from "express";
import { ROOT, db, tx } from "../db.js";
import { BADGES, MAX_BOX, addXP, award, localDay, now } from "../progress.js";
import { HttpError, int } from "../http.js";
import { LEVELS, loadJavaContent, type Challenge, type Lesson } from "../javaContent.js";

export const java = Router();

const LEVEL_LABEL: Record<string, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced", expert: "Expert" };
const LEVEL_XP: Record<string, number> = { beginner: 10, intermediate: 15, advanced: 20, expert: 25 };
const INTERVAL_DAYS = [0, 1, 3, 7, 16, 35];
const DAY_MS = 86_400_000;

export function seedJava() {
  const { challenges, lessons } = loadJavaContent(path.join(ROOT, "server", "content", "java"));
  tx(() => {
    db.exec("DELETE FROM java_challenges; DELETE FROM java_lessons;");
    const insC = db.prepare("INSERT INTO java_challenges (id, level, topic, position, data) VALUES (?, ?, ?, ?, ?)");
    challenges.forEach((c, i) => insC.run(c.id, c.level, c.topic, i, JSON.stringify(c)));
    const insL = db.prepare("INSERT INTO java_lessons (id, level, position, data) VALUES (?, ?, ?, ?)");
    lessons.forEach((l, i) => insL.run(l.id, l.level, i, JSON.stringify(l)));
  });
  console.log(`[java] loaded ${challenges.length} challenges, ${lessons.length} lessons`);
}

export function javaDueCount(userId: number) {
  return (db.prepare(`
    SELECT COUNT(*) AS n FROM java_srs s JOIN java_challenges c ON c.id = s.challenge_id
    WHERE s.user_id = ? AND s.due_at <= ?
  `).get(userId, now()) as { n: number }).n;
}

/** What the player sees before answering: no answer, bug lines, explanation or fix. */
function publicView(c: Challenge, box: number | null) {
  return {
    id: c.id, level: c.level, topic: c.topic, title: c.title, kind: c.kind,
    scenario: c.scenario, symptom: c.symptom ?? null, code: c.code,
    question: c.question, options: c.options, bugLineCount: c.bugLines.length, box,
  };
}

const getChallenge = (id: string) => {
  const r = db.prepare("SELECT data FROM java_challenges WHERE id = ?").get(id) as { data: string } | undefined;
  if (!r) throw new HttpError(404, "No such challenge");
  return JSON.parse(r.data) as Challenge;
};

java.get("/java", (req, res) => {
  const u = req.userId, t = now();
  const rows = db.prepare(`
    SELECT c.level, c.topic, COUNT(*) AS n,
      SUM(MIN(COALESCE(s.box, 0), 3)) AS pts,
      SUM(CASE WHEN s.box IS NOT NULL THEN 1 ELSE 0 END) AS tried,
      SUM(CASE WHEN s.due_at <= ? THEN 1 ELSE 0 END) AS due
    FROM java_challenges c LEFT JOIN java_srs s ON s.challenge_id = c.id AND s.user_id = ?
    GROUP BY c.level, c.topic ORDER BY MIN(c.position)
  `).all(t, u) as { level: string; topic: string; n: number; pts: number; tried: number; due: number }[];
  const lessonRows = db.prepare(`
    SELECT l.level, COUNT(*) AS n, COUNT(r.lesson_id) AS done
    FROM java_lessons l LEFT JOIN java_lesson_reads r ON r.lesson_id = l.id AND r.user_id = ?
    GROUP BY l.level
  `).all(u) as { level: string; n: number; done: number }[];
  const levels = LEVELS.map((lv) => {
    const rs = rows.filter((r) => r.level === lv);
    const n = rs.reduce((a, r) => a + r.n, 0);
    const pts = rs.reduce((a, r) => a + (r.pts ?? 0), 0);
    const les = lessonRows.find((l) => l.level === lv);
    return {
      id: lv, label: LEVEL_LABEL[lv], count: n,
      tried: rs.reduce((a, r) => a + (r.tried ?? 0), 0),
      due: rs.reduce((a, r) => a + (r.due ?? 0), 0),
      mastery: n ? Math.round((pts / (n * 3)) * 100) : 0,
      lessons: les?.n ?? 0, lessonsRead: les?.done ?? 0,
      topics: rs.map((r) => ({ topic: r.topic, count: r.n, mastery: Math.round(((r.pts ?? 0) / (r.n * 3)) * 100) })),
    };
  });
  const totals = db.prepare(`
    SELECT COUNT(*) AS answered, COALESCE(SUM(correct), 0) AS correct, COALESCE(SUM(lines_exact), 0) AS exact
    FROM java_attempts WHERE user_id = ?
  `).get(u) as { answered: number; correct: number; exact: number };
  res.json({ levels, due: javaDueCount(u), totals });
});

java.get("/java/challenges", (req, res) => {
  const u = req.userId;
  const level = typeof req.query.level === "string" ? req.query.level : null;
  const q = level
    ? db.prepare("SELECT c.data, s.box, s.reps, s.lapses FROM java_challenges c LEFT JOIN java_srs s ON s.challenge_id = c.id AND s.user_id = ? WHERE c.level = ? ORDER BY c.position").all(u, level)
    : db.prepare("SELECT c.data, s.box, s.reps, s.lapses FROM java_challenges c LEFT JOIN java_srs s ON s.challenge_id = c.id AND s.user_id = ? ORDER BY c.position").all(u);
  res.json((q as { data: string; box: number | null; reps: number | null; lapses: number | null }[]).map((r) => {
    const c = JSON.parse(r.data) as Challenge;
    return { id: c.id, level: c.level, topic: c.topic, title: c.title, kind: c.kind, box: r.box, reps: r.reps ?? 0, lapses: r.lapses ?? 0 };
  }));
});

java.get("/java/challenges/:id", (req, res) => {
  const c = getChallenge(String(req.params.id));
  const s = db.prepare("SELECT box FROM java_srs WHERE user_id = ? AND challenge_id = ?").get(req.userId, c.id) as { box: number } | undefined;
  res.json(publicView(c, s?.box ?? null));
});

/** Build a practice set: due first, then never tried, then weakest. Or a review set of everything due. */
java.post("/java/session", (req, res) => {
  const u = req.userId, t = now();
  const mode = req.body?.mode === "review" ? "review" : "practice";
  const level = LEVELS.includes(req.body?.level) ? (req.body.level as string) : null;
  const topic = typeof req.body?.topic === "string" ? req.body.topic : null;
  const size = req.body?.size == null ? 8 : int(req.body.size, "size", 1, 30);
  const rows = db.prepare(`
    SELECT c.data, c.level, c.topic, s.box, s.due_at FROM java_challenges c
    LEFT JOIN java_srs s ON s.challenge_id = c.id AND s.user_id = ?
    ORDER BY c.position
  `).all(u) as { data: string; level: string; topic: string; box: number | null; due_at: number | null }[];
  let pool = rows.filter((r) => (!level || r.level === level) && (!topic || r.topic === topic));
  if (mode === "review") pool = pool.filter((r) => r.due_at != null && r.due_at <= t);
  if (!pool.length) throw new HttpError(400, mode === "review" ? "No Java challenges are due for review right now" : "No challenges match that filter");
  const rank = (r: (typeof pool)[number]) => (r.due_at != null && r.due_at <= t ? 0 : r.box == null ? 1 : 2 + r.box);
  const shuffled = pool.map((r) => ({ r, k: Math.random() })).sort((a, b) => a.k - b.k).map((x) => x.r);
  const picked = shuffled.sort((a, b) => rank(a) - rank(b)).slice(0, mode === "review" ? 20 : size);
  // Within the session, go easiest level first so difficulty ramps up.
  picked.sort((a, b) => LEVELS.indexOf(a.level as never) - LEVELS.indexOf(b.level as never));
  res.json({ mode, challenges: picked.map((r) => publicView(JSON.parse(r.data), r.box)) });
});

java.post("/java/challenges/:id/answer", (req, res) => {
  const u = req.userId;
  const c = getChallenge(String(req.params.id));
  const choice = int(req.body?.choice, "choice", 0, 3);
  const lines: number[] = Array.isArray(req.body?.lines) ? req.body.lines.filter((n: unknown) => Number.isInteger(n)).slice(0, 20) : [];
  const correct = choice === c.answer;
  const want = new Set(c.bugLines);
  const hits = lines.filter((l) => want.has(l)).length;
  const linesExact = hits === want.size && lines.length === want.size;
  const linesPartial = hits > 0;

  const out = tx(() => {
    const t = now();
    const cur = db.prepare("SELECT box FROM java_srs WHERE user_id = ? AND challenge_id = ?").get(u, c.id) as { box: number } | undefined;
    const box = correct ? Math.min((cur?.box ?? 0) + 1, MAX_BOX) : 0;
    const due = correct ? t + INTERVAL_DAYS[box] * DAY_MS : t + 10 * 60_000;
    db.prepare(`
      INSERT INTO java_srs (user_id, challenge_id, box, due_at, reps, lapses, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT (user_id, challenge_id) DO UPDATE SET box = excluded.box, due_at = excluded.due_at,
        reps = reps + 1, lapses = lapses + excluded.lapses, updated_at = excluded.updated_at
    `).run(u, c.id, box, due, correct ? 0 : 1, t);
    db.prepare("INSERT INTO java_attempts (user_id, challenge_id, correct, lines_exact, day, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(u, c.id, correct ? 1 : 0, linesExact ? 1 : 0, localDay(t), t);

    const xp = (correct ? LEVEL_XP[c.level] : 0) + (linesExact ? 5 : linesPartial ? 2 : 0);
    const badges: (string | null)[] = addXP(u, xp, `java:${c.level}`);
    if (correct) badges.push(award(u, "bughunter"));
    if (correct && c.level === "expert") badges.push(award(u, "javaexpert"));
    const exact = (db.prepare("SELECT COUNT(*) AS n FROM java_attempts WHERE user_id = ? AND lines_exact = 1").get(u) as { n: number }).n;
    if (exact >= 10) badges.push(award(u, "eagle"));
    return { xp, box, badges: [...new Set(badges.filter((b): b is string => !!b))] };
  });

  res.json({
    correct, answer: c.answer, bugLines: c.bugLines, linesExact, linesPartial,
    explanation: c.explanation, fix: c.fix, fixNote: c.fixNote, debugTip: c.debugTip,
    buggyOutput: c.buggyOutput ?? null, fixedOutput: c.fixedOutput ?? null, throws: c.throws ?? null,
    xp: out.xp, box: out.box, newBadges: out.badges.map((id) => ({ id, label: BADGES[id] ?? id })),
  });
});

java.get("/java/lessons", (req, res) => {
  const rows = db.prepare(`
    SELECT l.data, r.read_at FROM java_lessons l
    LEFT JOIN java_lesson_reads r ON r.lesson_id = l.id AND r.user_id = ?
    ORDER BY l.position
  `).all(req.userId) as { data: string; read_at: string | null }[];
  res.json(rows.map((r) => ({ ...(JSON.parse(r.data) as Lesson), read: !!r.read_at })));
});

java.post("/java/lessons/:id/read", (req, res) => {
  const u = req.userId, id = String(req.params.id);
  if (!db.prepare("SELECT 1 FROM java_lessons WHERE id = ?").get(id)) throw new HttpError(404, "No such lesson");
  const out = tx(() => {
    const r = db.prepare("INSERT OR IGNORE INTO java_lesson_reads (user_id, lesson_id, read_at) VALUES (?, ?, ?)").run(u, id, localDay());
    const xp = r.changes ? 3 : 0;
    const badges = addXP(u, xp, "java:lesson");
    return { xp, newBadges: badges.map((b) => ({ id: b, label: BADGES[b] ?? b })) };
  });
  res.json(out);
});
